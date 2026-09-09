// features/theme.ts — keep every extension surface on the resolved theme.
//
// Three surfaces need the result, through three different mechanisms:
//   - the shadow-root panel/FAB/modals: the host element's
//     data-ai-sidebar-theme attribute (closed root; nothing else crosses);
//   - the context menu (a <style> in document.head): the same attribute
//     mirrored onto <html> so its selectors can match;
//   - Session-Library rows inside Arena's own sidebar: inline styles, which
//     cannot key off any selector — they read --ai-sidebar-* custom
//     properties instead, which inherit down from <html>.
//
// The user's mode choice is persisted under "themeMode" and subscribed via
// onStorageChanged, so renaming the theme in one tab repaints every tab.
// While in auto, a MutationObserver on <html> re-resolves whenever Arena (or
// the OS, via matchMedia) flips the theme underneath us.

import type { Disposer } from "../types";
import { detectTheme, nextThemeMode, type HostTheme } from "../platform/theme";
import { onStorageChanged, storageGet, storageSet } from "../platform/storage";
import { panel } from "../state";

export const THEME_KEY = "themeMode";
export const THEME_ATTR = "data-ai-sidebar-theme";

/** Custom properties handed to light-DOM inline styles in dark mode. The
 * prefix keeps them from colliding with Arena's own tokens. In light mode
 * they are REMOVED, so each inline style falls back to its written value —
 * one source of truth per value, exactly the pattern list styles already
 * use with var(--arena-blue, #4d7cff). */
const PAGE_VARS_DARK: Record<string, string> = {
	"--ai-sidebar-fg": "#e5e7eb",
	"--ai-sidebar-muted": "#9ca3af",
};

function isThemeMode(v: unknown): v is "auto" | "light" | "dark" {
	return v === "auto" || v === "light" || v === "dark";
}

export function applyTheme(theme: HostTheme): void {
	const host = document.getElementById("__edge_ai_sidebar_host");
	host?.setAttribute(THEME_ATTR, theme);

	const root = document.documentElement;
	if (!root) return;
	root.setAttribute(THEME_ATTR, theme);
	for (const [name, value] of Object.entries(PAGE_VARS_DARK)) {
		if (theme === "dark") root.style.setProperty(name, value);
		else root.style.removeProperty(name);
	}
}

/** Re-resolve and repaint. Cheap and idempotent; safe from any trigger. */
export function syncTheme(): HostTheme {
	const theme = detectTheme(panel.themeMode);
	applyTheme(theme);
	return theme;
}

/** Adopt the persisted mode (if any) and repaint. */
export async function loadThemeMode(): Promise<void> {
	const stored = await storageGet(THEME_KEY);
	if (isThemeMode(stored)) panel.themeMode = stored;
	syncTheme();
}

/** Panel header button: auto → light → dark → auto, persisted for all tabs. */
export function cycleThemeMode(): void {
	panel.themeMode = nextThemeMode(panel.themeMode);
	syncTheme();
	void storageSet(THEME_KEY, panel.themeMode);
}

export function setupTheme(): Disposer {
	const cleanups: Disposer[] = [];

	// Paint synchronously from whatever panel.themeMode already says (the
	// default "auto" resolves from the page), then re-paint once storage has
	// answered — waiting on storage first would delay the correct theme on
	// every cold load, and a failed read must never strand the UI.
	syncTheme();
	void loadThemeMode();

	cleanups.push(
		onStorageChanged(THEME_KEY, (change) => {
			const v = (change as { newValue?: unknown } | undefined)?.newValue;
			if (!isThemeMode(v) || v === panel.themeMode) return;
			panel.themeMode = v;
			syncTheme();
		}),
	);

	const root = document.documentElement;
	if (root && typeof MutationObserver !== "undefined") {
		const obs = new MutationObserver(() => {
			// Manual modes are not the page's business — a flip there must
			// not undo the user's choice.
			if (panel.themeMode === "auto") syncTheme();
		});
		obs.observe(root, {
			attributes: true,
			attributeFilter: ["class", "data-theme", "style"],
		});
		cleanups.push(() => obs.disconnect());
	}

	// prefers-color-scheme only matters while nothing on the page said
	// light or dark explicitly — which is exactly when we would consult it,
	// so a plain change listener is enough.
	let mq: MediaQueryList | undefined;
	const onMq = () => {
		if (panel.themeMode === "auto") syncTheme();
	};
	try {
		mq = window.matchMedia?.("(prefers-color-scheme: dark)");
	} catch {
		mq = undefined;
	}
	if (mq?.addEventListener) {
		mq.addEventListener("change", onMq);
		cleanups.push(() => mq?.removeEventListener?.("change", onMq));
	}

	return () => {
		for (const dispose of cleanups) dispose();
	};
}
