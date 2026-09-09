// ui/panel/roundItem.ts — renders one row of the round list.
//
// Exported for ui/panel/list.ts, which is the only caller.

import type { SidebarRound } from "../../types";
import { hiddenRoundIds, persistHiddenRounds } from "../../rounds";
import {
	deleteRound,
	getMessagesForRound,
	scrollToRound,
} from "../../features/roundNav";
import { editMessageContent } from "../../conversationStore";
import { panel } from "../../state";
import { isSessionRoute } from "../../platform/route";
import { copyText } from "../../platform/clipboard";
import { beginInlineRename } from "../inlineRename";

// ─── Round element ──────────────────────────────────────────────────────────────────

/**
 * The row's meta label: number, response count, edited marker. One helper for
 * both create and update so the two cannot drift (they were duplicated text
 * before #15 added the third segment). Reads the precomputed round fields —
 * scanning messages per row would turn every render into O(rows × messages).
 */
function roundMetaLabel(round: SidebarRound, idx: number): string {
	const parts = [`Round ${idx + 1}`];
	if (round.assistantCount && round.assistantCount > 1) {
		parts.push(`${round.assistantCount} responses`);
	}
	if (round.edited) {
		parts.push("✏️ edited");
	}
	return parts.join(" · ");
}

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
	metaLabel.textContent = roundMetaLabel(round, idx);

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

	// #15: edit the round's user message in place. Single-line editor shared
	// with session rename: Enter commits, Escape cancels. Long prompts scroll
	// horizontally inside it — a textarea editor is future work if this proves
	// too cramped. Hidden for rounds without a user turn (lead-assistant).
	const editBtn = document.createElement("button");
	editBtn.className = "item-action item-edit";
	editBtn.textContent = "✏️";
	editBtn.title = "Edit your message (navigator only — arena.ai is untouched)";
	// Missing on legacy payloads reads as "has one" — the click then no-ops.
	if (round.hasUserTurn === false) {
		editBtn.style.display = "none";
	}
	editBtn.onclick = (e) => {
		e.stopPropagation();
		const userMsg = getMessagesForRound(round.id).find(
			(m) => m.role === "user",
		);
		const titleEl = item.querySelector(".item-title");
		if (!userMsg || !titleEl) return;
		beginInlineRename({
			target: titleEl,
			initial: userMsg.content,
			onCommit: (text) => {
				if (editMessageContent(userMsg.id, text)) refreshUI();
			},
			// The title shows truncated text; without a re-render a cancel
			// would leave the full untruncated content in the row.
			onCancel: () => refreshUI(),
		});
	};

	// #15: hard delete. Unlike ✕ hide there is no restore — the tombstone
	// keeps re-extracts from resurrecting the round — so the first click only
	// arms, and the arm expires after 3s.
	const DELETE_TITLE =
		"Delete this round from the navigator (permanent — arena.ai is untouched)";
	const deleteBtn = document.createElement("button");
	deleteBtn.className = "item-action item-delete";
	deleteBtn.textContent = "🗑️";
	deleteBtn.title = DELETE_TITLE;
	let armed = false;
	let disarmTimer = 0;
	deleteBtn.onclick = (e) => {
		e.stopPropagation();
		if (!armed) {
			armed = true;
			deleteBtn.textContent = "❓";
			deleteBtn.title = "Click again to delete permanently";
			disarmTimer = window.setTimeout(() => {
				armed = false;
				deleteBtn.textContent = "🗑️";
				deleteBtn.title = DELETE_TITLE;
			}, 3000);
			return;
		}
		window.clearTimeout(disarmTimer);
		if (deleteRound(round.id)) refreshUI();
	};

	actions.appendChild(copyBtn);
	actions.appendChild(visibilityBtn);
	actions.appendChild(editBtn);
	actions.appendChild(deleteBtn);
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
		metaLabel.textContent = roundMetaLabel(round, idx);
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
