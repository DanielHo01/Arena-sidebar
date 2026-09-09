// Dark mode (#9) — theme detection, wiring, and the header button.
//
// platform/theme.ts is pure resolution: page-class beats OS preference, a
// manual mode beats the page. features/theme.ts is the plumbing: host/html
// attributes, --ai-sidebar-* page vars, persistence + cross-tab sync. The
// skeleton's button is the only entry point users see.
//
// The host element and the storage/onChanged mocks follow the shapes already
// used by content.test.ts and storage.test.ts.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	detectTheme,
	nextThemeMode,
	THEME_CYCLE,
	THEME_GLYPHS,
} from "../../src/platform/theme";
import { ensurePanelSkeleton } from "../../src/ui/panel/skeleton";
import { PANEL_BASE_CSS } from "../../src/ui/styles/base";
import { CONTEXT_MENU_CSS, UI_STYLES } from "../../src/ui/styles";
import { ASL } from "../../src/ui/styles/arenaSidebar";
import {
	applyTheme,
	cycleThemeMode,
	setupTheme,
	syncTheme,
	THEME_ATTR,
	THEME_KEY,
} from "../../src/features/theme";
import { panel } from "../../src/state";
import {
	setStorageBackend,
	type StorageBackend,
} from "../../src/platform/storage";

// ─── test furniture ─────────────────────────────────────────────────────────

function fakeBackend(initial: Record<string, unknown> = {}) {
	const data = new Map<string, unknown>(Object.entries(initial));
	const backend: StorageBackend = {
		get: async (keys) => {
			if (keys === null) return Object.fromEntries(data);
			const list = Array.isArray(keys) ? keys : [keys];
			const out: Record<string, unknown> = {};
			for (const k of list) if (data.has(k)) out[k] = data.get(k);
			return out;
		},
		set: async (items) => {
			for (const [k, v] of Object.entries(items)) data.set(k, v);
		},
		remove: async (keys) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
		},
	};
	return { backend, data };
}

/** Flush queued microtasks (the storageGet promise chain). */
async function flush(): Promise<void> {
	for (let i = 0; i < 4; i++) await Promise.resolve();
}

function stubMatchMedia(matches: boolean): () => void {
	const prev = window.matchMedia;
	// @ts-expect-error — minimal stub is enough for detectTheme + setupTheme.
	window.matchMedia = () => ({
		matches,
		addEventListener: () => {},
		removeEventListener: () => {},
	});
	return () => {
		if (prev) window.matchMedia = prev;
		else delete (window as { matchMedia?: unknown }).matchMedia;
	};
}

const root = () => document.documentElement;

// ─── detectTheme ────────────────────────────────────────────────────────────

describe("detectTheme", () => {
	beforeEach(() => {
		root().classList.remove("dark", "light");
		root().removeAttribute("data-theme");
		root().style.removeProperty("color-scheme");
	});

	it("forces the manual modes regardless of the page", () => {
		root().classList.add("dark");
		expect(detectTheme("light")).toBe("light");
		root().classList.remove("dark");
		root().classList.add("light");
		expect(detectTheme("dark")).toBe("dark");
	});

	it("reads the shadcn/Tailwind class first", () => {
		root().classList.add("dark");
		root().setAttribute("data-theme", "light"); // a stale attr must not win
		expect(detectTheme("auto")).toBe("dark");
	});

	it("falls back to data-theme, then OS preference", () => {
		root().setAttribute("data-theme", "dark");
		expect(detectTheme("auto")).toBe("dark");

		root().removeAttribute("data-theme");
		const restore = stubMatchMedia(true);
		expect(detectTheme("auto")).toBe("dark");
		restore();

		expect(detectTheme("auto")).toBe("light"); // no signal → light
	});

	it("survives a hostile matchMedia", () => {
		const prev = window.matchMedia;
		window.matchMedia = () => {
			throw new Error("blocked by hardened page");
		};
		expect(() => detectTheme("auto")).not.toThrow();
		expect(detectTheme("auto")).toBe("light");
		if (prev) window.matchMedia = prev;
	});
});

