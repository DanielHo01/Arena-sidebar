// platform/arenaDom.ts — every selector that encodes knowledge of arena.ai's
// DOM structure, in one place.
//
// These are the parts of the codebase that break when Arena ships a redesign, so
// they are worth pinning with tests: when Arena changes, these tests fail and
// point at exactly which assumption died, instead of the extension silently
// rendering nothing.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	HISTORY_LINK_SELECTOR,
	SCROLL_CONTAINER_SELECTOR,
	SIDEBAR_CONTAINER_SELECTOR,
	SIDEBAR_MENU_SELECTOR,
	SIDEBAR_SELECTOR,
	SIDEBAR_WRAPPER_SELECTOR,
	detectBattleMode,
	findArenaSidebarWrapper,
	inspectArenaQuickNav,
	queryHistoryLinks,
	queryScrollContainer,
	resetQuickNavReport,
	resolveQuickNavContainer,
} from "../../src/platform/arenaDom";
import { buildSidebar } from "../__fixtures__/arenaDom";

beforeEach(() => {
	document.body.innerHTML = "";
});

describe("selectors", () => {
	it("HISTORY_LINK_SELECTOR matches /c/ anchors and nothing else", () => {
		document.body.innerHTML = `
			<a href="/c/abc">session</a>
			<a href="https://arena.ai/c/def">absolute</a>
			<a href="/settings">settings</a>
			<a href="/chat/xyz">chat</a>`;
		const hits = document.querySelectorAll(HISTORY_LINK_SELECTOR);
		expect(hits).toHaveLength(2);
		expect(Array.from(hits).map((a) => a.textContent)).toEqual([
			"session",
			"absolute",
		]);
	});

	it("SCROLL_CONTAINER_SELECTOR matches overscroll-none under main", () => {
		document.body.innerHTML = `
			<main><div><div class="overscroll-none">real</div></div></main>
			<div><div class="overscroll-none">outside-main</div></div>`;
		const hit = document.querySelector(SCROLL_CONTAINER_SELECTOR);
		expect(hit?.textContent).toBe("real");
	});

	it("SCROLL_CONTAINER_SELECTOR matches a radix scroll viewport under main", () => {
		document.body.innerHTML = `<main><div data-radix-scroll-area-viewport>vp</div></main>`;
		const hit = document.querySelector(SCROLL_CONTAINER_SELECTOR);
		expect(hit?.textContent).toBe("vp");
	});

	it("SCROLL_CONTAINER_SELECTOR does not match a scroller outside main", () => {
		document.body.innerHTML = `<div class="overscroll-none">x</div>`;
		expect(document.querySelector(SCROLL_CONTAINER_SELECTOR)).toBeNull();
	});

	it("queryScrollContainer prefers the radix viewport over overscroll-none", () => {
		document.body.innerHTML = `
			<main>
				<div class="overscroll-none">legacy</div>
				<div data-radix-scroll-area-viewport>radix</div>
			</main>`;
		expect(queryScrollContainer()?.textContent).toBe("radix");
	});

	it("SIDEBAR_SELECTOR matches the shadcn data attribute", () => {
		document.body.innerHTML = `<div data-sidebar="sidebar"></div>`;
		expect(document.querySelector(SIDEBAR_SELECTOR)).not.toBeNull();
	});

	it("SIDEBAR_CONTAINER_SELECTOR and SIDEBAR_MENU_SELECTOR match the inner hooks", () => {
		buildSidebar();
		expect(document.querySelector(SIDEBAR_CONTAINER_SELECTOR)).not.toBeNull();
		expect(document.querySelector(SIDEBAR_MENU_SELECTOR)).not.toBeNull();
	});

	it("SIDEBAR_WRAPPER_SELECTOR still matches the legacy class substring", () => {
		document.body.innerHTML = `<aside class="foo sidebar-wrapper bar"></aside>`;
		expect(document.querySelector(SIDEBAR_WRAPPER_SELECTOR)).not.toBeNull();
	});
});

describe("queryHistoryLinks", () => {
	it("returns the anchors for a root", () => {
		document.body.innerHTML = `<div id="r"><a href="/c/a">a</a><a href="/x">x</a></div>`;
		expect(queryHistoryLinks(document.getElementById("r")!)).toHaveLength(1);
	});

	it("defaults to document", () => {
		document.body.innerHTML = `<a href="/c/a">a</a>`;
		expect(queryHistoryLinks()).toHaveLength(1);
	});
});

describe("findArenaSidebarWrapper", () => {
	it("finds the shadcn sidebar", () => {
		buildSidebar();
		expect(findArenaSidebarWrapper()?.getAttribute("data-sidebar")).toBe(
			"sidebar",
		);
	});

	it("falls back to the legacy class-substring wrapper", () => {
		document.body.innerHTML = `<div class="group/sidebar-wrapper"></div>`;
		expect(findArenaSidebarWrapper()?.className).toContain("sidebar-wrapper");
	});

	it("prefers the data-sidebar node when both exist", () => {
		document.body.innerHTML = `
			<div class="sidebar-wrapper" id="legacy"></div>
			<div data-sidebar="sidebar" id="modern"></div>`;
		expect(findArenaSidebarWrapper()?.id).toBe("modern");
	});

	it("returns null when Arena has not rendered it yet", () => {
		expect(findArenaSidebarWrapper()).toBeNull();
	});
});

