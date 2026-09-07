// platform/arenaDom.ts — every selector that encodes knowledge of arena.ai's
// DOM structure, in one place.
//
// These are the parts of the codebase that break when Arena ships a redesign, so
// they are worth pinning with tests: when Arena changes, these tests fail and
// point at exactly which assumption died, instead of the extension silently
// rendering nothing.
import { beforeEach, describe, expect, it } from "vitest";
import {
	HISTORY_LINK_SELECTOR,
	SCROLL_CONTAINER_SELECTOR,
	SIDEBAR_WRAPPER_SELECTOR,
	findArenaQuickNavContainer,
	findArenaSidebarWrapper,
	queryHistoryLinks,
} from "../../src/platform/arenaDom";

/** Build Arena's sidebar skeleton: wrapper > [0] floating > [1] bg > [0] root > [2] nav */
function buildSidebar({
	wrapperClass = "x sidebar-wrapper y",
	floatingChildren = 2,
	bgChildren = 1,
	rootChildren = 3,
	navTag = "div",
} = {}) {
	const wrapper = document.createElement("div");
	wrapper.className = wrapperClass;

	const floating = document.createElement("div");
	wrapper.appendChild(floating);

	// children[0] is an unrelated sibling; children[1] IS the bg-sidebar.
	for (let i = 0; i < floatingChildren - 1; i++) {
		floating.appendChild(document.createElement("span"));
	}
	const bgSidebar = document.createElement("div");
	floating.appendChild(bgSidebar);

	const floatingRoot = document.createElement("div");
	if (bgChildren > 0) bgSidebar.appendChild(floatingRoot);

	for (let i = 0; i < rootChildren; i++) {
		const child =
			i === 2 ? document.createElement(navTag) : document.createElement("span");
		child.dataset.slot = "nav" + i;
		floatingRoot.appendChild(child);
	}

	document.body.appendChild(wrapper);
	return wrapper;
}

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

describe("findArenaQuickNavContainer", () => {
	it("returns the quick-nav container on the expected structure", () => {
		buildSidebar();
		const nav = findArenaQuickNavContainer();
		expect(nav).not.toBeNull();
		expect(nav?.dataset.slot).toBe("nav2");
	});

	it("returns null when the wrapper is absent", () => {
		expect(findArenaQuickNavContainer()).toBeNull();
	});

	it("returns null when the floating container has too few children", () => {
		buildSidebar({ floatingChildren: 1 });
		expect(findArenaQuickNavContainer()).toBeNull();
	});

	it("returns null when bg-sidebar is empty", () => {
		buildSidebar({ bgChildren: 0 });
		expect(findArenaQuickNavContainer()).toBeNull();
	});

	it("returns null when the nav slot is missing", () => {
		buildSidebar({ rootChildren: 2 });
		expect(findArenaQuickNavContainer()).toBeNull();
	});

	it("returns null when slot 2 is not a DIV", () => {
		buildSidebar({ navTag: "span" });
		expect(findArenaQuickNavContainer()).toBeNull();
	});

	it("never throws on a hostile partial structure", () => {
		document.body.innerHTML = `<div class="sidebar-wrapper"></div>`;
		expect(() => findArenaQuickNavContainer()).not.toThrow();
		expect(findArenaQuickNavContainer()).toBeNull();
	});
});
