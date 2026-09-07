// Shared mutable state — panel/FAB/timer state only.
// Message data moved to conversationStore.ts for multi-source management.

// ─── DOM element registry (written by extract.ts, read by rounds.ts, conversationStore.ts) ──

export const cachedElements = new Map<string, Element>();

// ─── Panel state ──────────────────────────────────────────────────────────────────

export const panel = {
	isOpen: false,
	reverseOrder: true,
	searchQuery: "",
	currentRoundIdx: 0,
	highlightInitialized: false,
	isDragging: false,
	/**
	 * The last renderKey() refreshUI produced. Replaces the three ad-hoc
	 * prev-state fields (prevIsOpen, prevSearchActive, fab.prevRoundIds) that
	 * each tracked one slice of "what did I last render" and disagreed with
	 * each other about what counted as a change.
	 */
	lastRenderKey: "",
};

// ─── FAB state ────────────────────────────────────────────────────────────────────

export const fab = {
	position: null as { x: number; y: number } | null,
};

// ─── Timer refs (P1 #3 — replaces unsafe window.__aiSidebar* properties) ──────────

export const timers = {
	debounce: null as ReturnType<typeof setTimeout> | null,
	pollInterval: null as ReturnType<typeof setInterval> | null,
	refreshInterval: null as ReturnType<typeof setInterval> | null,
};
