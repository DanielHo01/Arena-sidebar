// core/rounds.ts — pure round grouping.
//
// A "round" is one user turn plus every assistant reply that follows it. This is
// the single source of truth for that grouping: the panel, the FAB badge, the
// export and the summary prompt all read its output, so a bug here shows up
// everywhere at once.
//
// Pure: no DOM, no storage, no store state. Extracted from conversationStore.ts
// in Phase 3 so it can be imported without dragging the store singleton along.

import type { SidebarMessage, SidebarRound } from "../types";

/**
 * A round opened by an assistant message that precedes any user message.
 *
 * It has no user turn, so it doubles as its own preview: the assistant text is
 * shown as the assistant preview and the round carries a single message.
 */
function makeLeadRound(lead: SidebarMessage, index: number): SidebarRound {
	return {
		id: lead.id,
		title: lead.content.slice(0, 80) || "(开场助手消息)",
		messageCount: 1,
		index,
		hasAnchor: !!lead.domId,
		userPreview: undefined,
		assistantPreview: lead.content.slice(0, 100),
		assistantCount: 1,
	};
}

export function computeRounds(msgs: SidebarMessage[]): SidebarRound[] {
	const rounds: SidebarRound[] = [];
	let current: SidebarRound | null = null;
	let pendingLead: SidebarMessage | null = null;
	let roundIdx = 0;
	// Sprint 8: preview tracking
	let currentFirstUser: SidebarMessage | null = null;
	let currentFirstAssistant: SidebarMessage | null = null;
	let currentAssistantCount = 0;

	const pushRound = (r: SidebarRound) => {
		// Sprint 8: fill preview fields before pushing — but never clobber values the
		// caller already set explicitly. The lead-assistant round sets assistantPreview
		// and assistantCount by hand; currentFirst*/currentAssistantCount are still
		// null/0 at that point, so plain assignment used to wipe them back.
		r.userPreview ??= currentFirstUser?.content.slice(0, 60) || undefined;
		r.assistantPreview ??=
			currentFirstAssistant?.content.slice(0, 100) || undefined;
		r.assistantCount ??= currentAssistantCount;
		rounds.push(r);
	};

	for (const msg of msgs) {
		if (msg.role === "assistant" && current === null) {
			// lead assistant (before first user)
			pendingLead = msg;
			continue;
		}
		if (msg.role === "user") {
			// Push previous round
			if (current !== null) {
				pushRound(current);
				roundIdx++;
			} else if (pendingLead) {
				// Lead assistant round — no user, use assistant as preview
				pushRound(makeLeadRound(pendingLead, roundIdx));
				roundIdx++;
			}
			// Start new round with user
			currentFirstUser = msg;
			currentFirstAssistant = null;
			currentAssistantCount = 0;
			current = {
				id: msg.id,
				title: msg.content.slice(0, 80),
				messageCount: 0,
				index: roundIdx,
				hasAnchor: false,
				userPreview: undefined,
				assistantPreview: undefined,
			};
			pendingLead = null;
		}
		if (current !== null) {
			current.messageCount++;
			if (msg.domId) current.hasAnchor = true;
			if (msg.role === "assistant") {
				currentAssistantCount++;
				if (currentFirstAssistant === null) currentFirstAssistant = msg;
			}
		}
	}

	if (current) {
		pushRound(current);
		roundIdx++;
	} else if (pendingLead && rounds.length === 0) {
		// Lead assistant only — no rounds at all
		pushRound(makeLeadRound(pendingLead, 0));
	}

	return rounds;
}
