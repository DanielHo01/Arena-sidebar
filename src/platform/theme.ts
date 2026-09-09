// platform/theme.ts — resolve the theme the extension UI should paint with.
//
// Why this lives in JS instead of pure CSS: the panel/FAB live in a CLOSED
// shadow root whose host resets everything (`:host { all: initial }`), so
// shadow CSS cannot see the page's `class="dark"` on <html> — and a media
// query on prefers-color-scheme would be wrong anyway, because a site can be
// dark while the OS is light (or the other way around). The only reliable
// bridge is: detect here, mirror the result onto the host as a
// `data-ai-sidebar-theme` attribute, and let :host([data-…]) CSS switch.
//
// Detection order inside "auto":
//   1. html class `dark` / `light` — Arena is a Tailwind/shadcn app (see the
//      copied sidebar classes in ui/styles/arenaSidebar.ts), and that stack
//      themes exactly this way. It is also the only signal that updates in
//      lockstep with the page, so nothing may take priority over it.
//   2. html [data-theme] — the other common convention.
//   3. computed color-scheme on <html> — covers pages that only set that.
//   4. prefers-color-scheme (OS) — last, because it can disagree with the
//      page, and the page wins: our UI sits on top of it.
//
// A manual mode ("light"/"dark") short-circuits all of the above.

export type HostTheme = "light" | "dark";

/** UI preference: follow the page, or force one side. */
export type ThemeMode = "auto" | HostTheme;

/** What clicking the theme button cycles through. */
export const THEME_CYCLE: readonly ThemeMode[] = ["auto", "light", "dark"];

export function nextThemeMode(mode: ThemeMode): ThemeMode {
	const i = THEME_CYCLE.indexOf(mode);
	// The modulo makes the index always valid; the ?? keeps it that way for
	// tsc as well (noUncheckedIndexedAccess sees arithmetic, not intent).
	return THEME_CYCLE[(i + 1) % THEME_CYCLE.length] ?? "auto";
}

/** Per-mode glyphs for the header button (it is also its own status display). */
export const THEME_GLYPHS: Record<ThemeMode, string> = {
	auto: "🌓",
	light: "☀️",
	dark: "🌙",
};

function prefersDark(win: Window | null): boolean {
	try {
		return win?.matchMedia?.("(prefers-color-scheme: dark)")?.matches === true;
	} catch {
		// jsdom / hardened pages may refuse matchMedia entirely.
		return false;
	}
}

export function detectTheme(
	mode: ThemeMode,
	doc: Document = document,
): HostTheme {
	if (mode === "light" || mode === "dark") return mode;

	const root = doc?.documentElement;
	if (root) {
		if (root.classList.contains("dark")) return "dark";
		if (root.classList.contains("light")) return "light";
		const attr = root.getAttribute("data-theme");
		if (attr === "dark" || attr === "light") return attr;
		try {
			const scheme = doc.defaultView?.getComputedStyle(root).colorScheme;
			if (scheme?.includes("dark")) return "dark";
			if (scheme?.includes("light")) return "light";
		} catch {
			// No view (detached document) or unsupported property: keep going.
		}
	}
	return prefersDark(doc?.defaultView ?? null) ? "dark" : "light";
}
