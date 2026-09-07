// Shared mutable state — panel/FAB/timer state only.
// Message data moved to conversationStore.ts for multi-source management.

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

// ─── Capture state ───────────────────────────────────────────────────────────────

export const capture = {
	isSummarizing: false,
};

// ─── Timer refs (P1 #3 — replaces unsafe window.__aiSidebar* properties) ──────────

export const timers = {
	debounce: null as ReturnType<typeof setTimeout> | null,
	pollInterval: null as ReturnType<typeof setInterval> | null,
	refreshInterval: null as ReturnType<typeof setInterval> | null,
};
