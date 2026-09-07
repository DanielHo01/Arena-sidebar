// ui/keyboard.ts — the panel's keyboard shortcuts.
//
// Alt+S toggles the panel from anywhere on the page; the navigation keys only
// work while it is open, and stand aside when focus is in an editable field so
// Arena's own inputs keep their keys.

import type { Disposer } from "../types";
import { panel } from "../state";
import { refreshCurrentHighlight } from "./panel";

// ─── Keyboard shortcuts (C1) ───────────────────────────────────────────────────────────────
// Alt+S        — toggle panel open/close
// ↑ / ↓       — navigate rounds in panel
// Enter        — scroll to selected round
// Esc          — close panel

export function setupKeyboardShortcuts(
	shadowRoot: ShadowRoot,
	refreshUI: () => void,
): Disposer {
	const onKeydown = (e: KeyboardEvent) => {
		// Alt+S — toggle panel (always works)
		if (e.altKey && (e.key === "s" || e.key === "S")) {
			e.preventDefault();
			panel.isOpen = !panel.isOpen;
			refreshUI();
			return;
		}
		if (!panel.isOpen) return;

		// Skip navigation when focus is on an editable element (search, input, etc.)
		const target = e.target as HTMLElement;
		const isEditable =
			target.tagName === "INPUT" ||
			target.tagName === "TEXTAREA" ||
			target.tagName === "SELECT" ||
			target.isContentEditable;

		const listEl = shadowRoot.querySelector(".list");
		if (!listEl) return;
		const list = listEl as HTMLElement;

		// ↑ — previous round
		if (e.key === "ArrowUp") {
			if (isEditable) return; // Sprint 6: don't hijack arrow keys while typing in search
			e.preventDefault();
			panel.currentRoundIdx = Math.max(0, panel.currentRoundIdx - 1);
			refreshCurrentHighlight(list);
			const items = list.querySelectorAll<HTMLElement>(".item");
			items[panel.currentRoundIdx]?.scrollIntoView({ block: "nearest" });
			return;
		}
		// ↓ — next round
		if (e.key === "ArrowDown") {
			if (isEditable) return; // Sprint 6: don't hijack arrow keys while typing in search
			e.preventDefault();
			const items = list.querySelectorAll<HTMLElement>(".item");
			panel.currentRoundIdx = Math.min(
				items.length - 1,
				panel.currentRoundIdx + 1,
			);
			refreshCurrentHighlight(list);
			items[panel.currentRoundIdx]?.scrollIntoView({ block: "nearest" });
			return;
		}
		// Enter — go to selected round (only when not in an input)
		if (e.key === "Enter") {
			if (isEditable) return;
			e.preventDefault();
			const items = list.querySelectorAll<HTMLElement>(".item");
			const selected = items[panel.currentRoundIdx];
			if (selected) {
				selected.click();
			}
			return;
		}
		// Esc — close panel
		if (e.key === "Escape") {
			if (isEditable) return; // Sprint 6: let input's own Esc work (e.g. clear search)
			e.preventDefault();
			panel.isOpen = false;
			refreshUI();
			return;
		}
	};
	document.addEventListener("keydown", onKeydown);
	return () => document.removeEventListener("keydown", onKeydown);
}
