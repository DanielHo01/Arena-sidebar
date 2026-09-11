// platform/arenaContract.ts — the live arena.ai DOM contract, in one place.
//
// Every selector and Battle-detection pattern the extension bets on lives
// here. arenaDom.ts / extract.ts consume them; scripts/gen-probe.ts inlines
// the same values into the pasteable console probe. A redesign is one edit,
// and tests/__fixtures__/probes/*.json replay the 2026-09 live pages against
// production functions so we do not have to sideload to catch a miss.

/** Anchor elements in Arena's history list. */
export const HISTORY_LINK_SELECTOR = 'a[href*="/c/"]';

/**
 * Cheap candidates for Arena's message scroll container, preferred first.
 * #28: the old three-class AND no longer matches. Prefer shadcn ScrollArea,
 * then any overscroll-none under main. The legacy path stays last so the
 * e2e mock still works.
 */
export const SCROLL_CONTAINER_SELECTORS = [
	"main [data-radix-scroll-area-viewport]",
	'main [class*="overscroll-none"]',
	'main > div > div[class*="h-full"][class*="w-full"][class*="overscroll-none"]',
] as const;

/**
 * Combined selector for "is there a chat scroller at all". querySelector
 * with a comma list returns document order, not preference order.
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

/** User bubbles. Excludes w-4 / inline-flex chrome that shares the surface. */
export const USER_MESSAGE_SELECTOR =
	'main [class*="bg-surface-raised"][class*="rounded-lg"]:not([class*="w-4"]):not([class*="inline-flex"])';

export const ASSISTANT_MESSAGE_SELECTOR =
	'main [class*="bg-surface-primary"][class*="flex-col"][class*="overflow-hidden"]';

/**
 * The Battle / Direct / Max control that is currently selected. Live 2026-09
 * UI (#21) is a <button data-state="open">, not role=tab. An open dropdown
 * is also data-state=open — BATTLE_MODE_LABEL is the gate.
 */
export const ACTIVE_MODE_SELECTOR = [
	'[role="tab"][aria-selected="true"]',
	'[role="tab"][data-state="active"]',
	'button[aria-pressed="true"]',
	'button[data-state="active"]',
	'button[data-state="open"]',
].join(", ");

/** Diagnostic dump: every mode-like control, not just the active one. */
export const MODE_CONTROL_SELECTOR =
	'[role="tab"], button[aria-pressed], button[data-state]';

export const CONTROL_SELECTOR = 'button, [role="button"]';

export const BATTLE_MODE_LABEL = /battle|对战|盲测/i;

/**
 * English and Chinese fill the SAME four slots. "都好" is a prefix of
 * "都不好"; the lookahead keeps them as separate votes.
 */
export const BATTLE_VOTE_PATTERNS: RegExp[] = [
	/a is better|a\s*更好/,
	/b is better|b\s*更好/,
	/\btie\b|都好(?!不)/,
	/both bad|都不好/,
];

export const BATTLE_VOTE_QUORUM = 3;
