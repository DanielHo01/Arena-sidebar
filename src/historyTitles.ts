// History title editing — double-click on /c/ sidebar links to rename them.
// The custom title is persisted in chrome.storage.local.
//
// Public exports:
//   setupHistoryTitleEditing — scans and binds double-click rename to all /c/ links

import { contextValid, invalidateContext } from "./state";

// ─── Storage key ─────────────────────────────────────────────────────────────────────

function storageKey(sid: string): string {
	return "historyTitle_" + sid;
}

// ─── Apply custom title to an anchor element ─────────────────────────────────────────

function applyCustomTitle(anchor: Element, customTitle: string) {
	const candidates = anchor.querySelectorAll<HTMLElement>("span, div, p");
	let bestCandidate: HTMLElement | null = null;
	let bestLen = 0;
	for (const el of candidates) {
		const t = (el.textContent || "").trim();
		if (t.length > bestLen) {
			bestLen = t.length;
			bestCandidate = el;
		}
	}
	if (bestCandidate !== null) {
		bestCandidate.textContent = customTitle;
	} else {
		anchor.textContent = customTitle;
	}
}

// ─── Main setup ─────────────────────────────────────────────────────────────────────

export function setupHistoryTitleEditing() {
	const items = document.querySelectorAll('a[href*="/c/"]');
	items.forEach((item) => {
		const itemEl = item as HTMLElement;
		const href = item.getAttribute("href") || "";
		const sid = href.match(/\/c\/([^/?]+)/)?.[1];
		if (!sid) return;
		if (itemEl.dataset.aiSidebarEditable === "1") return;
		itemEl.dataset.aiSidebarEditable = "1";
		itemEl.title = (itemEl.title || "") + " | Double-click to rename";

		// Restore previously saved custom title.
		const key = storageKey(sid);
		if (!contextValid) {
			/* skip — extension context was invalidated */
		} else {
			try {
				chrome.storage.local.get(key, (r) => {
					if (chrome.runtime.lastError) {
						invalidateContext();
						return;
					}
					const custom = (r as Record<string, string>)[key];
					if (
						custom &&
						item.textContent &&
						item.textContent.trim() !== custom
					) {
						applyCustomTitle(item, custom);
					}
				});
			} catch (_e) {
				/* chrome.storage.local.get may fail due to quota or context invalidation */
			}
		}

		// Double-click → inline edit.
		itemEl.addEventListener(
			"dblclick",
			(e) => {
				e.preventDefault();
				e.stopPropagation();
				const target =
					(e.target as HTMLElement).closest("span, div, p") || itemEl;
				const oldText = (target.textContent || "").trim();
				const input = document.createElement("input");
				input.type = "text";
				input.value = oldText;
				input.style.cssText =
					"width: 100%; min-width: 0; font: inherit; background: white; border: 1px solid #3b82f6; padding: 2px 4px; border-radius: 3px; color: black;";
				target.textContent = "";
				target.appendChild(input);
				input.focus();
				input.select();

				let saved = false;
				const save = () => {
					if (saved) return;
					saved = true;
					const newText = (input.value || "").trim() || oldText;
					if (contextValid) {
						try {
							chrome.storage.local.set({ [key]: newText }, () => {
								if (chrome.runtime.lastError) {
									invalidateContext();
									return;
								}
							});
						} catch (_e) {
							/* intentionally empty */
						}
					}
					target.textContent = newText;
				};
				const cancel = () => {
					if (saved) return;
					saved = true;
					target.textContent = oldText;
				};
				input.addEventListener("blur", save);
				input.addEventListener("keydown", (ev) => {
					ev.stopPropagation();
					if (ev.key === "Enter") {
						ev.preventDefault();
						input.blur();
					}
					if (ev.key === "Escape") {
						input.removeEventListener("blur", save);
						cancel();
					}
				});
			},
			true,
		);
	});
}
