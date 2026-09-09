// History titles — restore custom titles onto Arena's /c/ sidebar links and
// advertise the rename entry point. The custom title is persisted via
// platform/storage.ts.
//
// Rename used to have two entries: double-click edited a link in place, and the
// right-click menu offered "✏️ Rename". Issue #17 reviewed that redundancy
// against ChatGPT/Claude — both rename exclusively through a menu — and kept a
// single path: the right-click menu (ui/contextMenu.ts). Double-click rename was
// removed; this module binds no mouse handlers at all.
//
// Public exports:
//   setupHistoryTitles — restore custom titles + hint tooltip on all /c/ links

import { getSessionMeta } from "./features/sessions";
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
// app/loop.ts re-runs setupHistoryTitles() on every debounced mutation, the
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

/** Tooltip suffix advertising the single rename entry (the right-click menu). */
const HINT_SUFFIX = " | Right-click to rename";
/**
 * Tooltip suffix left by the retired double-click path — stripped on sight so an
 * upgrade without a page reload never shows both hints stacked.
 */
const RETIRED_SUFFIX = " | Double-click to rename";

export function setupHistoryTitles(): Disposer {
	restoreAllTitles();
	// Re-runs on every debounced DOM mutation (SPA lazy load), so the hint must
	// be idempotent: `includes` keeps it from stacking, and also re-adds it if
	// Arena's React reset the title on an element we already visited.
	queryHistoryLinks().forEach((itemEl) => {
		const href = itemEl.getAttribute("href") || "";
		const sid = sessionIdFromHref(href);
		if (!sid) return;
		let title = itemEl.title || "";
		if (title.endsWith(RETIRED_SUFFIX)) {
			title = title.slice(0, -RETIRED_SUFFIX.length);
		}
		if (!title.includes(HINT_SUFFIX)) {
			itemEl.title = title + HINT_SUFFIX;
		}
	});
	// Restoring is one-shot and idempotent — there are no listeners to tear down.
	// The Disposer shape stays so content.ts can register it like every setup.
	return () => {};
}
