// ui/panel/highlight.ts — which round is currently in view.
//
// Split out of the 413-line ui/panel.ts in Phase 5. The panel's four concerns
// (scroll tracking, list diffing, row rendering, skeleton) now live in
// ui/panel/*; ui/panel.ts re-exports them so importers are unchanged.

import type { Disposer } from "../../types";
import { panel } from "../../state";

// ─── Scroll highlight ──────────────────────────────────────────────────────────────────────

export function refreshCurrentHighlight(list: HTMLElement | null) {
	if (!list) return;
	for (const item of list.querySelectorAll(".item")) {
		(item as HTMLElement).classList.toggle(
			"current",
			parseInt((item as HTMLElement).dataset.roundIdx || "-1", 10) ===
				panel.currentRoundIdx,
		);
	}
}

export function setupScrollHighlight(
	list: HTMLElement | null,
): Disposer | undefined {
	if (!list) return undefined;
	let ticking = false;
	const onScroll = () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			const items = list.querySelectorAll(".item");
			let bestIdx = panel.currentRoundIdx;
			let bestArea = 0;
			const lr = list.getBoundingClientRect();
			items.forEach((item) => {
				const ir = item.getBoundingClientRect();
				const overlap =
					Math.min(ir.bottom, lr.bottom) - Math.max(ir.top, lr.top);
				if (overlap > bestArea) {
					bestArea = overlap;
					bestIdx = parseInt((item as HTMLElement).dataset.roundIdx || "0", 10);
				}
			});
			if (bestIdx !== panel.currentRoundIdx) {
				panel.currentRoundIdx = bestIdx;
				refreshCurrentHighlight(list);
			}
			ticking = false;
		});
	};
	list.addEventListener("scroll", onScroll);
	return () => list.removeEventListener("scroll", onScroll);
}
