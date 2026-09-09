// ui/panel/list.ts — diffs the round list against the DOM and patches it.

import type { SidebarRound } from "../../types";
import { hiddenRoundIds } from "../../rounds";
import { panel } from "../../state";
import { detectBattleMode } from "../../platform/arenaDom";
import { getMessagesForRound } from "../../features/roundNav";
import { createRoundEl, updateRoundEl } from "./roundItem";

// ─── List reconciliation ─────────────────────────────────────────────────────────────

export function reconcileList(
	list: HTMLElement,
	rounds: SidebarRound[],
	refreshUI: () => void,
) {
	const byId = new Map<string, HTMLElement>();
	for (const child of [...list.children] as HTMLElement[]) {
		if (child.dataset.roundId) byId.set(child.dataset.roundId, child);
	}

	const q = panel.searchQuery.toLowerCase().trim();
	const hiddenCount = rounds.filter((r) => hiddenRoundIds.has(r.id)).length;
	// Reveal mode keeps hidden rounds in the list, dimmed, with a restore
	// button (roundItem.syncVisibilityUI); otherwise they are filtered out.
	const filtered = rounds
		.filter((r) => panel.showHiddenRounds || !hiddenRoundIds.has(r.id))
		.filter(
			(r) =>
				!q ||
				r.title.toLowerCase().includes(q) ||
				r.userPreview?.toLowerCase().includes(q) ||
				r.assistantPreview?.toLowerCase().includes(q) ||
				// Full-text: the previews are truncated (60/100 chars), so a word
				// buried deeper in a message was unfindable. The || chain
				// short-circuits — content is only scanned for rounds the cheap
				// checks already rejected.
				getMessagesForRound(r.id).some((m) =>
					m.content.toLowerCase().includes(q),
				),
		);

	if (filtered.length === 0) {
		for (const [, el] of byId) el.remove();
		const msg =
			list.querySelector(".empty") ||
			(() => {
				const e = document.createElement("div");
				e.className = "empty";
				list.appendChild(e);
				return e;
			})();
		// Battle mode (#14): extraction understands single-thread chats, not the
		// dual-column battle layout — say so instead of "No messages detected".
		// Only when the store itself is empty: an all-hidden list in a battle is
		// still the generic message plus the restore bar.
		let emptyText: string;
		if (q) {
			emptyText = 'No matches for "' + panel.searchQuery + '"';
		} else if (rounds.length === 0 && detectBattleMode()) {
			emptyText = "⚔️ Battle mode — round navigation isn't supported here yet";
		} else {
			emptyText = "No messages detected";
		}
		msg.textContent = emptyText;
	} else {
		const emptyEl = list.querySelector(".empty");
		if (emptyEl) emptyEl.remove();

		const newIds = new Set(filtered.map((r) => r.id));
		for (const [id, el] of byId) {
			if (!newIds.has(id)) {
				el.remove();
				byId.delete(id);
			}
		}

		filtered.forEach((round, idx) => {
			let el = byId.get(round.id);
			if (!el) {
				el = createRoundEl(round, idx, refreshUI);
			} else {
				updateRoundEl(el, round, idx);
			}
			if (list.children[idx] !== el) {
				list.insertBefore(el, list.children[idx] ?? null);
			}
		});
	}

	// The hidden-rounds footer bar is managed outside round reconciliation: it
	// is never a round row (no dataset.roundId, so byId skips it) and is
	// (re)appended last so rounds always precede it — empty state included,
	// where it is the only remaining way back to a hidden round.
	if (hiddenCount === 0) {
		list.querySelector(".hidden-bar")?.remove();
	} else {
		const bar = ensureHiddenBar(list, refreshUI);
		const noun = hiddenCount === 1 ? "round" : "rounds";
		bar.textContent = panel.showHiddenRounds
			? `${hiddenCount} hidden ${noun} — click to hide again`
			: `${hiddenCount} hidden ${noun} — click to show`;
		bar.title = panel.showHiddenRounds
			? "Stop showing hidden rounds in the list"
			: "Show the hidden rounds in the list";
		if (list.lastElementChild !== bar) list.appendChild(bar);
	}
}

function ensureHiddenBar(
	list: HTMLElement,
	refreshUI: () => void,
): HTMLElement {
	let bar = list.querySelector(".hidden-bar") as HTMLElement | null;
	if (!bar) {
		bar = document.createElement("div");
		bar.className = "hidden-bar";
		bar.onclick = () => {
			panel.showHiddenRounds = !panel.showHiddenRounds;
			refreshUI();
		};
		list.appendChild(bar);
	}
	return bar;
}
