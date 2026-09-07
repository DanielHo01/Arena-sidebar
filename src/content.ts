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
//   historyTitles.ts    — /c/ link double-click rename
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
import {
	conversationStore,
	refreshStore,
	extractBootstrapMessages,
} from "./conversationStore";
import { panel, fab, timers } from "./state";
import { pollCaptures, setupRscCapture } from "./capture";
import {
	initFolders,
	migrateHistoryTitles,
	ensureArenaFolderEntry,
	setupHistoryContextMenu,
	toggleArenaSessionLibrarySection,
	setupFoldersStorageSync,
	setupSessionMetaSync,
} from "./folders";
import { buildFab } from "./ui/fab";
import {
	ensurePanelSkeleton,
	ensureStyles,
	reconcileList,
	setupScrollHighlight,
	refreshCurrentHighlight,
} from "./ui/panel";
import { setupHistoryTitleEditing } from "./historyTitles";
import { getSessionId, isSessionRoute, routeKey } from "./platform/route";
import { SCROLL_CONTAINER_SELECTOR } from "./platform/arenaDom";
import { renderKey } from "./core/renderKey";
import type { Disposer } from "./types";
import { storageGet } from "./platform/storage";
import {
	disposeAll,
	registerDisposer,
	resetSessionState as appResetSessionState,
} from "./app/store";
import { isPreScrollActive, startPreScroll } from "./features/prescroll";

// ─── Keyboard shortcuts (C1) ───────────────────────────────────────────────────────────────
// Alt+S        — toggle panel open/close
// ↑ / ↓       — navigate rounds in panel
// Enter        — scroll to selected round
// Esc          — close panel

function setupKeyboardShortcuts(
	shadowRoot: ShadowRoot,
	refreshUI: () => void,
): Disposer {
	const onKeydown = (e: KeyboardEvent) => {
		// Alt+S — toggle panel (always works)
		if (e.altKey && (e.key === "s" || e.key === "S")) {
			e.preventDefault();
			panel.isOpen = !panel.isOpen;
			refreshUI();
			return;
		}
		if (!panel.isOpen) return;

		// Skip navigation when focus is on an editable element (search, input, etc.)
		const target = e.target as HTMLElement;
		const isEditable =
			target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.tagName === "SELECT" ||
			target.isContentEditable;

		const listEl = shadowRoot.querySelector(".list");
		if (!listEl) return;
		const list = listEl as HTMLElement;

		// ↑ — previous round
		if (e.key === "ArrowUp") {
			if (isEditable) return; // Sprint 6: don't hijack arrow keys while typing in search
			e.preventDefault();
			panel.currentRoundIdx = Math.max(0, panel.currentRoundIdx - 1);
			refreshCurrentHighlight(list);
			const items = list.querySelectorAll<HTMLElement>(".item");
			items[panel.currentRoundIdx]?.scrollIntoView({ block: "nearest" });
			return;
		}
		// ↓ — next round
		if (e.key === "ArrowDown") {
			if (isEditable) return; // Sprint 6: don't hijack arrow keys while typing in search
			e.preventDefault();
			const items = list.querySelectorAll<HTMLElement>(".item");
			panel.currentRoundIdx = Math.min(
				items.length - 1,
				panel.currentRoundIdx + 1,
			);
			refreshCurrentHighlight(list);
			items[panel.currentRoundIdx]?.scrollIntoView({ block: "nearest" });
			return;
		}
		// Enter — go to selected round (only when not in an input)
		if (e.key === "Enter") {
			if (isEditable) return;
			e.preventDefault();
			const items = list.querySelectorAll<HTMLElement>(".item");
			const selected = items[panel.currentRoundIdx];
			if (selected) {
				selected.click();
			}
			return;
		}
		// Esc — close panel
		if (e.key === "Escape") {
			if (isEditable) return; // Sprint 6: let input's own Esc work (e.g. clear search)
			e.preventDefault();
			panel.isOpen = false;
			refreshUI();
			return;
		}
	};
	document.addEventListener("keydown", onKeydown);
	return () => document.removeEventListener("keydown", onKeydown);
}

// ─── Route-change detection for SPA ────────────────────────────────────────────────

let lastRouteKey = "";
let isFirstRender = true; // Sprint 3.1: skip debounce on first render

/**
 * Reset every session-scoped value and adopt the current route.
 *
 * The actual reset lives in app/store.ts so it can be tested; this wrapper only
 * supplies the session id and refreshes the local route key.
 */
function resetSessionState(): void {
	appResetSessionState(getSessionId(location.pathname));
	lastRouteKey = routeKey(location.pathname, location.search);
}

