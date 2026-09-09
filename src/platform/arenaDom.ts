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
// The quick-nav child-index path is inherently fragile — it depends on Arena's
// DOM order, not on anything semantic. It is documented rather than hidden, and
// the null-returning ladder below is what keeps a structure change from throwing
// inside a MutationObserver callback.

/** Anchor elements in Arena's history list. */
export const HISTORY_LINK_SELECTOR = 'a[href*="/c/"]';

/**
 * Arena's message scroll container. It virtualises: only ~8 messages are in the
 * DOM until you scroll, which is why features/prescroll.ts exists.
 */
export const SCROLL_CONTAINER_SELECTOR =
	'main > div > div[class*="h-full"][class*="w-full"][class*="overscroll-none"]';

/** The outermost element of Arena's sidebar. */
export const SIDEBAR_WRAPPER_SELECTOR = '[class*="sidebar-wrapper"]';

/** History links under `root`, defaulting to the whole document. */
export function queryHistoryLinks(
	root: ParentNode = document,
): HTMLAnchorElement[] {
	return Array.from(
		root.querySelectorAll<HTMLAnchorElement>(HISTORY_LINK_SELECTOR),
	);
}

export function findArenaSidebarWrapper(): HTMLElement | null {
	return document.querySelector<HTMLElement>(SIDEBAR_WRAPPER_SELECTOR);
}

/**
 * The level of the quick-nav descent that failed, named after what it was
 * supposed to find. Used to turn "the extension renders nothing" into a specific
 * statement about which Arena assumption broke.
 */
export type QuickNavFailure =
	| "wrapper" //      no [class*="sidebar-wrapper"] at all
	| "floating" //     wrapper.children[0]
	| "bg-sidebar" //   floating.children[1]
	| "floating-root" // bgSidebar.children[0]
	| "quick-nav" //    floatingRoot.children[2]
	| "nav-tag"; //     slot 2 exists but is not a DIV

/** Discriminated probe result: the container, or the level that broke. */
export type QuickNavProbe =
	{ ok: true; el: HTMLElement } | { ok: false; failedAt: QuickNavFailure };

/**
 * Navigate to the quick-nav container (child 2) inside the floating sidebar —
 * where New Chat / Leaderboard / Search live.
 *
 * Structure as of phase10a, with the failure name each level yields:
 *     [class*="sidebar-wrapper"]                   "wrapper"
 *       .children[0]   floating container          "floating"
 *         .children[1] bg-sidebar                  "bg-sidebar"
 *           .children[0] floating sidebar root     "floating-root"
 *             .children[2] quick-nav  <-- returned "quick-nav" / "nav-tag"
 *
 * Every level is checked, so any Arena change yields a named failure instead of
 * throwing inside a MutationObserver callback.
 *
 * Naming the level is the whole point. This index path is the single most
 * fragile thing in the codebase — it encodes Arena's DOM *order*, nothing
 * semantic — and a bare null told the call sites nothing about which assumption
 * died, so a redesign made the extension stop rendering silently.
 */
export function inspectArenaQuickNav(): QuickNavProbe {
	const wrapper = findArenaSidebarWrapper();
	if (!wrapper) return { ok: false, failedAt: "wrapper" };
	const floating = wrapper.children[0];
	if (!floating) return { ok: false, failedAt: "floating" };
	const bgSidebar = floating.children[1];
	if (!bgSidebar) return { ok: false, failedAt: "bg-sidebar" };
	const floatingRoot = bgSidebar.children[0];
	if (!floatingRoot) return { ok: false, failedAt: "floating-root" };
	const quickNav = floatingRoot.children[2];
	if (!quickNav) return { ok: false, failedAt: "quick-nav" };
	if (quickNav.tagName !== "DIV") return { ok: false, failedAt: "nav-tag" };
	return { ok: true, el: quickNav as HTMLElement };
}

// ── Edge-triggered failure reporting ──────────────────────────────────────────
//
// inspectArenaQuickNav can fail at six levels, and all three call sites in
// ui/arenaSidebar.ts bail out silently on a missing container. That is the right
// behaviour at runtime — a MutationObserver callback must never throw — but it
// means an Arena redesign makes the extension stop rendering with no signal at
// all.
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
 * Resolve the quick-nav container, reporting the first sighting of each distinct
 * failure level. Returns the container, or null when the traversal failed.
 */
export function resolveQuickNavContainer(): HTMLElement | null {
	const probe = inspectArenaQuickNav();
	const current: QuickNavFailure | "ok" = probe.ok ? "ok" : probe.failedAt;
	if (current !== lastQuickNavReport) {
		lastQuickNavReport = current;
		if (!probe.ok) {
			console.warn(
				`[AI Sidebar] Arena quick-nav container not found (failed at: ${probe.failedAt}). ` +
					"Arena's sidebar markup may have changed; the child-index path in platform/arenaDom.ts needs updating.",
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