describe("inspectArenaQuickNav", () => {
	it("returns the container on the expected structure", () => {
		buildSidebar();
		const probe = inspectArenaQuickNav();
		expect(probe.ok).toBe(true);
		if (probe.ok) expect(probe.el.dataset.slot).toBe("container");
	});

	it("names 'sidebar' when no sidebar is present", () => {
		expect(inspectArenaQuickNav()).toEqual({ ok: false, failedAt: "sidebar" });
	});

	it("names 'container' when the sidebar has no injection host", () => {
		buildSidebar({ container: false });
		expect(inspectArenaQuickNav()).toEqual({
			ok: false,
			failedAt: "container",
		});
	});

	it("falls back to the menu's parent when data-side=container is missing", () => {
		const sidebar = document.createElement("div");
		sidebar.setAttribute("data-sidebar", "sidebar");
		const inner = document.createElement("div");
		inner.id = "menu-parent";
		const menu = document.createElement("ul");
		menu.setAttribute("data-sidebar", "menu");
		inner.appendChild(menu);
		sidebar.appendChild(inner);
		document.body.appendChild(sidebar);

		const probe = inspectArenaQuickNav();
		expect(probe.ok).toBe(true);
		if (probe.ok) expect(probe.el.id).toBe("menu-parent");
	});

	it("never throws on a hostile partial structure", () => {
		document.body.innerHTML = `<div data-sidebar="sidebar"></div>`;
		expect(() => inspectArenaQuickNav()).not.toThrow();
	});
});

// resolveQuickNavContainer is what the three call sites in arenaSidebar.ts use.
// The property that matters is not "it warns" but "it warns exactly once per
// distinct failure": ensureArenaFolderEntry runs from a MutationObserver, and
// during page load the sidebar legitimately does not exist yet. A warn on every
// null would print hundreds of lines per load and bury the one line that says
// Arena changed its markup.
describe("resolveQuickNavContainer", () => {
	let warn: ReturnType<typeof vi.spyOn>;

	beforeEach(() => {
		resetQuickNavReport();
		warn = vi.spyOn(console, "warn").mockImplementation(() => {});
	});

	afterEach(() => {
		warn.mockRestore();
	});

	it("returns the container and stays quiet on the expected structure", () => {
		buildSidebar();
		expect(resolveQuickNavContainer()?.dataset.slot).toBe("container");
		expect(warn).not.toHaveBeenCalled();
	});

	it("returns null and names the broken level when the structure is wrong", () => {
		buildSidebar({ container: false });
		expect(resolveQuickNavContainer()).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain("container");
	});

	it("reports a repeated identical failure only once", () => {
		buildSidebar({ container: false });
		resolveQuickNavContainer();
		resolveQuickNavContainer();
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("reports again when a DIFFERENT level breaks", () => {
		buildSidebar({ container: false });
		resolveQuickNavContainer();

		document.body.innerHTML = "";
		resolveQuickNavContainer();

		expect(warn).toHaveBeenCalledTimes(2);
		expect(String(warn.mock.calls[0]?.[0])).toContain("container");
		expect(String(warn.mock.calls[1]?.[0])).toContain("sidebar");
	});

	it("re-latches after recovery, so a later break is reported", () => {
		buildSidebar({ container: false });
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(1);

		document.body.innerHTML = "";
		buildSidebar();
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(1);

		document.body.innerHTML = "";
		buildSidebar({ container: false });
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(2);
		expect(String(warn.mock.calls[1]?.[0])).toContain("container");
	});

	it("warns once, not once per observer tick, while the sidebar is absent", () => {
		resolveQuickNavContainer();
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});

describe("detectBattleMode", () => {
	it("fires when the Battle Mode tab is the active one (aria-selected)", () => {
		document.body.innerHTML = `
			<div role="tablist">
				<div role="tab" aria-selected="false">Direct Chat</div>
				<div role="tab" aria-selected="true">⚔️ Battle Mode</div>
			</div>`;
		expect(detectBattleMode()).toBe(true);
	});

	it("fires for the shadcn data-state=active variant", () => {
		document.body.innerHTML = `
			<div role="tablist">
				<div role="tab" data-state="inactive">Direct Chat</div>
				<div role="tab" data-state="active">Battle Mode</div>
			</div>`;
		expect(detectBattleMode()).toBe(true);
	});

	it("fires for a pressed battle toggle button", () => {
		document.body.innerHTML = `<button aria-pressed="true">Battle</button>`;
		expect(detectBattleMode()).toBe(true);
	});

	it("stays quiet when the battle tab is not the active one", () => {
		document.body.innerHTML = `
			<div role="tablist">
				<div role="tab" aria-selected="true">Direct Chat</div>
				<div role="tab" aria-selected="false">Battle Mode</div>
			</div>`;
		expect(detectBattleMode()).toBe(false);
	});

	it("fires when the full vote bar is present", () => {
		document.body.innerHTML = `
			<main>
				<button>👍 A is better</button>
				<button>👎 B is better</button>
				<button>🤝 Tie</button>
				<button>Both bad</button>
			</main>`;
		expect(detectBattleMode()).toBe(true);
	});

	it("fires at exactly three of the four vote labels", () => {
		document.body.innerHTML = `
			<button>A is better</button>
			<button>B is better</button>
			<button>Tie</button>`;
		expect(detectBattleMode()).toBe(true);
	});

	it("stays quiet below quorum — a chat about voting is not a battle", () => {
		document.body.innerHTML = `
			<button>Tie</button>
			<button>Both bad</button>`;
		expect(detectBattleMode()).toBe(false);
	});

	it("counts non-button vote controls via role=button", () => {
		document.body.innerHTML = `
			<div role="button">A is better</div>
			<div role="button">B is better</div>
			<div role="button">Tie</div>`;
		expect(detectBattleMode()).toBe(true);
	});

	it("ignores vote words in plain text — only controls count", () => {
		document.body.innerHTML = `
			<div>A is better than nothing, B is better still, tie them: both bad ideas</div>`;
		expect(detectBattleMode()).toBe(false);
	});

	it("stays quiet on an empty document", () => {
		expect(detectBattleMode()).toBe(false);
	});
});
