// Panel — minimal bookmark navigator for Arena sessions.
// Public exports:
//   ensurePanelSkeleton — builds or updates the panel DOM
//   reconcileList       — diffs round list and updates DOM
//   setupScrollHighlight — attaches scroll-based active round tracking
//   refreshCurrentHighlight — applies current-round CSS class

import type { SidebarRound } from "../types";
import { hiddenRoundIds } from "../rounds";
import { scrollToRound } from "../conversationStore";
import { panel } from "../state";
import { UI_STYLES, ICON_X_SVG } from "./styles";

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

export function setupScrollHighlight(list: HTMLElement | null) {
	if (!list) return;
	let ticking = false;
	list.addEventListener("scroll", () => {
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
	});
}

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
			el = createRoundEl(round, idx);
		} else {
			updateRoundEl(el, round, idx);
		}
		if (list.children[idx] !== el) {
			list.insertBefore(el, list.children[idx] ?? null);
		}
	});
}

// ─── Round element — compact mixed outline ─────────────────────────────────────────
// Structure: .round-num | .main-text | .sub-text
// No action buttons — keeps items clean and compact.

function createRoundEl(round: SidebarRound, idx: number): HTMLElement {
	const item = document.createElement("div");
	item.className = "item";
	item.dataset.roundId = round.id;
	item.dataset.roundIdx = String(idx);

	// Round number badge — tiny, muted
	const num = document.createElement("span");
	num.className = "round-num";
	num.textContent = String(idx + 1);
	item.appendChild(num);

	// Main text: userPreview > title > "Round N"
	const main = document.createElement("span");
	main.className = "main-text";
	const mainText =
		round.userPreview?.trim() ||
		round.title?.trim() ||
		`Round ${idx + 1}`;
	main.textContent = mainText;
	main.title = mainText;
	item.appendChild(main);

	// Sub text: assistant preview (muted secondary line)
	const sub = document.createElement("span");
	sub.className = "sub-text";
	if (round.assistantPreview) {
		const prefix =
			round.assistantCount && round.assistantCount > 1
				? `${round.assistantCount} replies · `
				: "";
		sub.textContent = prefix + round.assistantPreview;
		sub.title = round.assistantPreview;
	} else {
		sub.textContent = "Waiting…";
		sub.title = "Waiting for response…";
	}
	item.appendChild(sub);

	// Click to jump
	item.onclick = () => {
		scrollToRound(round.id);
		panel.currentRoundIdx = idx;
	};

	return item;
}

function updateRoundEl(el: HTMLElement, round: SidebarRound, idx: number) {
	// Round number
	const numEl = el.querySelector(".round-num");
	if (numEl) numEl.textContent = String(idx + 1);

	// Main text
	const mainEl = el.querySelector(".main-text") as HTMLElement | null;
	if (mainEl) {
		const mainText =
			round.userPreview?.trim() ||
			round.title?.trim() ||
			`Round ${idx + 1}`;
		mainEl.textContent = mainText;
		mainEl.title = mainText;
	}

	// Sub text
	const subEl = el.querySelector(".sub-text") as HTMLElement | null;
	if (subEl) {
		if (round.assistantPreview) {
			const prefix =
				round.assistantCount && round.assistantCount > 1
					? `${round.assistantCount} replies · `
					: "";
			subEl.textContent = prefix + round.assistantPreview;
			subEl.title = round.assistantPreview;
		} else {
			subEl.textContent = "Waiting…";
			subEl.title = "Waiting for response…";
		}
	}

	el.dataset.roundIdx = String(idx);
}

// ─── Panel skeleton — minimal header ─────────────────────────────────────────────

export function ensurePanelSkeleton(
	shadowRoot: ShadowRoot,
	roundsCount: number,
	_messagesCount: number,
	refreshUI: () => void,
): HTMLElement {
	let panelEl = shadowRoot.querySelector(".panel") as HTMLElement | null;
	if (panelEl) {
		const titleEl = panelEl.querySelector(".panel-title");
		if (titleEl) titleEl.textContent = roundsCount + " rounds";
		return panelEl;
	}

	panelEl = document.createElement("div");
	panelEl.className = "panel";
	panelEl.setAttribute("data-ai-sidebar-panel", "1");

	// Minimal header: title + ghost close
	const header = document.createElement("div");
	header.className = "header";

	const title = document.createElement("span");
	title.className = "panel-title";
	title.textContent = roundsCount + " rounds";
	header.appendChild(title);

	// Ghost close — barely visible until hovered
	const closeBtn = document.createElement("button");
	closeBtn.className = "close-btn";
	closeBtn.setAttribute("aria-label", "Close");
	const xParser = new DOMParser();
	const xDoc = xParser.parseFromString(ICON_X_SVG, "image/svg+xml");
	const xSvg = xDoc.documentElement as unknown as SVGElement;
	if (xSvg) closeBtn.appendChild(xSvg);
	closeBtn.onclick = () => {
		panel.isOpen = false;
		refreshUI();
	};
	header.appendChild(closeBtn);
	panelEl.appendChild(header);

	// Compact search
	const searchInput = document.createElement("input");
	searchInput.className = "search-input";
	searchInput.type = "text";
	searchInput.placeholder = "Search…";
	searchInput.oninput = () => {
		panel.searchQuery = searchInput.value.toLowerCase().trim();
		refreshUI();
	};
	panelEl.appendChild(searchInput);

	// List container
	const list = document.createElement("div");
	list.className = "list";
	panelEl.appendChild(list);

	shadowRoot.appendChild(panelEl);
	return panelEl;
}

// ─── Ensure styles are injected ──────────────────────────────────────────────────────────

export function ensureStyles(shadowRoot: ShadowRoot) {
	if (shadowRoot.querySelector("style")) return;
	const s = document.createElement("style");
	s.textContent = UI_STYLES;
	shadowRoot.appendChild(s);
}
