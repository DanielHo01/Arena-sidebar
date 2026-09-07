// ui/panel/roundItem.ts — renders one row of the round list.
//
// Exported for ui/panel/list.ts, which is the only caller.

import type { SidebarRound } from "../../types";
import { hiddenRoundIds, persistHiddenRounds } from "../../rounds";
import { getMessagesForRound, scrollToRound } from "../../features/roundNav";
import { panel } from "../../state";
import { isSessionRoute } from "../../platform/route";
import { copyText } from "../../platform/clipboard";

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
		if (!txt) return;
		// copyText never rejects and reports whether the write really happened,
		// so a denied permission no longer shows a success tick.
		void copyText(txt).then((ok) => {
			copyBtn.textContent = ok ? "✅" : "⚠️";
			copyBtn.title = ok
				? "Copied"
				: "Copy failed — check clipboard permission";
			setTimeout(() => {
				copyBtn.textContent = "📋";
				copyBtn.title = "Copy round content";
			}, 1200);
		});
	};

	// Hide / restore button. In normal mode this is ✕; in reveal mode (or any
	// state where a hidden round is rendered) it becomes ↩, restoring the round.
	// The click handler reads the live set, so one handler serves both roles.
	const visibilityBtn = document.createElement("button");
	visibilityBtn.className = "item-action item-visibility";
	visibilityBtn.onclick = (e) => {
		e.stopPropagation();
		if (hiddenRoundIds.has(round.id)) hiddenRoundIds.delete(round.id);
		else hiddenRoundIds.add(round.id);
		persistHiddenRounds();
		refreshUI();
	};

	actions.appendChild(copyBtn);
	actions.appendChild(visibilityBtn);
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
	syncVisibilityUI(item, round.id);

	const isCharacterChat = isSessionRoute(location.pathname);
	item.onclick = () => {
		scrollToRound(round.id);
		panel.currentRoundIdx = idx;
		if (!isCharacterChat) panel.isOpen = false;
		refreshUI();
	};

	return item;
}

// ─── Hidden-round visibility ────────────────────────────────────────────────────────

/**
 * Sync one row's hidden-round affordances with the live set: the dimmed
 * .item-hidden style and the ✕ / ↩ button. Called on create and from
 * updateRoundEl — in reveal mode a row stays in the list when its flag
 * flips, so the existing element must be updated in place.
 */
function syncVisibilityUI(el: HTMLElement, roundId: string): void {
	const hidden = hiddenRoundIds.has(roundId);
	el.classList.toggle("item-hidden", hidden);
	const btn = el.querySelector(".item-visibility") as HTMLElement | null;
	if (btn) {
		btn.textContent = hidden ? "↩" : "✕";
		btn.title = hidden ? "Restore this round" : "Hide this round";
	}
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
	syncVisibilityUI(el, round.id);
}
