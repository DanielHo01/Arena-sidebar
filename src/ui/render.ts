// ui/render.ts — decides whether the UI must change, and changes it.
//
// Split out of content.ts in Phase 5. The reconciler lives here rather than in
// the assembler so the "what do I render" question is separate from "when do I
// get told to render"; content.ts owns the trigger side (app/loop.ts) and the
// shadow root, and calls in with both.
//
// The fast path is the reason this file exists at all: refreshUI is called from
// an 800ms-debounced MutationObserver and a 30s timer, and rebuilding the whole
// panel DOM on every call was the extension's main source of jank.

import type { SidebarRound } from "../types";
import { conversationStore } from "../conversationStore";
import { panel } from "../state";
import { hiddenRoundIds } from "../rounds";
import { renderKey } from "../core/renderKey";
import { isSessionRoute } from "../platform/route";
import { buildFab } from "./fab";
import {
	ensurePanelSkeleton,
	ensureStyles,
	reconcileList,
	refreshCurrentHighlight,
	setupScrollHighlight,
} from "./panel";

/** Mirror panel state onto the host element so e2e tests can assert on it. */
function syncHostAttributes(rounds: SidebarRound[], msgCount: number): void {
	const host = document.getElementById("__edge_ai_sidebar_host");
	if (!host) return;
	host.setAttribute("data-ai-sidebar-open", panel.isOpen ? "1" : "0");
	host.setAttribute(
		"data-ai-sidebar-mode",
		isSessionRoute(location.pathname) ? "character" : "direct",
	);
	host.setAttribute("data-ai-sidebar-rounds", String(rounds.length));
	host.setAttribute("data-ai-sidebar-msgs", String(msgCount));
}

/** Panel closed: show only the FAB, and only rebuild it if the count moved. */
function renderFabMode(shadowRoot: ShadowRoot, rounds: SidebarRound[]): void {
	const oldFab = shadowRoot.querySelector(".fab");
	const oldCount = parseInt(oldFab?.getAttribute("data-msg-count") || "0", 10);
	if (oldFab && oldCount === rounds.length) return;

	shadowRoot.querySelector(".panel")?.remove();
	oldFab?.remove();
	const fabEl = buildFab(rounds.length);
	fabEl.setAttribute("data-msg-count", String(rounds.length));
	shadowRoot.appendChild(fabEl);
}

/** Panel open: rebuild the shell, diff the list, restore scroll and highlight. */
function renderPanelMode(
	shadowRoot: ShadowRoot,
	rounds: SidebarRound[],
	msgCount: number,
	onRefresh: () => void,
): void {
	shadowRoot.querySelector(".fab")?.remove();

	const orderedRounds = panel.reverseOrder ? [...rounds].reverse() : rounds;
	const savedScroll = shadowRoot.querySelector(".list")?.scrollTop ?? 0;
	ensurePanelSkeleton(shadowRoot, orderedRounds.length, msgCount, onRefresh);

	const list = shadowRoot.querySelector(".list");
	if (!list) return;
	const listEl = list as HTMLElement;
	reconcileList(listEl, orderedRounds, onRefresh);
	if (savedScroll > 0) listEl.scrollTop = savedScroll;
	if (!panel.highlightInitialized && !panel.searchQuery) {
		panel.currentRoundIdx = 0;
		panel.highlightInitialized = true;
		setupScrollHighlight(listEl);
	}
	refreshCurrentHighlight(listEl);
}

/** Re-render from the current store, skipping the work when nothing changed. */
export function renderUI(shadowRoot: ShadowRoot, onRefresh: () => void): void {
	const storeRounds = conversationStore.rounds;
	const msgCount = conversationStore.messages.length;

	const key = renderKey({
		isOpen: panel.isOpen,
		searchQuery: panel.searchQuery,
		reverseOrder: panel.reverseOrder,
		roundIds: storeRounds.map((r) => r.id),
		hiddenRoundIds: Array.from(hiddenRoundIds),
		showHiddenRounds: panel.showHiddenRounds,
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

	if (panel.isOpen)
		renderPanelMode(shadowRoot, storeRounds, msgCount, onRefresh);
	else renderFabMode(shadowRoot, storeRounds);

	syncHostAttributes(storeRounds, msgCount);
}