async function rebuildForCurrentRoute(): Promise<void> {
	// Sprint 5/7: restore from storage before rebuilding from DOM
	const sessionId = getSessionId(location.pathname);
	if (sessionId) {
		conversationStore.sessionId = sessionId;
		await conversationStore.loadFromStorage(sessionId);
	}
	const bootstrapMsgs = extractBootstrapMessages();
	const domMsgs = extractMessages();
	refreshStore({
		bootstrap: bootstrapMsgs,
		dom: domMsgs,
		bindAnchors: true,
	});
	// Sprint 5: persist after each rebuild
	void conversationStore.saveToStorage();
}

// ─── MutationObserver ─────────────────────────────────────────────────────────────────────

let observer: MutationObserver | null = null;

function setupObserver(
	_shadowRoot: ShadowRoot,
	refreshUI: () => void,
): Disposer {
	if (observer) observer.disconnect();
	observer = new MutationObserver(() => {
		if (panel.isDragging) return;
		if (timers.debounce !== null) clearTimeout(timers.debounce);
		// P4 fix: 800ms debounce — Arena typing causes dense characterData mutations;
		// 250ms was too short and stacked multiple extract rebuilds.
		// Sprint 3.1: skip debounce on first render so panel appears instantly.
		timers.debounce = setTimeout(() => {
			if (!panel.isDragging && !isPreScrollActive()) {
				// Sprint 3.2: detect route change and rebuild store
				const nextKey = routeKey(location.pathname, location.search);
				if (nextKey !== lastRouteKey) {
					resetSessionState();
					isFirstRender = true; // route change → next render should be immediate
					// Phase 10A: re-inject Arena sidebar entries on route change
					ensureArenaFolderEntry(() => toggleArenaSessionLibrarySection());
					setupHistoryContextMenu();
					// Phase 1: force-load the new session's virtualised history
					// before rebuilding. Previously this path called
					// rebuildForCurrentRoute() directly and preScrollDone stayed
					// true from bootstrap, so a switched-to session only ever
					// showed the ~8 messages Arena had rendered.
					void startPreScroll(() => {
						void rebuildForCurrentRoute();
						refreshUI();
					});
				}
				setupHistoryTitleEditing(); // re-bind on every DOM change (SPA lazy load)
				if (isFirstRender) {
					isFirstRender = false;
					refreshUI(); // instant on first render — no debounce wait
				} else {
					if (timers.debounce !== null) clearTimeout(timers.debounce);
					timers.debounce = setTimeout(() => {
						isFirstRender = false;
						refreshUI();
					}, 800);
				}
			}
		}, 800);
	});
	// P2 fix: observe only the chat container, not the entire document.body.
	// Cascade fallback: precise → main → body (avoids missing messages on structural changes).
	const chatContainer = document.querySelector(SCROLL_CONTAINER_SELECTOR);
	const target =
		chatContainer ?? document.querySelector("main") ?? document.body;
	observer.observe(target, { childList: true, subtree: true });
	return () => {
		if (observer) {
			observer.disconnect();
			observer = null;
		}
	};
}

// ─── Periodic timers ───────────────────────────────────────────────────────────────────────

function setupPeriodicPush(refreshUI: () => void): Disposer {
	if (timers.pollInterval !== null || timers.refreshInterval !== null) {
		return () => {};
	}
	timers.pollInterval = setInterval(() => {
		if (!panel.isDragging) {
			pollCaptures();
		}
	}, 2000);
	timers.refreshInterval = setInterval(() => {
		if (!panel.isDragging) {
			const prevCount = conversationStore.messages.length;
			const domMsgs = extractMessages();
			refreshStore({ dom: domMsgs, bindAnchors: false });
			refreshUI();
			// Sprint 5: persist only when new messages arrived — writing the full
			// session payload every 30s (even when idle) caused avoidable storage churn.
			if (conversationStore.messages.length !== prevCount) {
				void conversationStore.saveToStorage();
			}
		}
	}, 30000);
	return () => {
		if (timers.pollInterval !== null) clearInterval(timers.pollInterval);
		if (timers.refreshInterval !== null) clearInterval(timers.refreshInterval);
		timers.pollInterval = null;
		timers.refreshInterval = null;
	};
}

// ─── Main render ─────────────────────────────────────────────────────────────────────────

let shadowRoot: ShadowRoot | null = null;

