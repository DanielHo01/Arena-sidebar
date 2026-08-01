// Round grouping — groups SidebarMessage[] into SidebarRound[] for the sidebar list.
// Public exports:
//   roundSummaries     — Map<roundId, { title, summary }>  (user edits)
//   hiddenRoundIds     — Set<roundId>  (hidden by user)
//   groupIntoRounds    — main grouping function
//   scrollToMessage    — scroll to message + flash highlight

import type { SidebarMessage, SidebarRound } from "./types";
import { cachedElements } from "./state";

// ─── User-managed state ────────────────────────────────────────────────────────────

export const roundSummaries = new Map<
	string,
	{ title: string; summary: string }
>();
export const hiddenRoundIds = new Set<string>();

// ─── Grouping ────────────────────────────────────────────────────────────────────

export function groupIntoRounds(messages: SidebarMessage[]): SidebarRound[] {
	const rounds: SidebarRound[] = [];
	let current: SidebarRound | null = null;
	let pendingLeadAssistant: SidebarMessage | null = null;
	let idx = 0;
	// Sprint 8: preview tracking
	let currentFirstUser: SidebarMessage | null = null;
	let currentFirstAssistant: SidebarMessage | null = null;
	let currentAssistantCount = 0;

	const pushRound = (r: SidebarRound) => {
		r.userPreview = currentFirstUser?.content.slice(0, 60) || undefined;
		r.assistantPreview =
			currentFirstAssistant?.content.slice(0, 100) || undefined;
		r.assistantCount = currentAssistantCount;
		rounds.push(r);
	};

	for (const msg of messages) {
		if (msg.role === "assistant" && current === null) {
			pendingLeadAssistant = msg;
			continue;
		}
		if (msg.role === "user") {
			if (current !== null) {
				pushRound(current);
				idx++;
			} else if (pendingLeadAssistant) {
				const leadRound: SidebarRound = {
					id: pendingLeadAssistant.id,
					title: pendingLeadAssistant.content.slice(0, 80) || "(开场助手消息)",
					messageCount: 1,
					index: idx,
					hasAnchor: false,
					userPreview: undefined,
					assistantPreview: pendingLeadAssistant.content.slice(0, 100),
					assistantCount: 1,
				};
				pushRound(leadRound);
				idx++;
			}
			currentFirstUser = msg;
			currentFirstAssistant = null;
			currentAssistantCount = 0;
			current = {
				id: msg.id,
				title: msg.content.slice(0, 80),
				messageCount: 0,
				index: idx,
				hasAnchor: false,
				userPreview: undefined,
				assistantPreview: undefined,
				assistantCount: 0,
			};
			pendingLeadAssistant = null;
		}
		if (current !== null) {
			current.messageCount++;
			if (msg.role === "assistant") {
				currentAssistantCount++;
				if (currentFirstAssistant === null) currentFirstAssistant = msg;
			}
		}
	}
	if (current) {
		pushRound(current);
		idx++;
	} else if (pendingLeadAssistant && rounds.length === 0) {
		const leadRound: SidebarRound = {
			id: pendingLeadAssistant.id,
			title: pendingLeadAssistant.content.slice(0, 80) || "(开场助手消息)",
			messageCount: 1,
			index: 0,
			hasAnchor: false,
			userPreview: undefined,
			assistantPreview: pendingLeadAssistant.content.slice(0, 100),
			assistantCount: 1,
		};
		pushRound(leadRound);
	}
	return rounds;
}

// ─── Scroll to message ───────────────────────────────────────────────────────────

export function scrollToMessage(id: string) {
	const el =
		cachedElements.get(id) ??
		document.querySelector('[data-ai-sidebar-id="' + CSS.escape(id) + '"]');
	if (!el) return;
	el.scrollIntoView({ behavior: "smooth", block: "start" });
	el.classList.add("ai-sidebar-flash");
	window.setTimeout(() => el?.classList.remove("ai-sidebar-flash"), 1500);
}
