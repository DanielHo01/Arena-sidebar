// History title editing — double-click on /c/ sidebar links to rename them.
// The custom title is persisted in chrome.storage.local.
//
// Public exports:
//   setupHistoryTitleEditing — scans and binds double-click rename to all /c/ links

import {
	foldersState,
	getSessionMeta,
	setSessionCustomTitle,
} from "./foldersStore";
import { resolveSessionTitle } from "./titleResolver";

// ─── Storage key ─────────────────────────────────────────────────────────────────────
// DEPRECATED: historyTitle_ keys are no longer the canonical title store.
// Migration: see migrateHistoryTitles() in folders.ts (H5). Writes now go to
// foldersState.sessions via setSessionCustomTitle; reads go to the same index.

// ─── Title cache ─────────────────────────────────────────────────────────────────────
// In-memory cache so that restoreTitle() does not O(N) scan foldersState on every
// DOM mutation. cacheTitle() is called on every successful save; restoreTitle()
// reads the cache first (O(1)) before falling back to foldersState.

const titleCache = new Map<string, string>();
let cacheLoaded = false;

function cacheTitle(sid: string, title: string): void {
	titleCache.set(sid, title);
}

// Load every historyTitle_* key into the cache in ONE storage call. After this the
// restore path is pure in-memory — no per-link chrome.storage.local.get on every
// DOM change (Arena's sidebar can hold dozens of /c/ links, and the observer fires
// on every mutation, so per-link get previously caused a storage-call storm).
function loadTitleCache(): void {
	if (cacheLoaded) return;
	cacheLoaded = true;
	// Populate from the in-memory foldersState index. Safe to call after initFolders().
	// If initFolders() has not yet completed, this will be a no-op and restoreTitle()
	// will pick up the session on its next call (e.g. after the observer fires again).
	for (const meta of foldersState.sessions.values()) {
		titleCache.set(meta.sessionId, resolveSessionTitle(meta));
	}
}

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
// Deliberately does NOT gate on contextValid: a stale flag from one unrelated
// lastError would otherwise silently kill every restore (and every save below).

function restoreTitle(item: HTMLElement, sid: string): void {
	const cached = titleCache.get(sid);
	if (cached !== undefined) {
		if (item.textContent && item.textContent.trim() !== cached) {
			applyCustomTitle(item, cached);
		}
		return;
	}
	// cache miss — resolve from the in-memory foldersState index.
	const meta = getSessionMeta(sid);
	if (meta) {
		const title = resolveSessionTitle(meta);
		if (item.textContent && item.textContent.trim() !== title) {
			applyCustomTitle(item, title);
		}
		titleCache.set(sid, title);
	}
}

function restoreAllTitles(): void {
	const items = document.querySelectorAll('a[href*="/c/"]');
	items.forEach((item) => {
		const href = item.getAttribute("href") || "";
		const sid = href.match(/\/c\/([^/?]+)/)?.[1];
		if (sid) restoreTitle(item as HTMLElement, sid);
	});
}

// ─── Main setup ─────────────────────────────────────────────────────────────────────

export function setupHistoryTitleEditing() {
	loadTitleCache();
	restoreAllTitles();
	const items = document.querySelectorAll('a[href*="/c/"]');
	items.forEach((item) => {
		const itemEl = item as HTMLElement;
		const href = item.getAttribute("href") || "";
		const sid = href.match(/\/c\/([^/?]+)/)?.[1];
		if (!sid) return;
		if (itemEl.dataset.aiSidebarEditable === "1") return;
		itemEl.dataset.aiSidebarEditable = "1";
		itemEl.title = (itemEl.title || "") + " | Double-click to rename";

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
					setSessionCustomTitle(sid, newText);
					cacheTitle(sid, newText);
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
