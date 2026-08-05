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
//   conversationStore.ts — merge + persist + bind
//   ui/panel.ts         — panel skeleton, round items, reconciliation
//   ui/fab.ts          — FAB + drag
//   historyTitles.ts    — /c/ link double-click rename
console.log("[AI Sidebar] content script loaded, modules initializing...");

// ─── Performance instrumentation ─────────────────────────────────────────────────────────────
// Set to false to disable all perf logging in one place.
const PERF = true;

function t0(label: string): number {
	if (!PERF) return 0;
	console.log("[Perf] " + label + " ->");
	return performance.now();
}
function t1(label: string, start: number, extra = ""): void {
	if (!PERF) return;
	const ms = (performance.now() - start).toFixed(1);
	console.log(
		"[Perf] " + label + " <- " + ms + "ms" + (extra ? " | " + extra : ""),
	);
}

import {
	extractMessages,
	resetExtractState,
	USER_MESSAGE_SELECTOR,
	ASSISTANT_MESSAGE_SELECTOR,
} from "./extract";
import {
	conversationStore,
	refreshStore,
	extractBootstrapMessages,
} from "./conversationStore";
import { panel, fab, timers, cachedElements } from "./state";

import { buildFab } from "./ui/fab";
import {
	ensurePanelSkeleton,
	ensureStyles,
	reconcileList,
	setupScrollHighlight,
	refreshCurrentHighlight,
} from "./ui/panel";
import { setupHistoryTitleEditing } from "./historyTitles";

// ─── Keyboard shortcuts (C1) ───────────────────────────────────────────────────────────────
// Alt+S        — toggle panel open/close
// ↑ / ↓       — navigate rounds in panel
// Enter        — scroll to selected round
// Esc          — close panel

function setupKeyboardShortcuts(shadowRoot: ShadowRoot, refreshUI: () => void) {
	document.addEventListener("keydown", (e) => {
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
	});
}

// ─── Route-change detection for SPA ────────────────────────────────────────────────

let lastRouteKey = "";

