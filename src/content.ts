// Content script entry point — initialises the sidebar UI and wires up all modules.
//
// Responsibilities:
//   bootstrap / route detection
//   observer / keyboard / periodic refresh
//   host + shadow lifecycle
//   calls panel/fab rendering helpers
//
// Module boundaries:
//   extract.ts          — DOM → SidebarMessage[]
//   rounds.ts           — messages → SidebarRound[]
//   capture.ts          — API/WS/chat polling
//   conversationStore.ts — merge + persist + bind
//   ui/panel.ts         — panel skeleton, round items, reconciliation
//   ui/fab.ts          — FAB + drag
//   ui/modals.ts       — export / summary modals
//   historyTitles.ts    — restore /c/ link custom titles + rename hint
console.log("[AI Sidebar] content script loaded, modules initializing...");
// Wrap everything in an IIFE so top-level errors are caught and reported to the console.
// Wires:
//   extract.ts      — DOM extraction
//   rounds.ts       — round grouping
//   capture.ts      — API/WS/chat capture polling
//   ui/fab.ts       — floating action button
//   ui/panel.ts     — panel + list reconciliation
//   ui/modals.ts    — export/summary modals
//   folders.ts          — session folder management

import { extractMessages } from "./extract";
import { conversationStore, refreshStore } from "./conversationStore";
import { extractBootstrapMessages } from "./features/bootstrapExtract";
import { panel, fab } from "./state";
import { setupRscCapture } from "./capture";
import {
	initFolders,
	migrateHistoryTitles,
	setupSessionMetaSync,
} from "./features/sessions";
import {
	ensureArenaFolderEntry,
	setupFoldersStorageSync,
	toggleArenaSessionLibrarySection,
} from "./ui/arenaSidebar";
import { setupHistoryContextMenu } from "./ui/contextMenu";
import { setupHistoryTitles } from "./historyTitles";
import { getSessionId, isSessionRoute } from "./platform/route";
import { storageGet } from "./platform/storage";
import { loadHiddenRounds, setupHiddenRoundsSync } from "./rounds";
import { disposeAll, registerDisposer } from "./app/store";
import {
	initRouteState,
	startDomLoop,
	startPeriodicLoop,
	type LoopHooks,
} from "./app/loop";
import { setupKeyboardShortcuts } from "./ui/keyboard";
import { setupTheme } from "./features/theme";
import { renderUI } from "./ui/render";
import { startPreScroll } from "./features/prescroll";

// ─── Store rebuild ─────────────────────────────────────────────────────────────────────

/**
 * Restore the current session from storage, then re-extract from the page and
 * merge every source. Passed to app/loop.ts as a hook so the loop never imports
 * this assembler.
 */
async function rebuildForCurrentRoute(): Promise<void> {
	// Sprint 5/7: restore from storage before rebuilding from DOM.
	const sessionId = getSessionId(location.pathname);
	if (sessionId) {
		conversationStore.sessionId = sessionId;
		// The message record and the hidden-round flags are independent keys —
		// restore them together before the first post-route render.
		await Promise.all([
			conversationStore.loadFromStorage(sessionId),
			loadHiddenRounds(sessionId),
		]);
	}
	refreshStore({
		bootstrap: extractBootstrapMessages(),
		dom: extractMessages(),
		bindAnchors: true,
	});
	// Sprint 5: persist after each rebuild.
	void conversationStore.saveToStorage();
}

// ─── Main render ─────────────────────────────────────────────────────────────────────────
// ─── Main render ─────────────────────────────────────────────────────────────────────────

let shadowRoot: ShadowRoot | null = null;

/** Re-render from the current store. The reconciler itself lives in ui/render.ts. */
function refreshUI() {
	if (shadowRoot) renderUI(shadowRoot, refreshUI);
}
// ─── Bootstrap ─────────────────────────────────────────────────────────────────────────────

function ensureUI() {
	console.log("[AI Sidebar] ensureUI called, current shadowRoot:", shadowRoot);
	if (shadowRoot) {
		console.log("[AI Sidebar] ensureUI: shadowRoot already set, skipping");
		return;
	}
	console.log("[AI Sidebar] ensureUI: creating/looking up host element");
	const existing = document.getElementById("__edge_ai_sidebar_host");
	console.log("[AI Sidebar] ensureUI: existing host:", !!existing);
	const host = existing ?? document.createElement("div");
	host.id = "__edge_ai_sidebar_host";
	host.style.cssText =
		"all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
	const target = document.body || document.documentElement;
	if (!target) {
		console.error("[AI Sidebar] ensureUI: no body or root to attach to");
		return;
	}
	if (!document.body?.contains(host)) {
		target.appendChild(host);
		console.log("[AI Sidebar] ensureUI: appended host to", target.tagName);
	} else {
		console.log("[AI Sidebar] ensureUI: host already in DOM");
	}
	try {
		shadowRoot = host.attachShadow({ mode: "closed" });
		console.log("[AI Sidebar] attachShadow result:", !!shadowRoot);
	} catch (e) {
		console.error("[AI Sidebar] attachShadow threw:", e);
		return;
	}
	if (!shadowRoot) {
		console.error("[AI Sidebar] attachShadow returned null");
		return;
	}
	console.log("[AI Sidebar] shadowRoot attached, calling refreshUI...");
	try {
		// Theme before the first paint: the host attribute must be in place
		// while the very first render is styled, or a dark page gets one
		// flash of light UI (features/theme.ts).
		registerDisposer(setupTheme());
		refreshUI();
		void loadFabPosition();
		// ensureUI is idempotent (guarded on shadowRoot), so this runs once.
		registerDisposer(setupKeyboardShortcuts(shadowRoot, refreshUI));
	} catch (e) {
		console.error("[AI Sidebar] refreshUI/loadFabPosition failed:", e);
	}
}

