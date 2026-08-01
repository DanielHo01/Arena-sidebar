// Shared mutable state — panel/FAB/timer state only.
// Message data moved to conversationStore.ts for multi-source management.

// ─── Immutable config ─────────────────────────────────────────────────────────────────

export const CONFIG = {
	EXTRACT_COOLDOWN_MS: 500,
	DEBOUNCE_MS: 800,
	CAPTURE_INTERVAL_MS: 2000,
	REFRESH_INTERVAL_MS: 30000,
} as const;

// ─── DOM element registry (written by extract.ts, read by rounds.ts, conversationStore.ts) ──

export const cachedElements = new Map<string, Element>();

// ─── Performance revision counters (Phase 2: know where the bottleneck is) ────────────────

export const revision = {
	dom: 0, // DOM signature changed
	capture: 0, // capture detected new events
	store: 0, // store actually changed (messages added/updated)
	render: 0, // UI actually redrew
};

// ─── Panel state ──────────────────────────────────────────────────────────────────

export const panel = {
	isOpen: false,
	reverseOrder: true,
	prevIsOpen: false,
	searchQuery: "",
	currentRoundIdx: 0,
	prevSearchActive: false,
	highlightInitialized: false,
	isDragging: false,
};

// ─── FAB state ────────────────────────────────────────────────────────────────────

export const fab = {
	position: null as { x: number; y: number } | null,
	prevRoundIds: [] as string[],
};

// ─── Capture state ───────────────────────────────────────────────────────────────

export const capture = {
	apiConfig: null as {
		url: string;
		headers: Record<string, string>;
		bodySample: unknown;
	} | null,
	isSummarizing: false,
	lastExtractTs: 0,
	lastWsTs: 0,
	wsEvents: [] as unknown[],
};

// ─── Timer refs (P1 #3 — replaces unsafe window.__aiSidebar* properties) ──────────

export const timers = {
	debounce: null as ReturnType<typeof setTimeout> | null,
	pollInterval: null as ReturnType<typeof setInterval> | null,
	refreshInterval: null as ReturnType<typeof setInterval> | null,
};

// ─── Sprint 2.5: history capture state ──────────────────────────────────────────

export const historyState = {
	lastTs: 0, // 上一次处理的 history event ts（防重入）
	status: 0, // 最近一次 history response 的 HTTP status
	handled: false, // 本次页面会话是否已处理过 history
};

// ─── Extension context validity (Sprint 7 fix) ─────────────────────────────────────────────
// Set to false when chrome.runtime.lastError fires; all storage calls check this.

export let contextValid = true;

/** Call after any chrome.storage call that sets chrome.runtime.lastError. */
export function invalidateContext() {
	contextValid = false;
}
