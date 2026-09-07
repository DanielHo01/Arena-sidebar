// app/loop.ts — the reactive half of the extension: how it notices that
// something changed and decides to re-render.
//
// Three triggers feed one decision:
//   startDomLoop       MutationObserver on the chat container, debounced 800ms
//   startPeriodicLoop  2s capture poll and a 30s DOM re-scan
//   route change       detected inside the DOM loop via routeKey()
//
// Split out of content.ts in Phase 5. The two functions that own rendered output
// (refreshUI, rebuildForCurrentRoute) stay in content.ts and are passed in as
// hooks, so this module never imports the assembler and the dependency stays
// one-way.

import type { Disposer } from "../types";
import { panel, timers } from "../state";
import { conversationStore, refreshStore } from "../conversationStore";
import { extractMessages } from "../extract";
import { pollCaptures } from "../capture";
import { isPreScrollActive, startPreScroll } from "../features/prescroll";
import { resetSessionState as appResetSessionState } from "./store";
import {
	ensureArenaFolderEntry,
	toggleArenaSessionLibrarySection,
} from "../ui/arenaSidebar";
import { setupHistoryContextMenu } from "../ui/contextMenu";
import { setupHistoryTitleEditing } from "../historyTitles";
import { getSessionId, routeKey } from "../platform/route";
import { SCROLL_CONTAINER_SELECTOR } from "../platform/arenaDom";

/** What the loop calls when it decides something must happen. */
export interface LoopHooks {
	/** Re-render the panel/FAB from the current store. */
	refreshUI: () => void;
	/** Restore + re-extract the store for the current route. */
	rebuildForCurrentRoute: () => Promise<void>;
}

let lastRouteKey = "";
/** Sprint 3.1: skip the debounce on the first render so the panel appears at once. */
let isFirstRender = true;

let observer: MutationObserver | null = null;

/** Seed the route key from the current location. Call once at bootstrap. */
export function initRouteState(): void {
	lastRouteKey = routeKey(location.pathname, location.search);
}

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

/** React to a detected route change: reset, re-inject, reload, rebuild. */
function handleRouteChange(hooks: LoopHooks): void {
	resetSessionState();
	isFirstRender = true; // route change → next render should be immediate
	// Phase 10A: re-inject Arena sidebar entries on route change.
	ensureArenaFolderEntry(() => toggleArenaSessionLibrarySection());
	setupHistoryContextMenu();
	// Phase 1: force-load the new session's virtualised history before
	// rebuilding. Previously this path called rebuildForCurrentRoute() directly
	// and preScrollDone stayed true from bootstrap, so a switched-to session only
	// ever showed the ~8 messages Arena had rendered.
	void startPreScroll(() => {
		void hooks.rebuildForCurrentRoute();
		hooks.refreshUI();
	});
}

/**
 * Watch the chat container and re-render when it settles.
 *
 * P2: observes only the chat container, not the whole document.body. Cascade
 * fallback precise → main → body, so a structural change in Arena still lands.
 */
export function startDomLoop(hooks: LoopHooks): Disposer {
	if (observer) observer.disconnect();
	observer = new MutationObserver(() => {
		if (panel.isDragging) return;
		if (timers.debounce !== null) clearTimeout(timers.debounce);
		// P4: 800ms debounce — Arena typing causes dense characterData mutations;
		// 250ms was too short and stacked multiple extract rebuilds.
		timers.debounce = setTimeout(() => {
			if (panel.isDragging || isPreScrollActive()) return;

			// Sprint 3.2: detect route change and rebuild store.
			const nextKey = routeKey(location.pathname, location.search);
			if (nextKey !== lastRouteKey) handleRouteChange(hooks);

			setupHistoryTitleEditing(); // re-bind on every DOM change (SPA lazy load)

			if (isFirstRender) {
				isFirstRender = false;
				hooks.refreshUI(); // instant on first render — no debounce wait
				return;
			}
			if (timers.debounce !== null) clearTimeout(timers.debounce);
			timers.debounce = setTimeout(() => {
				isFirstRender = false;
				hooks.refreshUI();
			}, 800);
		}, 800);
	});
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

/** 2s capture poll + 30s DOM re-scan, both paused while the user drags. */
export function startPeriodicLoop(hooks: LoopHooks): Disposer {
	if (timers.pollInterval !== null || timers.refreshInterval !== null) {
		return () => {};
	}
	timers.pollInterval = setInterval(() => {
		if (!panel.isDragging) pollCaptures();
	}, 2000);
	timers.refreshInterval = setInterval(() => {
		if (panel.isDragging) return;
		const prevCount = conversationStore.messages.length;
		const domMsgs = extractMessages();
		refreshStore({ dom: domMsgs, bindAnchors: false });
		hooks.refreshUI();
		// Sprint 5: persist only when new messages arrived — writing the full
		// session payload every 30s (even when idle) caused avoidable churn.
		if (conversationStore.messages.length !== prevCount) {
			void conversationStore.saveToStorage();
		}
	}, 30000);
	return () => {
		if (timers.pollInterval !== null) clearInterval(timers.pollInterval);
		if (timers.refreshInterval !== null) clearInterval(timers.refreshInterval);
		timers.pollInterval = null;
		timers.refreshInterval = null;
	};
}
