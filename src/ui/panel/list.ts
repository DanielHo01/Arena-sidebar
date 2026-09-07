// ui/panel/list.ts — diffs the round list against the DOM and patches it.

import type { SidebarRound } from "../../types";
import { hiddenRoundIds } from "../../rounds";
import { panel } from "../../state";
import { createRoundEl, updateRoundEl } from "./roundItem";

// ─── List reconciliation ─────────────────────────────────────────────────────────────

export function reconcileList(
	list: HTMLElement,
	rounds: SidebarRound[],
	_refreshUI: () => void, // eslint-disable-line @typescript-eslint/no-unused-vars
) {
	const byId = new Map<string, HTMLElement>();
	for (const child of [...list.children] as HTMLElement[]) {
		if (child.dataset.roundId) byId.set(child.dataset.roundId, child);
	}

	const q = panel.searchQuery.toLowerCase().trim();
	const filtered = rounds
		.filter((r) => !hiddenRoundIds.has(r.id))
		.filter(
			(r) =>
				!q ||
				r.title.toLowerCase().includes(q) ||
				r.userPreview?.toLowerCase().includes(q) ||
				r.assistantPreview?.toLowerCase().includes(q),
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
		msg.textContent = q
			? 'No matches for "' + panel.searchQuery + '"'
			: "No messages detected";
		return;
	}
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
			el = createRoundEl(round, idx, _refreshUI);
		} else {
			updateRoundEl(el, round, idx);
		}
		if (list.children[idx] !== el) {
			list.insertBefore(el, list.children[idx] ?? null);
		}
	});
}