describe("nextThemeMode", () => {
	it("cycles auto → light → dark → auto", () => {
		expect(nextThemeMode("auto")).toBe("light");
		expect(nextThemeMode("light")).toBe("dark");
		expect(nextThemeMode("dark")).toBe("auto");
		expect(THEME_CYCLE).toHaveLength(3);
	});
});

// ─── applyTheme / syncTheme ─────────────────────────────────────────────────

describe("applyTheme", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		root().classList.remove("dark", "light");
		root().removeAttribute("data-theme");
	});

	it("mirrors the theme onto the shadow host AND <html>, plus the page vars", () => {
		const host = document.createElement("div");
		host.id = "__edge_ai_sidebar_host";
		document.body.appendChild(host);

		applyTheme("dark");
		expect(host.getAttribute(THEME_ATTR)).toBe("dark");
		expect(root().getAttribute(THEME_ATTR)).toBe("dark");
		expect(root().style.getPropertyValue("--ai-sidebar-fg")).toBe("#e5e7eb");

		applyTheme("light");
		expect(host.getAttribute(THEME_ATTR)).toBe("light");
		// Light = remove the override; the inline styles' own fallback wins.
		expect(root().style.getPropertyValue("--ai-sidebar-fg")).toBe("");
	});

	it("tolerates a missing host element (boot order, teardown races)", () => {
		expect(() => applyTheme("dark")).not.toThrow();
	});

	it("syncTheme resolves through panel.themeMode", () => {
		panel.themeMode = "dark";
		expect(syncTheme()).toBe("dark");
		panel.themeMode = "auto";
	});
});

// ─── setupTheme: persistence + cross-tab + page watching ───────────────────

describe("setupTheme", () => {
	let dispose: () => void;
	let storage: ReturnType<typeof fakeBackend>;
	let listeners: Array<(changes: unknown, area: string) => void>;

	beforeEach(() => {
		document.body.innerHTML = "";
		const host = document.createElement("div");
		host.id = "__edge_ai_sidebar_host";
		document.body.appendChild(host);
		root().classList.remove("dark", "light");
		root().removeAttribute("data-theme");
		panel.themeMode = "auto";

		storage = fakeBackend({ [THEME_KEY]: "dark" });
		setStorageBackend(storage.backend);

		listeners = [];
		const chromeMock = {
			storage: {
				onChanged: {
					addListener: (fn: (c: unknown, a: string) => void) =>
						listeners.push(fn),
					removeListener: (fn: (c: unknown, a: string) => void) => {
						listeners = listeners.filter((l) => l !== fn);
					},
				},
			},
		};
		vi.stubGlobal("chrome", chromeMock);
		dispose = setupTheme();
	});

	afterEach(() => {
		dispose();
		setStorageBackend(null);
		panel.themeMode = "auto";
		vi.unstubAllGlobals();
	});

	it("adopts the persisted mode on boot (the async storageGet settles before the test body — beforeEach is awaited)", async () => {
		expect(panel.themeMode).toBe("dark");
		expect(
			document
				.getElementById("__edge_ai_sidebar_host")!
				.getAttribute(THEME_ATTR),
		).toBe("dark");
	});

	it("follows another tab's switch through storage.onChanged", async () => {
		await flush(); // settle the initial load first
		expect(panel.themeMode).toBe("dark");

		for (const l of listeners)
			l({ [THEME_KEY]: { newValue: "light" } }, "local");
		expect(panel.themeMode).toBe("light");
		expect(
			document
				.getElementById("__edge_ai_sidebar_host")!
				.getAttribute(THEME_ATTR),
		).toBe("light");
	});

	it("ignores garbage values and other storage areas", async () => {
		await flush();
		for (const l of listeners) {
			l({ [THEME_KEY]: { newValue: "neon" } }, "local");
			l({ [THEME_KEY]: { newValue: "dark" } }, "session");
		}
		expect(panel.themeMode).toBe("dark"); // unchanged from the load
	});

	it("cycles mode on click and persists it", async () => {
		await flush();
		expect(panel.themeMode).toBe("dark");
		cycleThemeMode(); // dark → auto
		expect(panel.themeMode).toBe("auto");
		await flush();
		expect(storage.data.get(THEME_KEY)).toBe("auto");
	});

	it("re-resolves auto when the page flips its class", async () => {
		await flush();
		cycleThemeMode(); // dark → auto (page still light)
		await flush();
		expect(
			document
				.getElementById("__edge_ai_sidebar_host")!
				.getAttribute(THEME_ATTR),
		).toBe("light");

		root().classList.add("dark");
		await new Promise((r) => setTimeout(r, 0)); // MutationObserver is async
		expect(
			document
				.getElementById("__edge_ai_sidebar_host")!
				.getAttribute(THEME_ATTR),
		).toBe("dark");
	});

	it("a manual mode is NOT overridden by the page", async () => {
		await flush();
		cycleThemeMode(); // dark → auto
		cycleThemeMode(); // auto → light
		await flush();

		root().classList.add("dark");
		await new Promise((r) => setTimeout(r, 0));
		expect(
			document
				.getElementById("__edge_ai_sidebar_host")!
				.getAttribute(THEME_ATTR),
		).toBe("light");
	});

	it("unregisters its onChanged listener on dispose", () => {
		expect(listeners.length).toBeGreaterThan(0);
		dispose();
		expect(listeners).toHaveLength(0);
	});
});

