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
	SIDEBAR_WRAPPER_SELECTOR,
	findArenaSidebarWrapper,
	inspectArenaQuickNav,
	queryHistoryLinks,
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

	it("SCROLL_CONTAINER_SELECTOR requires all three classes under main", () => {
		document.body.innerHTML = `
			<main><div><div class="h-full w-full overscroll-none">real</div></div></main>
			<div><div class="h-full w-full overscroll-none">outside-main</div></div>`;
		const hit = document.querySelector(SCROLL_CONTAINER_SELECTOR);
		expect(hit?.textContent).toBe("real");
	});

	it("SCROLL_CONTAINER_SELECTOR does not match a partial class list", () => {
		document.body.innerHTML = `<main><div><div class="h-full w-full">x</div></div></main>`;
		expect(document.querySelector(SCROLL_CONTAINER_SELECTOR)).toBeNull();
	});

	it("SIDEBAR_WRAPPER_SELECTOR matches the class substring Arena uses", () => {
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
	it("finds the wrapper", () => {
		buildSidebar();
		expect(findArenaSidebarWrapper()?.className).toContain("sidebar-wrapper");
	});

	it("returns null when Arena has not rendered it yet", () => {
		expect(findArenaSidebarWrapper()).toBeNull();
	});
});

// The index path children[0] -> [1] -> [0] -> [2] is the most fragile thing in
// the codebase: it encodes Arena's DOM order, nothing semantic. A bare null
// collapses six different breakages into one value, and all three call sites in
// arenaSidebar.ts bail out silently on it -- so when Arena ships a redesign the
// extension stops rendering and nothing says which assumption died.
//
// inspectArenaQuickNav names the failing level instead, and
// resolveQuickNavContainer reports it. Both are pinned here because these are
// the assertions that should fail when Arena changes its markup.
describe("inspectArenaQuickNav", () => {
	it("returns the element on the expected structure", () => {
		buildSidebar();
		const probe = inspectArenaQuickNav();
		expect(probe.ok).toBe(true);
		if (probe.ok) expect(probe.el.dataset.slot).toBe("nav2");
	});

	it("names 'wrapper' when the sidebar wrapper is absent", () => {
		expect(inspectArenaQuickNav()).toEqual({ ok: false, failedAt: "wrapper" });
	});

	it("names 'floating' when the wrapper has no children", () => {
		document.body.innerHTML = `<div class="sidebar-wrapper"></div>`;
		expect(inspectArenaQuickNav()).toEqual({
			ok: false,
			failedAt: "floating",
		});
	});

	it("names 'bg-sidebar' when the floating container is too small", () => {
		buildSidebar({ floatingChildren: 1 });
		expect(inspectArenaQuickNav()).toEqual({
			ok: false,
			failedAt: "bg-sidebar",
		});
	});

	it("names 'floating-root' when bg-sidebar is empty", () => {
		buildSidebar({ bgChildren: 0 });
		expect(inspectArenaQuickNav()).toEqual({
			ok: false,
			failedAt: "floating-root",
		});
	});

	it("names 'quick-nav' when the nav slot is missing", () => {
		buildSidebar({ rootChildren: 2 });
		expect(inspectArenaQuickNav()).toEqual({
			ok: false,
			failedAt: "quick-nav",
		});
	});

	it("names 'nav-tag' when slot 2 exists but is not a DIV", () => {
		buildSidebar({ navTag: "span" });
		expect(inspectArenaQuickNav()).toEqual({
			ok: false,
			failedAt: "nav-tag",
		});
	});

	it("never throws on a hostile partial structure", () => {
		document.body.innerHTML = `<div class="sidebar-wrapper"></div>`;
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
		expect(resolveQuickNavContainer()?.dataset.slot).toBe("nav2");
		expect(warn).not.toHaveBeenCalled();
	});

	it("returns null and names the broken level when the structure is wrong", () => {
		buildSidebar({ rootChildren: 2 });
		expect(resolveQuickNavContainer()).toBeNull();
		expect(warn).toHaveBeenCalledTimes(1);
		expect(String(warn.mock.calls[0]?.[0])).toContain("quick-nav");
	});

	it("reports a repeated identical failure only once", () => {
		// The anti-spam property. The observer fires on every mutation.
		buildSidebar({ rootChildren: 2 });
		resolveQuickNavContainer();
		resolveQuickNavContainer();
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(1);
	});

	it("reports again when a DIFFERENT level breaks", () => {
		buildSidebar({ rootChildren: 2 });
		resolveQuickNavContainer();

		document.body.innerHTML = "";
		resolveQuickNavContainer();

		expect(warn).toHaveBeenCalledTimes(2);
		expect(String(warn.mock.calls[0]?.[0])).toContain("quick-nav");
		expect(String(warn.mock.calls[1]?.[0])).toContain("wrapper");
	});

	it("re-latches after recovery, so a later break is reported", () => {
		buildSidebar({ rootChildren: 2 });
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(1);

		// Arena finishes rendering: the container returns and stays quiet.
		document.body.innerHTML = "";
		buildSidebar();
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(1);

		// A redesign lands later in the same page session.
		document.body.innerHTML = "";
		buildSidebar({ navTag: "span" });
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(2);
		expect(String(warn.mock.calls[1]?.[0])).toContain("nav-tag");
	});

	it("warns once, not once per observer tick, while the sidebar is absent", () => {
		// The common page-load case: no wrapper at all, probed repeatedly.
		resolveQuickNavContainer();
		resolveQuickNavContainer();
		expect(warn).toHaveBeenCalledTimes(1);
	});
});