function getRouteKey(): string {
	const m = location.pathname.match(/^\/c\/([^/?#]+)/);
	if (m) return "c:" + m[1];
	return location.pathname + location.search;
}

function isCharacterChatRoute(): boolean {
	return /^\/c\//.test(location.pathname);
}

function resetSessionState(): void {
	resetExtractState();
	cachedElements.clear();
	conversationStore.reset();
	panel.currentRoundIdx = 0;
	panel.highlightInitialized = false;
	panel.isOpen = isCharacterChatRoute(); // Sprint 3.1: /c/ defaults to open
	lastRouteKey = getRouteKey();
	// C5: allow hydrateFromStorage to run on new route.
	// Without this, hydration is skipped after a route change and the panel shows
	// 0 messages until the observer fires on a second navigation.
	hydrationDone = false;
}

// ─── Hydration: load persisted data immediately, render without waiting for DOM ───────────────
// Called once at bootstrap to restore the session from cache before any DOM extraction.
// This ensures the panel shows content immediately even before Arena has rendered messages.

let hydrationDone = false;

// ─── DOM extraction (no unconditional storage overwrite) ───────────────────────────────────
// Extracts messages from the current DOM and merges them into the store.
// Storage loading is handled separately by hydrateFromStorage().
// Only saves to storage when DOM actually contributed new messages.

// Returns the extracted message counts so runRefresh can decide whether to re-render.
function rebuildForCurrentRoute(): { bootstrap: number; dom: number } {
	const _t = t0("rebuildForCurrentRoute");
	const bootstrapMsgs = extractBootstrapMessages();
	const domMsgs = extractMessages();
	refreshStore({
		bootstrap: bootstrapMsgs,
		dom: domMsgs,
		bindAnchors: true,
	});
	t1(
		"rebuildForCurrentRoute",
		_t,
		`bootstrap=${bootstrapMsgs.length} dom=${domMsgs.length} total=${conversationStore.messages.length}`,
	);
	// Only save when DOM contributed new messages — never overwrite storage with
	// a blank DOM snapshot during the preScroll window or early hydration.
	if (domMsgs.length > 0) {
		conversationStore.saveToStorage();
	}
	return { bootstrap: bootstrapMsgs.length, dom: domMsgs.length };
}

async function hydrateFromStorage(): Promise<void> {
	const _t = t0("hydrateFromStorage");
	if (hydrationDone) {
		t1("hydrateFromStorage SKIP (done)", _t);
		return;
	}
	hydrationDone = true;
	const sessionId = location.pathname.match(/^\/c\/([^/?#]+)/)?.[1] ?? "";
	if (!sessionId) {
		t1("hydrateFromStorage SKIP (no session)", _t);
		return;
	}
	conversationStore.sessionId = sessionId;
	await conversationStore.loadFromStorage(sessionId);
	t1(
		"hydrateFromStorage",
		_t,
		`msgs=${conversationStore.messages.length} rounds=${conversationStore.rounds.length}`,
	);
}

// ─── Refresh scheduler ──────────────────────────────────────────────────────────────────────
// Replaces the previous nested-debounce pattern (800ms outer + 800ms inner) with a
// single coherent scheduler that coalesces all mutations into at most one trailing refresh.
//
// Invariants:
//   - Only one pending timer exists at any time (refreshTimer is single-shot)
//   - If a refresh is already running when the next batch arrives, at most ONE trailing
//     call is scheduled — no matter how many mutations arrive during execution
//   - Route changes always cancel the pending timer and immediately hydrate + render

let refreshTimer: ReturnType<typeof setTimeout> | null = null;
// "dirty while running" flag — if true, schedule() will queue one trailing pass after
// the current refresh finishes (instead of spawning multiple passes)
let refreshDirty = false;
let refreshRunning = false;

const SCHEDULE_DELAY_MS = 400; // coalescing window — longer than old 250ms, shorter than 800ms

// P5: Layer 1 — ignore mutations inside our own injected DOM and Arena's library UI.
const SIDEBAR_HOST_ID = "__edge_ai_sidebar_host";

function shouldIgnoreMutation(record: MutationRecord): boolean {
	const target = record.target as Node | null;
	if (!target || !(target instanceof Node)) return true;

	// P5-Layer1: skip everything inside our own shadow/host DOM
	const host = document.getElementById(SIDEBAR_HOST_ID);
	if (host && host.contains(target)) return true;

	return false;
}

function scheduleRefresh(opts: { reason: string; immediate?: boolean }): void {
	const { reason, immediate } = opts;

	// Route-change path: cancel everything and go immediate
	if (immediate) {
		if (refreshTimer !== null) {
			clearTimeout(refreshTimer);
			refreshTimer = null;
		}
		// If a refresh is currently running, mark dirty so we get one trailing pass
		if (refreshRunning) {
			refreshDirty = true;
			return;
		}
		// Nothing running — execute synchronously
		runRefresh(reason);
		return;
	}

	// Already have a pending timer — just mark dirty (no extra scheduling)
	if (refreshTimer !== null) {
		return;
	}

	refreshTimer = setTimeout(() => {
		refreshTimer = null;
		runRefresh(reason);
	}, SCHEDULE_DELAY_MS);
}

function runRefresh(reason: string): void {
	if (panel.isDragging || preScrollActive) return;

	refreshRunning = true;
	let newContent = false;
	try {
		setupHistoryTitleEditing();
		const counts = rebuildForCurrentRoute();
		// Only re-render the panel when the store actually gained new messages.
		// Silent rebuilds (bootstrap=0 dom=0) happen when Arena mutates non-message DOM
		// (e.g. typing indicators, focus rings) — skipping refreshUI eliminates the
		// reconcile noise without losing any real update.
		newContent = counts.bootstrap > 0 || counts.dom > 0;
		if (newContent) refreshUI();
	} finally {
		refreshRunning = false;
	}

	// If mutations arrived while we were refreshing, schedule exactly one trailing pass
	if (refreshDirty) {
		refreshDirty = false;
		scheduleRefresh({ reason: "trailing-after-" + reason });
	}
}

// ─── DOM extraction (no unconditional storage overwrite) ───────────────────────────────────
// Called by the observer after preScroll completes. Passes persist=false so it never
// overwrites storage with a potentially empty DOM snapshot during the preScroll window.

let observer: MutationObserver | null = null;

function setupObserver(_shadowRoot: ShadowRoot, refreshUI: () => void) {
	if (observer) observer.disconnect();
	observer = new MutationObserver((mutations) => {
		if (panel.isDragging) return;
		// P5-Layer2: fast-path — skip entirely if all mutations are inside our own DOM
		if (mutations.every(shouldIgnoreMutation)) return;
		// P5-Layer3: route-change detection
		const nextKey = getRouteKey();
		if (nextKey !== lastRouteKey) {
			resetSessionState();
			void hydrateFromStorage().then(() => refreshUI());
			scheduleRefresh({ reason: "route-change", immediate: true });
			return;
		}
		scheduleRefresh({ reason: "observer" });
	});
	// P2 fix: observe only the chat container, not the entire document.body.
	// Cascade fallback: precise → main → body (avoids missing messages on structural changes).
	const chatContainer = document.querySelector(
		'main > div > div[class*="h-full"][class*="w-full"][class*="overscroll-none"]',
	);
	const target =
		chatContainer ?? document.querySelector("main") ?? document.body;
	observer.observe(target, { childList: true, subtree: true });
}

// ─── Periodic timers ───────────────────────────────────────────────────────────────────────

function setupPeriodicPush(refreshUI: () => void) {
	if (timers.refreshInterval !== null) return;
	timers.refreshInterval = setInterval(() => {
		if (!panel.isDragging) {
			const prevCount = conversationStore.messages.length;
			const domMsgs = extractMessages();
			refreshStore({ dom: domMsgs, bindAnchors: false });
			refreshUI();
			// Sprint 5: persist only when new messages arrived — writing the full
			// session payload every 30s (even when idle) caused avoidable storage churn.
			if (conversationStore.messages.length !== prevCount) {
				conversationStore.saveToStorage();
			}
		}
	}, 30000);
}

// ─── Main render ─────────────────────────────────────────────────────────────────────────

let shadowRoot: ShadowRoot | null = null;

// ─── Pre-scroll: force-render all virtual-scrolled messages ────────────────────────────────

function findScrollContainer(): HTMLElement | null {
	// The real scroll container is inside <main> with overscroll-none —
	// Arena renders only ~8 messages in DOM and progressively loads more as user scrolls.
	const c = document.querySelector(
		'main > div > div[class*="h-full"][class*="w-full"][class*="overscroll-none"]',
	);
	if (
		c &&
		(c as HTMLElement).scrollHeight > (c as HTMLElement).clientHeight * 3
	) {
		return c as HTMLElement;
	}
	// Fallback: largest scrollable element inside <main>
	const main = document.querySelector("main");
	if (!main) return null;
	let best: HTMLElement | null = null;
	let bestScore = 0;
	main.querySelectorAll("*").forEach((el) => {
		const e = el as HTMLElement;
		if (e.scrollHeight > e.clientHeight * 2) {
			const score = e.scrollHeight - e.clientHeight;
			if (score > bestScore) {
				bestScore = score;
				best = e;
			}
		}
	});
	return best;
}

let preScrollDone = false;
let preScrollInterval: ReturnType<typeof setInterval> | null = null;
let preScrollActive = false; // suppress observer work while forced-scrolling

// Lightweight container lookup for preScroll retries — avoids the full <main>
// fallback scan (querySelectorAll("*") + per-element scrollHeight forces reflow).
function peekScrollContainer(): HTMLElement | null {
	const c = document.querySelector(
		'main > div > div[class*="h-full"][class*="w-full"][class*="overscroll-none"]',
	);
	if (
		c &&
		(c as HTMLElement).scrollHeight > (c as HTMLElement).clientHeight * 3
	) {
		return c as HTMLElement;
	}
	return null;
}

function startPreScroll(onDone: () => void) {
	console.log("[Perf] startPreScroll SKIP (already done)");
	if (preScrollDone) {
		onDone();
		return;
	}
	console.log("[Perf] startPreScroll: looking for scroll container...");
	const container = findScrollContainer();
	if (!container) {
		// Arena's React renders the scroll container after the body exists, so
		// retry briefly (using the cheap peek) instead of giving up — a skipped
		// preScroll leaves long conversations partially extracted.
		console.log("[AI Sidebar] preScroll: no scroll container yet, retrying...");
		let retries = 0;
		const retry = setInterval(() => {
			const c = peekScrollContainer();
			if (c || ++retries > 10) {
				clearInterval(retry);
				if (c) {
					startPreScroll(onDone);
				} else {
					console.log(
						"[Perf] startPreScroll: gave up, no container — extracting from DOM",
					);
					preScrollDone = true;
					// Extract whatever messages Arena has rendered so far (even without preScroll).
					rebuildForCurrentRoute();
					onDone();
				}
			}
		}, 200);
		return;
	}
	// preScroll exists because Arena virtualizes (renders only ~8 messages) and we
	// need the full list extracted. If the container isn't virtualized (fits on
	// screen), skip entirely — no scroll, no extract, no signature burn.
	if (container.scrollHeight <= container.clientHeight * 2) {
		console.log(
			"[Perf] startPreScroll: skipped, container not virtualized — calling rebuild anyway",
		);
		rebuildForCurrentRoute();
		preScrollDone = true;
		onDone();
		return;
	}
	const step = Math.max(container.clientHeight * 2, 1500);
	console.log(
		"[AI Sidebar] preScroll: totalH=",
		container.scrollHeight,
		"step=",
		step,
	);
	preScrollActive = true;
	// Stop once the rendered message count stops growing (Arena lazy-loads more
	// while scrolling) — don't force-scroll the whole conversation to the bottom,
	// which on long chats makes Arena render every message and janks the page.
	let lastMsgCount = countRenderedMessages();
	let stableTicks = 0;
	const STABLE_LIMIT = 3;
	preScrollInterval = setInterval(() => {
		// Defense: if the interval was cleared externally, stop cleanly.
		if (!preScrollActive || !preScrollInterval) {
			if (preScrollInterval) clearInterval(preScrollInterval);
			preScrollInterval = null;
			preScrollActive = false;
			return;
		}
		container.scrollBy(0, step);
		const newCount = countRenderedMessages();
		if (newCount > lastMsgCount) {
			lastMsgCount = newCount;
			stableTicks = 0;
		} else {
			stableTicks++;
		}
		if (stableTicks >= STABLE_LIMIT) {
			clearInterval(preScrollInterval);
			preScrollInterval = null;
			preScrollActive = false;
			console.log("[Perf] startPreScroll: done, messages=" + lastMsgCount);
			setTimeout(() => {
				container.scrollTop = 0;
				preScrollDone = true;
				onDone();
			}, 600);
		}
	}, 120);
}

// Count rendered message elements cheaply (querySelectorAll, no reflow).
function countRenderedMessages(): number {
	const main = document.querySelector("main");
	if (!main) return 0;
	let n = 0;
	try {
		n += main.querySelectorAll(USER_MESSAGE_SELECTOR).length;
	} catch (_e) {
		/* selector may throw on detached nodes */
	}
	try {
		n += main.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR).length;
	} catch (_e) {
		/* selector may throw on detached nodes */
	}
	return n;
}

function refreshUI() {
	const _t = t0("refreshUI");
	if (!shadowRoot) return;

	// Read from canonical store (updated by bootstrap or DOM re-scan).
	const storeMessages = conversationStore.messages;
	const storeRounds = conversationStore.rounds;
	const newIds = storeRounds.map((r) => r.id);
	const msgCount = storeMessages.length;

	// Fast-path: nothing structurally changed AND same UI mode AND no search active.
	if (
		!panel.searchQuery &&
		!panel.prevSearchActive &&
		newIds.length === fab.prevRoundIds.length &&
		newIds[newIds.length - 1] ===
			fab.prevRoundIds[fab.prevRoundIds.length - 1] &&
		panel.isOpen === panel.prevIsOpen &&
		shadowRoot.querySelector(".panel")
	) {
		ensureStyles(shadowRoot);
		const titleEl = shadowRoot.querySelector(".panel-title");
		if (titleEl) titleEl.textContent = storeRounds.length + " loaded rounds";
		fab.prevRoundIds = newIds;
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		t1("refreshUI", _t, `returns early`);
		return;
	}

	fab.prevRoundIds = newIds;
	panel.prevIsOpen = panel.isOpen;
	panel.prevSearchActive = !!panel.searchQuery;

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
			isCharacterChatRoute() ? "character" : "direct",
		);
		host.setAttribute("data-ai-sidebar-rounds", String(storeRounds.length));
		host.setAttribute("data-ai-sidebar-msgs", String(storeMessages.length));
		t1(
			"refreshUI",
			_t,
			`msgs=${conversationStore.messages.length} rounds=${conversationStore.rounds.length}`,
		);
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
		loadFabPosition();
		setupKeyboardShortcuts(shadowRoot, refreshUI);
	} catch (e) {
		console.error("[AI Sidebar] refreshUI/loadFabPosition failed:", e);
	}
}

// Load FAB position from chrome.storage
function loadFabPosition() {
	if (typeof chrome !== "undefined" && chrome.storage) {
		chrome.storage.local.get(
			"fabPosition",
			(r: { fabPosition?: { x: number; y: number } }) => {
				if (r.fabPosition && fab.position === null)
					fab.position = r.fabPosition;
			},
		);
	}
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
		lastRouteKey = getRouteKey(); // init route key on first load
		panel.isOpen = isCharacterChatRoute(); // Sprint 3.1: /c/ defaults to open panel
		// Hydrate from storage immediately so the panel renders with cached data
		// without waiting for DOM extraction or preScroll to complete.
		void hydrateFromStorage().then(() => {
			if (shadowRoot) refreshUI();
		});
		// Restore custom history titles from storage onto Arena sidebar links
		void setupHistoryTitleEditing();
		console.log("[AI Sidebar] bootstrap: calling ensureUI...");
		ensureUI();
		if (shadowRoot) {
			setupObserver(shadowRoot, refreshUI);
			setupPeriodicPush(refreshUI);
			// Pre-scroll to trigger Arena to render more messages.
			// After preScroll: observer will naturally fire as Arena injects messages
			// into the DOM, debouncing into refreshUI.
			startPreScroll(() => {
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
