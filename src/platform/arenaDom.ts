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
 * Navigate to the quick-nav container (child 2) inside the floating sidebar —
 * where New Chat / Leaderboard / Search live.
 *
 * Structure as of phase10a:
 *     [class*="sidebar-wrapper"]
 *       .children[0]   floating container
 *         .children[1] bg-sidebar
 *           .children[0] floating sidebar root
 *             .children[2] quick-nav   <-- returned
 *
 * Every level is checked, so any Arena change yields null instead of an
 * exception. Returns null if slot 2 exists but is not a DIV.
 */
export function findArenaQuickNavContainer(): HTMLElement | null {
	const wrapper = findArenaSidebarWrapper();
	if (!wrapper) return null;
	const floating = wrapper.children[0];
	if (!floating) return null;
	const bgSidebar = floating.children[1];
	if (!bgSidebar) return null;
	const floatingRoot = bgSidebar.children[0];
	if (!floatingRoot) return null;
	const quickNav = floatingRoot.children[2];
	if (!quickNav || quickNav.tagName !== "DIV") return null;
	return quickNav as HTMLElement;
}