// Load FAB position from storage. Async because the storage adapter is;
// the caller does not need to await it — it only warms an initial position.
async function loadFabPosition() {
	const saved = (await storageGet("fabPosition")) as
		{ x: number; y: number } | undefined;
	if (saved && fab.position === null) fab.position = saved;
}

// Wrap bootstrap in try-catch so any module-level error is caught.
try {
	// P0 bootstrap fix: use MutationObserver to detect when body is available.
	// DOMContentLoaded fires only on full page loads, NOT on SPA navigation.
	// MutationObserver fires for both, and works at document_start.
	let bootstrapDone = false;

	// ─── Route-change detection for SPA ───────────────────────────────────────────────

	// pi-lens-ignore: no-unused-vars
	const bootstrap = () => {
		console.log(
			"[AI Sidebar] bootstrap called, bootstrapDone:",
			bootstrapDone,
			"body:",
			!!document.body,
		);
		if (bootstrapDone) {
			console.log("[AI Sidebar] bootstrap: already done, skipping");
			return;
		}
		if (!document.body) {
			console.log("[AI Sidebar] bootstrap: no body yet, skipping");
			return;
		}
		bootstrapDone = true;
		initRouteState(); // seed the route key on first load
		panel.isOpen = isSessionRoute(location.pathname); // Sprint 3.1: /c/ defaults to open panel
		initFolders()
			.then(() => migrateHistoryTitles()) // H5: one-time migration historyTitle_* → sessionMeta
			.catch(() => {}); // fire-and-forget
		// Phase 4: every setup that attaches a listener hands its teardown to the
		// registry, so there is one place to tear the whole extension down.
		registerDisposer(setupFoldersStorageSync()); // Phase 10A: cross-tab storage changes
		registerDisposer(setupSessionMetaSync()); // Phase 3: folders subscribes to store changes
		// Hidden-round flags: rebuildForCurrentRoute loads them per session; this
		// keeps the session this page starts on in step with other tabs. Route
		// changes re-subscribe from app/loop.ts handleRouteChange.
		const initialSid = getSessionId(location.pathname);
		if (initialSid) {
			registerDisposer(setupHiddenRoundsSync(initialSid, refreshUI));
		}
		registerDisposer(setupHistoryContextMenu()); // Phase 10A: right-click menu on history links
		registerDisposer(setupHistoryTitles()); // restore custom history titles + rename hint
		// Phase 10A: inject 🗂 Session Library entry into Arena native sidebar
		queueMicrotask(() =>
			ensureArenaFolderEntry(() => toggleArenaSessionLibrarySection()),
		);
		console.log("[AI Sidebar] bootstrap: calling ensureUI...");
		ensureUI();
		if (shadowRoot) {
			const hooks: LoopHooks = { refreshUI, rebuildForCurrentRoute };
			registerDisposer(startDomLoop(hooks));
			registerDisposer(startPeriodicLoop(hooks));
			// Sprint 2.5: listen for Arena's RSC stream responses
			registerDisposer(setupRscCapture());
			// Teardown hook: the registry now owns every listener and timer this
			// extension installed, so leaving the page releases all of it.
			window.addEventListener("pagehide", disposeAll, { once: true });
			// B3 virtual-scroll fix: pre-scroll to load all messages before first extract.
			startPreScroll(() => {
				// After pre-scroll: extract + rebuild for the current route. The
				// rebuild is async (storage restore), and re-rendering before it
				// lands races an empty store — on a quiet page nothing else would
				// trigger another render until the 30s rescan. Render after.
				void rebuildForCurrentRoute().then(() => {
					console.log(
						"[AI Sidebar] store: total messages=" +
							conversationStore.messages.length +
							" rounds=" +
							conversationStore.rounds.length,
					);
					refreshUI();
				});
			});
		}
	};
	if (document.body) {
		bootstrap();
	} else {
		// Poll until body exists (SPA navigation may create body after script load).
		const bodyInterval = setInterval(() => {
			if (document.body) {
				clearInterval(bodyInterval);
				bootstrap();
			}
		}, 100);
		// Also fall back to DOMContentLoaded as a safety net.
		document.addEventListener("DOMContentLoaded", bootstrap);
		// And observe documentElement for early DOM changes.
		const docObserver = new MutationObserver(() => {
			if (document.body && !bootstrapDone) {
				clearInterval(bodyInterval);
				bootstrap();
			}
		});
		docObserver.observe(document.documentElement, {
			childList: true,
			subtree: false,
		});
	}
} catch (e) {
	console.error("[AI Sidebar] fatal initialization error:", e);
}