// ─── the stylesheet side of the contract (issue #8's root cause) ───────────

describe("theme CSS hooks", () => {
	it("defines the tokens on :host — :root matches nothing in a shadow root", () => {
		expect(PANEL_BASE_CSS).toContain(":host {");
		expect(PANEL_BASE_CSS).not.toMatch(/:root\s*\{/);
		expect(PANEL_BASE_CSS).toContain(':host([data-ai-sidebar-theme="dark"])');
		// The FAB must carry an OPAQUE background token — the whole #8 bug.
		expect(PANEL_BASE_CSS).toContain("--arena-fab-bg: #ffffff");
	});

	it("every --arena-* usage in the shadow CSS carries a light-mode fallback", () => {
		// A token reference without a fallback is what made the old .fab
		// silently shadowless; this regex keeps it from ever coming back.
		expect(UI_STYLES.match(/var\(--arena-[a-z-]+\)/g)).toBeNull();
	});

	it("the context menu (main-document surface) keys off the mirrored html attribute", () => {
		expect(CONTEXT_MENU_CSS).toContain(
			'html[data-ai-sidebar-theme="dark"] .ai-sidebar-ctx',
		);
	});

	it("in-page Session Library styles read the inherited page vars", () => {
		// Inline styles cannot key off a class; they take theme through
		// --ai-sidebar-* custom properties set on <html>.
		expect(ASL.folderRow).toContain("var(--ai-sidebar-fg,");
		expect(ASL.sessionMeta).toContain("var(--ai-sidebar-muted,");
	});
});

// ─── the header button itself ───────────────────────────────────────────────

describe("skeleton theme button", () => {
	let shadow: ShadowRoot;

	beforeEach(() => {
		document.body.innerHTML = "";
		const host = document.createElement("div");
		host.id = "__edge_ai_sidebar_host";
		document.body.appendChild(host);
		panel.themeMode = "auto";
		shadow = host.attachShadow({ mode: "open" });
		ensurePanelSkeleton(shadow, 1, 2, vi.fn());
	});

	it("shows the current mode's glyph and cycles on click", () => {
		const btn = [
			...shadow.querySelectorAll<HTMLButtonElement>(
				".header-actions .summary-btn",
			),
		].find((b) => b.title.startsWith("Theme:"))!;
		expect(btn.textContent).toBe(THEME_GLYPHS.auto);

		btn.click();
		expect(panel.themeMode).toBe("light");
		expect(btn.textContent).toBe(THEME_GLYPHS.light);

		btn.click();
		expect(panel.themeMode).toBe("dark");
		expect(btn.textContent).toBe(THEME_GLYPHS.dark);

		btn.click();
		expect(panel.themeMode).toBe("auto");
		expect(btn.textContent).toBe(THEME_GLYPHS.auto);
	});
});
