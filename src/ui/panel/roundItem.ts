// ui/panel/roundItem.ts — renders one row of the round list.
//
// Exported for ui/panel/list.ts, which is the only caller.

import type { SidebarRound } from "../../types";
import { hiddenRoundIds } from "../../rounds";
import { getMessagesForRound, scrollToRound } from "../../features/roundNav";
import { panel } from "../../state";
import { isSessionRoute } from "../../platform/route";

// ─── Round element ──────────────────────────────────────────────────────────────────

// Sprint 4: DeepSeek-style round item — .item-meta (label + actions) + .item-title
export function createRoundEl(
	round: SidebarRound,
	idx: number,
	refreshUI: () => void,
): HTMLElement {
	const item = document.createElement("div");
	item.className = "item";
	item.dataset.roundId = round.id;
	item.dataset.roundIdx = String(idx);

	const currentTitle = round.title;

	// .item-meta: label + hover actions
	const meta = document.createElement("div");
	meta.className = "item-meta";

	const metaLabel = document.createElement("span");
	metaLabel.className = "item-meta-label";
	// Sprint 8: show assistantCount when > 1
	const metaLabelText =
		round.assistantCount && round.assistantCount > 1
			? `Round ${idx + 1} · ${round.assistantCount} responses`
			: `Round ${idx + 1}`;
	metaLabel.textContent = metaLabelText;

	const actions = document.createElement("span");
	actions.className = "item-actions";

	// Copy button
	const copyBtn = document.createElement("button");
	copyBtn.className = "item-action";
	copyBtn.textContent = "📋";
	copyBtn.title = "Copy round content";
	copyBtn.onclick = (e) => {
		e.stopPropagation();
		const roundMsgs = getMessagesForRound(round.id);
		const txt = roundMsgs.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
		if (txt)
			navigator.clipboard.writeText(txt).then(() => {
				copyBtn.textContent = "✅";
				setTimeout(() => {
					copyBtn.textContent = "📋";
				}, 1200);
			});
	};

	// Hide button
	const hideBtn = document.createElement("button");
	hideBtn.className = "item-action";
	hideBtn.textContent = "✕";
	hideBtn.title = "Hide this round";
	hideBtn.onclick = (e) => {
		e.stopPropagation();
		hiddenRoundIds.add(round.id);
		refreshUI();
	};

	actions.appendChild(copyBtn);
	actions.appendChild(hideBtn);
	meta.appendChild(metaLabel);
	meta.appendChild(actions);

	// .item-title — primary text (userPreview, with title as fallback)
	const title = document.createElement("div");
	title.className = "item-title";
	title.textContent = currentTitle;
	title.title = currentTitle;

	// Sprint 8: .item-assistant-preview
	const assistantPreview = document.createElement("div");
	assistantPreview.className = "item-assistant-preview";
	if (round.assistantPreview) {
		const prefix =
			round.assistantCount && round.assistantCount > 1
				? `${round.assistantCount} responses · `
				: "";
		assistantPreview.textContent = prefix + round.assistantPreview;
		assistantPreview.title = round.assistantPreview;
	} else {
		// No assistant yet — show generating placeholder
		assistantPreview.textContent = "Generating…";
		assistantPreview.title = "Waiting for assistant response…";
	}

	item.appendChild(meta);
	item.appendChild(title);
	item.appendChild(assistantPreview);

	const isCharacterChat = isSessionRoute(location.pathname);
	item.onclick = () => {
		scrollToRound(round.id);
		panel.currentRoundIdx = idx;
		if (!isCharacterChat) panel.isOpen = false;
		refreshUI();
	};

	return item;
}

// Sprint 4/8: updateRoundEl for .item-meta + .item-title + .item-assistant-preview
export function updateRoundEl(
	el: HTMLElement,
	round: SidebarRound,
	idx: number,
) {
	const metaLabel = el.querySelector(".item-meta-label");
	if (metaLabel) {
		const metaLabelText =
			round.assistantCount && round.assistantCount > 1
				? `Round ${idx + 1} · ${round.assistantCount} responses`
				: `Round ${idx + 1}`;
		metaLabel.textContent = metaLabelText;
	}
	const title = el.querySelector(".item-title") as HTMLElement | null;
	if (title) {
		const currentTitle = round.title;
		title.textContent = currentTitle;
		title.title = currentTitle;
	}
	// Sprint 8: update assistant preview
	const assistantEl = el.querySelector(
		".item-assistant-preview",
	) as HTMLElement | null;
	if (assistantEl) {
		if (round.assistantPreview) {
			const prefix =
				round.assistantCount && round.assistantCount > 1
					? `${round.assistantCount} responses · `
					: "";
			assistantEl.textContent = prefix + round.assistantPreview;
			assistantEl.title = round.assistantPreview;
		} else {
			assistantEl.textContent = "Generating…";
			assistantEl.title = "Waiting for assistant response…";
		}
	}
	el.dataset.roundIdx = String(idx);
}
