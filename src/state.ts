// Shared mutable state — panel/FAB/timer state only.
// Message data moved to conversationStore.ts for multi-source management.

// ─── Immutable config ─────────────────────────────────────────────────────────────────

export const CONFIG = {
	EXTRACT_COOLDOWN_MS: 500,
	DEBOUNCE_MS: 800,
	REFRESH_INTERVAL_MS: 30000,
} as const;

// ─── DOM element registry (written by extract.ts, read by rounds.ts, conversationStore.ts) ──

export const cachedElements = new Map<string, Element>();

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

// ─── Timer refs (P1 #3 — replaces unsafe window.__aiSidebar* properties) ──────────

export const timers = {
	debounce: null as ReturnType<typeof setTimeout> | null,
	pollInterval: null as ReturnType<typeof setInterval> | null,
	refreshInterval: null as ReturnType<typeof setInterval> | null,
};

// ─── Extension context validity (Sprint 7 fix) ─────────────────────────────────────────────
// Set to false when chrome.runtime.lastError fires; all storage calls check this.

export let contextValid = true;

/** Call after any chrome.storage call that sets chrome.runtime.lastError. */
export function invalidateContext() {
	contextValid = false;
}
