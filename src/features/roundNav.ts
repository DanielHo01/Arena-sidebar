// features/roundNav.ts — navigation between rounds: scroll a round's DOM anchor
// into view, and read back the messages that belong to a round.

import type { SidebarMessage } from "../types";
import { cachedElements } from "../state";
import { conversationStore, rebuildRounds } from "../conversationStore";
import { baseKey } from "../core/fingerprint";
import {
	deletedMessageKeys,
	persistDeletedMessages,
	tombstoneKey,
} from "../rounds";

// ─── Scroll to round: navigate to the round's DOM anchor ─────────────────────────

export function scrollToRound(roundId: string): boolean {
	const msg = conversationStore.messages.find((m) => m.id === roundId);
	if (!msg) return false;

	// Try direct DOM id first.
	if (msg.domId) {
		const el = cachedElements.get(msg.domId);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
			(el as HTMLElement).classList.add("ai-sidebar-flash");
			setTimeout(
				() => (el as HTMLElement).classList.remove("ai-sidebar-flash"),
				1500,
			);
			return true;
		}
	}

	// Try page-level query.
	const el = document.querySelector(
		'[data-ai-sidebar-id="' + CSS.escape(msg.domId || msg.id) + '"]',
	);
	if (el) {
		el.scrollIntoView({ behavior: "smooth", block: "start" });
		(el as HTMLElement).classList.add("ai-sidebar-flash");
		setTimeout(
			() => (el as HTMLElement).classList.remove("ai-sidebar-flash"),
			1500,
		);
		return true;
	}

	return false;
}

/**
 * Return all messages belonging to the given roundId.
 * Reads from conversationStore.rounds to find the round boundaries,
 * then slices conversationStore.messages accordingly.
 */
export function getMessagesForRound(roundId: string): SidebarMessage[] {
	const rounds = conversationStore.rounds;
	const idx = rounds.findIndex((r) => r.id === roundId);
	if (idx < 0) return [];
	const round = rounds[idx];
	if (!round) return [];
	const startMsgIdx = conversationStore.messages.findIndex(
		(m) => m.id === round.id,
	);
	if (startMsgIdx < 0) return [];
	// No next round means "to the end". A next round whose message cannot be found
	// keeps findIndex's -1, matching the previous behaviour.
	const nextRound = rounds[idx + 1];
	const endIdx = nextRound
		? conversationStore.messages.findIndex((m) => m.id === nextRound.id)
		: conversationStore.messages.length;
	return conversationStore.messages.slice(
		startMsgIdx,
		endIdx > startMsgIdx ? endIdx : conversationStore.messages.length,
	);
}

// ─── Local round delete (#15) ─────────────────────────────────────────────────
//
// Hard delete: the round's messages leave the store and their fingerprints are
// tombstoned (rounds.ts) so the next DOM re-extract cannot resurrect them.
// Unlike ✕ hide there is no restore — the UI arms the button first (two
// clicks) instead. Extension-visible only; arena.ai itself is never touched.

/**
 * Delete every message of `roundId` from the store. Returns false when the
 * round has no messages (unknown id, or already deleted).
 */
export function deleteRound(roundId: string): boolean {
	const msgs = getMessagesForRound(roundId);
	if (msgs.length === 0) return false;
	for (const m of msgs) {
		deletedMessageKeys.add(tombstoneKey(baseKey(m), m.occurrence ?? 0));
	}
	persistDeletedMessages();
	const ids = new Set(msgs.map((m) => m.id));
	conversationStore.messages = conversationStore.messages.filter(
		(m) => !ids.has(m.id),
	);
	rebuildRounds();
	void conversationStore.saveToStorage();
	return true;
}