function refreshUI() {
	if (!shadowRoot) return;

	// Read from canonical store (updated by bootstrap, capture, or periodic DOM re-scan).
	const storeMessages = conversationStore.messages;
	const storeRounds = conversationStore.rounds;
	const newIds = storeRounds.map((r) => r.id);
	const msgCount = storeMessages.length;

	const key = renderKey({
		isOpen: panel.isOpen,
		searchQuery: panel.searchQuery,
		reverseOrder: panel.reverseOrder,
		roundIds: newIds,
	});

	// Fast-path: nothing the rendered output depends on has changed, and the
	// panel DOM is actually there. The no-search guard is kept from the original:
	// while a search is active the list is filtered on every call, and it is
	// cheaper to re-render than to reason about highlight state.
	if (
		!panel.searchQuery &&
		key === panel.lastRenderKey &&
		shadowRoot.querySelector(".panel")
	) {
		ensureStyles(shadowRoot);
		const titleEl = shadowRoot.querySelector(".panel-title");
		if (titleEl) titleEl.textContent = storeRounds.length + " loaded rounds";
		return;
	}

	panel.lastRenderKey = key;

	ensureStyles(shadowRoot);

	if (msgCount === 0) return;

	if (!panel.isOpen) {
		// FAB: only rebuild if the round count changed or no FAB exists yet.
		const oldFab = shadowRoot.querySelector(".fab");
		const oldCount = parseInt(
			oldFab?.getAttribute("data-msg-count") || "0",
			10,
		);
		if (oldFab && oldCount === storeRounds.length) {
			// Count unchanged — nothing to do.
			return;
		}
		const oldPanel = shadowRoot.querySelector(".panel");
		if (oldPanel) oldPanel.remove();
		if (oldFab) oldFab.remove();
		const fabEl = buildFab(storeRounds.length);
		fabEl.setAttribute("data-msg-count", String(storeRounds.length));
		shadowRoot.appendChild(fabEl);
		return;
	}

	// Panel mode
	const oldFab = shadowRoot.querySelector(".fab");
	if (oldFab) oldFab.remove();

	const orderedRounds = panel.reverseOrder
		? [...storeRounds].reverse()
		: storeRounds;
	const savedScroll = shadowRoot.querySelector(".list")?.scrollTop ?? 0;
	ensurePanelSkeleton(shadowRoot, orderedRounds.length, msgCount, refreshUI);
	const list = shadowRoot.querySelector(".list");
	if (list) {
		const listEl = list as HTMLElement;
		reconcileList(listEl, orderedRounds, refreshUI);
		if (savedScroll > 0) listEl.scrollTop = savedScroll;
		if (!panel.highlightInitialized && !panel.searchQuery) {
			panel.currentRoundIdx = 0;
			panel.highlightInitialized = true;
			setupScrollHighlight(listEl);
		}
		refreshCurrentHighlight(listEl);
	}

	// Sprint 3.1: update host debug attributes for external verification
	const host = document.getElementById("__edge_ai_sidebar_host");
	if (host) {
		host.setAttribute("data-ai-sidebar-open", panel.isOpen ? "1" : "0");
		host.setAttribute(
			"data-ai-sidebar-mode",
			isSessionRoute(location.pathname) ? "character" : "direct",
		);
		host.setAttribute("data-ai-sidebar-rounds", String(storeRounds.length));
		host.setAttribute("data-ai-sidebar-msgs", String(storeMessages.length));
	}
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
		lastRouteKey = routeKey(location.pathname, location.search); // init route key on first load
		panel.isOpen = isSessionRoute(location.pathname); // Sprint 3.1: /c/ defaults to open panel
		initFolders()
			.then(() => migrateHistoryTitles()) // H5: one-time migration historyTitle_* → sessionMeta
			.catch(() => {}); // fire-and-forget
		// Phase 4: every setup that attaches a listener hands its teardown to the
		// registry, so there is one place to tear the whole extension down.
		registerDisposer(setupFoldersStorageSync()); // Phase 10A: cross-tab storage changes
		registerDisposer(setupSessionMetaSync()); // Phase 3: folders subscribes to store changes
		registerDisposer(setupHistoryContextMenu()); // Phase 10A: right-click menu on history links
		registerDisposer(setupHistoryTitleEditing()); // restore/rename custom history titles
		// Phase 10A: inject 🗂 Session Library entry into Arena native sidebar
		queueMicrotask(() =>
			ensureArenaFolderEntry(() => toggleArenaSessionLibrarySection()),
		);
		console.log("[AI Sidebar] bootstrap: calling ensureUI...");
		ensureUI();
		if (shadowRoot) {
			registerDisposer(setupObserver(shadowRoot, refreshUI));
			registerDisposer(setupPeriodicPush(refreshUI));
			// Sprint 2.5: listen for Arena's RSC stream responses
			registerDisposer(setupRscCapture());
			// Teardown hook: the registry now owns every listener and timer this
			// extension installed, so leaving the page releases all of it.
			window.addEventListener("pagehide", disposeAll, { once: true });
			// B3 virtual-scroll fix: pre-scroll to load all messages before first extract.
			startPreScroll(() => {
				// After pre-scroll: extract + rebuild for current route.
				rebuildForCurrentRoute();
				console.log(
					"[AI Sidebar] store: total messages=" +
						conversationStore.messages.length +
						" rounds=" +
						conversationStore.rounds.length,
				);
				refreshUI();
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
