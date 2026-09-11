// platform/arenaDom.ts — probes and traversal over arena.ai's markup.
//
// Selectors live in arenaContract.ts (one edit when Arena redesigns; the
// console probe is generated from the same file). This module is the
// runtime: scroll/history queries, Session Library injection, Battle
// detection. #20: shadcn Sidebar (data-sidebar / data-side), not a 5-level
// child-index path. A named failure still beats a silent null.

import {
	ACTIVE_MODE_SELECTOR,
	BATTLE_MODE_LABEL,
	BATTLE_VOTE_PATTERNS,
	BATTLE_VOTE_QUORUM,
	CONTROL_SELECTOR,
	HISTORY_LINK_SELECTOR,
	SCROLL_CONTAINER_SELECTORS,
	SIDEBAR_CONTAINER_SELECTOR,
	SIDEBAR_MENU_SELECTOR,
	SIDEBAR_SELECTOR,
	SIDEBAR_WRAPPER_SELECTOR,
} from "./arenaContract";

export {
	ACTIVE_MODE_SELECTOR,
	BATTLE_MODE_LABEL,
	BATTLE_VOTE_PATTERNS,
	BATTLE_VOTE_QUORUM,
	CONTROL_SELECTOR,
	HISTORY_LINK_SELECTOR,
	SCROLL_CONTAINER_SELECTOR,
	SCROLL_CONTAINER_SELECTORS,
	SIDEBAR_CONTAINER_SELECTOR,
	SIDEBAR_MENU_SELECTOR,
	SIDEBAR_SELECTOR,
	SIDEBAR_WRAPPER_SELECTOR,
} from "./arenaContract";

/** First matching scroll-container candidate, or null. No geometry check. */
export function queryScrollContainer(
	root: ParentNode = document,
): HTMLElement | null {
	for (const sel of SCROLL_CONTAINER_SELECTORS) {
		const el = root.querySelector<HTMLElement>(sel);
		if (el) return el;
	}
	return null;
}

/** History links under `root`, defaulting to the whole document. */
export function queryHistoryLinks(
	root: ParentNode = document,
): HTMLAnchorElement[] {
	return Array.from(
		root.querySelectorAll<HTMLAnchorElement>(HISTORY_LINK_SELECTOR),
	);
}

export function findArenaSidebarWrapper(): HTMLElement | null {
	return (
		document.querySelector<HTMLElement>(SIDEBAR_SELECTOR) ??
		document.querySelector<HTMLElement>(SIDEBAR_WRAPPER_SELECTOR)
	);
}

/**
 * The semantic hook that failed. Two levels, not six: the child-index ladder
 * is gone, so the only questions are "is there a sidebar?" and "is there a
 * place to inject Session Library?".
 */
export type QuickNavFailure =
	| "sidebar" //    no [data-sidebar=sidebar] and no legacy wrapper
	| "container"; // sidebar found, but no [data-side=container] / menu parent

/** Discriminated probe result: the injection container, or the level that broke. */
export type QuickNavProbe =
	{ ok: true; el: HTMLElement } | { ok: false; failedAt: QuickNavFailure };

/**
 * Resolve the node Session Library should inject into.
 *
 * Structure as of 2026-09-09 (Arena shadcn Sidebar):
 *     [data-sidebar="sidebar"]                         "sidebar"
 *       [data-side="container"]  <-- returned          "container"
 *         div
 *           ul[data-sidebar="menu"]
 *           button
 *
 * Fallbacks, in order: the menu's parent, the menu itself. Never walks
 * children[n] — that is what #20 broke on.
 */
export function inspectArenaQuickNav(): QuickNavProbe {
	const sidebar = findArenaSidebarWrapper();
	if (!sidebar) return { ok: false, failedAt: "sidebar" };

	const container = sidebar.querySelector<HTMLElement>(
		SIDEBAR_CONTAINER_SELECTOR,
	);
	if (container) return { ok: true, el: container };

	const menu = sidebar.querySelector<HTMLElement>(SIDEBAR_MENU_SELECTOR);
	if (menu?.parentElement instanceof HTMLElement) {
		return { ok: true, el: menu.parentElement };
	}
	if (menu) return { ok: true, el: menu };

	return { ok: false, failedAt: "container" };
}

