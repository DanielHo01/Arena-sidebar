// platform/arenaDom.ts — every selector and DOM probe that encodes knowledge of
// arena.ai's markup, in one place.
//
// Before this module the same knowledge was scattered:
//   'a[href*="/c/"]'                  folders.ts, historyTitles.ts x2
//   the overscroll-none container     features/prescroll.ts
//   '[class*="sidebar-wrapper"]'      folders.ts
//   children[0] -> [1] -> [0] -> [2]  folders.ts (quick-nav)
//
// These are the lines that break when Arena ships a redesign. Centralising them
// means a redesign is one edit, and the tests here fail loudly and specifically
// instead of the extension quietly rendering nothing.
//
// #20: Arena's sidebar is now a shadcn Sidebar (data-sidebar / data-side), not
// a 5-level child-index path under [class*="sidebar-wrapper"]. The probe below
// uses those attributes; a named failure still beats a silent null.

/** Anchor elements in Arena's history list. */
export const HISTORY_LINK_SELECTOR = 'a[href*="/c/"]';

/**
 * Cheap candidates for Arena's message scroll container, preferred first.
 * The list is tried in order by queryScrollContainer(); geometry (is it
 * actually virtualised?) is features/prescroll.ts's job.
 *
 * #28: the old three-class AND
 *   main > div > div[h-full][w-full][overscroll-none]
 * no longer matches. Prefer shadcn ScrollArea, then any overscroll-none
 * under main. The legacy path stays last so the e2e mock still works.
 */
export const SCROLL_CONTAINER_SELECTORS = [
	"main [data-radix-scroll-area-viewport]",
	'main [class*="overscroll-none"]',
	'main > div > div[class*="h-full"][class*="w-full"][class*="overscroll-none"]',
] as const;

/**
 * Combined selector for "is there a chat scroller at all". querySelector
 * with a comma list returns document order, not preference order — use
 * queryScrollContainer() when the preferred node matters.
 */
export const SCROLL_CONTAINER_SELECTOR = SCROLL_CONTAINER_SELECTORS.join(", ");

/** shadcn Sidebar root. Replaces [class*="sidebar-wrapper"]. */
export const SIDEBAR_SELECTOR = '[data-sidebar="sidebar"]';

/** History-list host inside the sidebar — Session Library injects here. */
export const SIDEBAR_CONTAINER_SELECTOR = '[data-side="container"]';

/** The <ul> of history links. */
export const SIDEBAR_MENU_SELECTOR = 'ul[data-sidebar="menu"]';

/**
 * Legacy class-substring wrapper. Kept as a fallback finder so a partial
 * Arena rollout that still paints the old class does not go fully dark.
 */
export const SIDEBAR_WRAPPER_SELECTOR = '[class*="sidebar-wrapper"]';

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

// ── Battle-mode detection (#14) ──────────────────────────────────────────────
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
// round rendering. That is what makes the vote-label signal shippable while
// its exact labels are still unverified on the live UI (the sandbox cannot
// reach arena.ai; see tests/e2e/MANUAL-SMOKE.md §⑥ to confirm or adjust).
//
// Signal 1 — the Battle Mode tab is the active one. Arena is a shadcn/Tailwind
// app, and shadcn Tabs render role="tab" with data-state="active"; the
// aria-selected and aria-pressed variants cover a plain-toggle implementation.

const ACTIVE_TAB_SELECTOR =
	'[role="tab"][aria-selected="true"], [role="tab"][data-state="active"], button[aria-pressed="true"]';

// Signal 2 — the battle vote bar. One label proves nothing (a chat about
// voting mentions "tie"), so a quorum of distinct labels is required.
const BATTLE_VOTE_PATTERNS: RegExp[] = [
	/a is better/,
	/b is better/,
	/\btie\b/,
	/both bad/,
];
const BATTLE_VOTE_QUORUM = 3;

/**
 * True when the page looks like an arena.ai battle (blind side-by-side)
 * conversation: the Battle Mode tab is active, or a quorum of the battle
 * vote labels is present. Scoped to `root` for tests; production passes
 * nothing and scans the document.
 */
export function detectBattleMode(root: ParentNode = document): boolean {
	const tabs = root.querySelectorAll(ACTIVE_TAB_SELECTOR);
	for (const tab of tabs) {
		if (/battle/i.test(tab.textContent || "")) return true;
	}
	const seen = new Set<number>();
	const buttons = root.querySelectorAll('button, [role="button"]');
	for (const btn of buttons) {
		const text = (btn.textContent || "").toLowerCase();
		BATTLE_VOTE_PATTERNS.forEach((pattern, i) => {
			if (pattern.test(text)) seen.add(i);
		});
		if (seen.size >= BATTLE_VOTE_QUORUM) return true;
	}
	return false;
}
