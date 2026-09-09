// app/store.ts — the single owner of application lifecycle.
//
// Before this module, session state lived in 18 module-level `let`s plus several
// mutable singletons, and `content.ts` had a private resetSessionState() that
// reset some of it. Eight values were reset by nobody:
//
//   capture.lastRequestTs / lastResponseTs / pendingRequests / chatRounds
//   historyTitles.titleCache / cacheLoaded
//   folders.librarySectionOpen
//   fab.prevRoundIds / panel.searchQuery
//
// Two of those caused user-visible bugs. `pendingRequests` kept the previous
// session's unfinished request alive, so the new session's first response paired
// against it and cross-bound two conversations. `fab.prevRoundIds` kept the old
// round list, so refreshUI's fast path concluded "nothing changed" and skipped
// the new session's first render entirely.
//
// Everything resettable now goes through resetSessionState(sessionId). The rule
// this file enforces: if a value is session-scoped, it is listed here. Adding
// session state anywhere else is the bug pattern this phase removed.

import type { Disposer } from "../types";
import { resetCaptureState, resetRscState } from "../capture";
import { cachedElements, panel } from "../state";
import { conversationStore } from "../conversationStore";
import { resetExtractState } from "../extract";
import { resetPreScroll } from "../features/prescroll";
import { resetLibrarySection } from "../ui/arenaSidebar";
import { resetDeletedMessages, resetHiddenRounds } from "../rounds";

/**
 * Clear all session-scoped state and adopt `sessionId`.
 *
 * Deliberately does NOT clear:
 *   - fab.position     — persisted across sessions
 *   - panel.reverseOrder — a user preference, not session data
 *   - modelNameById    — page-scoped; re-harvesting costs a full script scan
 *   - foldersState     — the persisted folder/session index
 *   - timers, observer, shadowRoot — owned by content.ts's bootstrap
 */
export function resetSessionState(sessionId: string): void {
	conversationStore.reset();
	conversationStore.sessionId = sessionId;

	cachedElements.clear();
	resetExtractState();
	resetPreScroll();
	resetCaptureState();
	resetRscState();
	resetLibrarySection();
	resetHiddenRounds();
	resetDeletedMessages();

	panel.currentRoundIdx = 0;
	panel.highlightInitialized = false;
	panel.searchQuery = "";
	// A new conversation starts with hidden rounds hidden — reveal mode is a
	// view state tied to the session being browsed, like the search query.
	panel.showHiddenRounds = false;
	// Force the first render after a route change: the key describes the old
	// session's rounds, and leaving it would let the fast path skip the render
	// entirely (the fab.prevRoundIds bug, one level up).
	panel.lastRenderKey = "";
	// /c/ routes default to an open panel; capture mode does not.
	panel.isOpen = sessionId !== "";
}

// ─── Disposer registry ────────────────────────────────────────────────────────────
//
// Every setup* that attaches a listener or starts a timer hands its teardown
// back here, so content.ts has one place to tear the whole extension down. A
// disposer that throws is logged and skipped: one bad teardown must not strand
// the rest.

const disposers = new Set<Disposer>();

/**
 * Register a teardown. Returns a handle that removes just this one, which is
 * what a setup function should return to its own caller.
 */
export function registerDisposer(disposer: Disposer): Disposer {
	disposers.add(disposer);
	return () => {
		disposers.delete(disposer);
	};
}

/** Run every registered disposer, then forget them. Safe to call twice. */
export function disposeAll(): void {
	const pending = Array.from(disposers);
	disposers.clear();
	for (const dispose of pending) {
		try {
			dispose();
		} catch (error) {
			console.warn("[AI Sidebar] disposer threw:", error);
		}
	}
}