// ── Edge-triggered failure reporting ──────────────────────────────────────────
//
// inspectArenaQuickNav can fail at two levels, and all three call sites in
// ui/arenaSidebar.ts bail out silently on a missing container. That is the right
// behaviour at runtime — a MutationObserver callback must never throw — but it
// means an Arena redesign makes Session Library stop rendering with no signal.
//
// Reporting every null is not an option either: ensureArenaFolderEntry runs from
// a MutationObserver, and during page load the sidebar legitimately does not
// exist yet, so a naive warn would print hundreds of lines per load and bury the
// one line that matters.
//
// So the report is edge-triggered on the failure *level*: warn when the level
// changes, stay quiet while it stays the same, and re-arm on success so a
// redesign that lands later in the same page session is still reported.

/** The failure level last reported, or "ok" when the last probe succeeded. */
let lastQuickNavReport: QuickNavFailure | "ok" | null = null;

/**
 * Clear the reporting latch. Exposed for tests; production code has no reason to
 * call it, since the latch is page-scoped rather than session-scoped — Arena's
 * markup does not change when the user switches conversations.
 */
export function resetQuickNavReport(): void {
	lastQuickNavReport = null;
}

/**
 * Resolve the Session Library injection container, reporting the first sighting
 * of each distinct failure level. Returns the container, or null when the
 * traversal failed.
 */
export function resolveQuickNavContainer(): HTMLElement | null {
	const probe = inspectArenaQuickNav();
	const current: QuickNavFailure | "ok" = probe.ok ? "ok" : probe.failedAt;
	if (current !== lastQuickNavReport) {
		lastQuickNavReport = current;
		if (!probe.ok) {
			console.warn(
				`[AI Sidebar] Arena sidebar container not found (failed at: ${probe.failedAt}). ` +
					"Arena's sidebar markup may have changed; the semantic selectors in platform/arenaDom.ts need updating.",
			);
		}
	}
	return probe.ok ? probe.el : null;
}

// ── Battle-mode detection (#14, #21) ─────────────────────────────────────────
//
// A battle round is two anonymous responses side by side plus a vote bar — not
// the single user/assistant thread the extractor understands. When nothing
// extracts, the store stays empty and the extension would show no UI at all,
// with no hint why. detectBattleMode feeds the empty state so the panel can say
// what is going on instead of "No messages detected".
//
// Two independent signals; either one fires. Detection ONLY renames the empty
// state — when extraction does find messages, rounds render exactly as in
// Direct Chat — so a miss degrades to today's message and can never break
// round rendering.
//
// Signal 1 — the Battle Mode control is the active one. Arena is a
// shadcn/Tailwind app. The live 2026-09 UI (#21) is not role=tab: it is a
// <button data-state="open"> whose text is still "Battle Mode". data-state=
// active/open and aria-pressed cover that; the role=tab variants stay for
// older markup. The text gate (battle / 对战 / 盲测) is load-bearing — an
// open dropdown is also data-state=open and must not trip this.
//
// Signal 2 — the battle vote bar. One label proves nothing (a chat about
// voting mentions "tie"), so a quorum of distinct labels is required.
// English and Chinese fill the SAME four slots, so a mixed UI does not
// double-count. "都好" is a prefix of "都不好"; the lookahead keeps them
// as separate votes.

/**
 * True when the page looks like an arena.ai battle (blind side-by-side)
 * conversation: the Battle Mode control is active, or a quorum of the battle
 * vote labels is present. Scoped to `root` for tests; production passes
 * nothing and scans the document. Patterns live in arenaContract.ts so the
 * console probe cannot drift.
 */
export function detectBattleMode(root: ParentNode = document): boolean {
	const tabs = root.querySelectorAll(ACTIVE_MODE_SELECTOR);
	for (const tab of tabs) {
		if (BATTLE_MODE_LABEL.test(tab.textContent || "")) return true;
	}
	const seen = new Set<number>();
	const buttons = root.querySelectorAll(CONTROL_SELECTOR);
	for (const btn of buttons) {
		const text = (btn.textContent || "").toLowerCase();
		BATTLE_VOTE_PATTERNS.forEach((pattern, i) => {
			if (pattern.test(text)) seen.add(i);
		});
		if (seen.size >= BATTLE_VOTE_QUORUM) return true;
	}
	return false;
}
