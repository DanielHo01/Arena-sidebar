// History title editing — double-click on /c/ sidebar links to rename them.
// The custom title is persisted via platform/storage.ts.
//
// Public exports:
//   setupHistoryTitleEditing — scans and binds double-click rename to all /c/ links

import { getSessionMeta, setSessionCustomTitle } from "./features/sessions";
import { resolveSessionTitle } from "./titleResolver";
import { sessionIdFromHref } from "./platform/route";
import { queryHistoryLinks } from "./platform/arenaDom";
import type { Disposer } from "./types";

// ─── Storage key ─────────────────────────────────────────────────────────────────────
// DEPRECATED: historyTitle_ keys are no longer the canonical title store.
// Migration: see migrateHistoryTitles() in folders.ts (H5). Writes now go to
// foldersState.sessions via setSessionCustomTitle; reads go to the same index.

// ─── No title cache ──────────────────────────────────────────────────────────────────
// This module used to keep a `titleCache` Map in front of foldersState, on the
// stated grounds that restoreTitle() would otherwise O(N) scan foldersState on
// every DOM mutation. That premise was false: getSessionMeta() is a single
// Map.get, so the cache saved one lookup and a few trim() calls per link.
//
// What it cost was a whole class of staleness bug. The cache was only written by
// the double-click save path; the context-menu rename wrote foldersState and the
// link's DOM but not the cache, and restoreTitle() trusted the cache first. Since
// app/loop.ts re-runs setupHistoryTitleEditing() on every debounced mutation, the
// stale entry reverted a context-menu rename a few hundred ms after the user made
// it. Reading foldersState directly makes that unrepresentable: there is exactly
// one title store, so there is nothing to fall out of sync.
//
// Removing it also removed resetTitleCache() from the session-reset list in
// app/store.ts — one fewer residual state to remember to clear.

// ─── Apply custom title to an anchor element ─────────────────────────────────────────
// Only rewrites text, never replaces element structure: overwriting anchor.textContent
// would destroy React-rendered children (spans, svg) and trigger an infinite
// re-render loop with Arena's virtual DOM.

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
		return;
	}
	// No structural child found — rewrite the longest text node in place.
	let bestTextNode: Text | null = null;
	bestLen = 0;
	const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const t = (node.textContent || "").trim();
		if (t.length > bestLen) {
			bestLen = t.length;
			bestTextNode = node as Text;
		}
	}
	if (bestTextNode) {
		bestTextNode.textContent = customTitle;
	} else {
		anchor.appendChild(document.createTextNode(customTitle));
	}
}

// ─── Restore ─────────────────────────────────────────────────────────────────────────
// Idempotent: applies custom title only when the visible text differs, so it can be
// re-run on every DOM change (and after React resets textContent) without side effects.
// No longer needs a contextValid escape hatch: platform/storage.ts handles
// errors per call, so a single failure cannot disable every restore and save.

function restoreTitle(item: HTMLElement, sid: string): void {
	const meta = getSessionMeta(sid);
	if (!meta) return;
	const title = resolveSessionTitle(meta);
	if (item.textContent && item.textContent.trim() !== title) {
		applyCustomTitle(item, title);
	}
}

function restoreAllTitles(): void {
	queryHistoryLinks().forEach((item) => {
		const href = item.getAttribute("href") || "";
		const sid = sessionIdFromHref(href);
		if (sid) restoreTitle(item, sid);
	});
}

// ─── Main setup ─────────────────────────────────────────────────────────────────────

export function setupHistoryTitleEditing(): Disposer {
	restoreAllTitles();
	// Kept so the disposer can genuinely removeEventListener, rather than only
	// clearing the bound flag and leaking the handler on Arena's own element.
	const bound: Array<{ el: HTMLElement; handler: EventListener }> = [];
	queryHistoryLinks().forEach((itemEl) => {
		const href = itemEl.getAttribute("href") || "";
		const sid = sessionIdFromHref(href);
		if (!sid) return;
		if (itemEl.dataset.aiSidebarEditable === "1") return;
		itemEl.dataset.aiSidebarEditable = "1";
		itemEl.title = (itemEl.title || "") + " | Double-click to rename";

		// Double-click → inline edit. Hoisted into a named handler so it can be
		// removed on teardown.
		const handler = (e: Event) => {
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
				setSessionCustomTitle(sid, newText);
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
		};
		itemEl.addEventListener("dblclick", handler, true);
		bound.push({ el: itemEl, handler });
	});

	return () => {
		for (const { el, handler } of bound) {
			el.removeEventListener("dblclick", handler, true);
			delete el.dataset.aiSidebarEditable;
		}
		bound.length = 0;
	};
}
