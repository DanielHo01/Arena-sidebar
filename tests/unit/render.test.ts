// The reconciler: decides whether the UI must change, and changes it.
//
// ui/render.ts was at 0% coverage. Its fast path is the reason the file exists
// at all -- refreshUI is called from an 800ms-debounced MutationObserver and a
// 30s timer, and rebuilding the whole panel DOM on every call was the
// extension's main source of jank. A regression here does not break the
// extension; it makes it slow, which no other test would notice.

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type Mock,
} from "vitest";

import type { SidebarRound } from "../../src/types";

// Mock the panel layer so this file tests the decision, not the DOM building.
const hooks = vi.hoisted(() => ({
	ensureStyles: vi.fn(),
	ensurePanelSkeleton: vi.fn(),
	reconcileList: vi.fn(),
	refreshCurrentHighlight: vi.fn(),
	setupScrollHighlight: vi.fn(),
	buildFab: vi.fn(() => {
		const el = document.createElement("button");
		el.className = "fab";
		return el;
	}),
}));

vi.mock("../../src/ui/panel", () => ({
	ensureStyles: hooks.ensureStyles,
	ensurePanelSkeleton: hooks.ensurePanelSkeleton,
	reconcileList: hooks.reconcileList,
	refreshCurrentHighlight: hooks.refreshCurrentHighlight,
	setupScrollHighlight: hooks.setupScrollHighlight,
}));
vi.mock("../../src/ui/fab", () => ({ buildFab: hooks.buildFab }));

import { renderUI } from "../../src/ui/render";
import { conversationStore } from "../../src/conversationStore";
import { panel } from "../../src/state";

function round(id: string): SidebarRound {
	return { id, title: id, messageCount: 2, index: 0, hasAnchor: true };
}

/**
 * Restore every mock's default behaviour, not just its call log.
 *
 * `vi.clearAllMocks()` clears recorded calls but leaves implementations in
 * place, so a mockImplementation set inside one test leaks into every later
 * test. That is how the route test below saw the fast path taken on its second
 * call: a previous test had taught ensurePanelSkeleton to build a .panel, so
 * the "is the panel DOM there" half of the guard passed when it should not
 * have. mockReset clears both, then the defaults are reinstalled.
 */
function resetHooks(): void {
	for (const fn of Object.values(hooks)) fn.mockReset();
	hooks.ensurePanelSkeleton.mockImplementation((root: ShadowRoot) => {
		withPanel(root, { list: true });
	});
	hooks.buildFab.mockImplementation(() => {
		const el = document.createElement("button");
		el.className = "fab";
		return el;
	});
}

/** Clear recorded calls only, keeping the default implementations. */
function clearCalls(): void {
	for (const fn of Object.values(hooks)) fn.mockClear();
}

function makeShadow(): ShadowRoot {
	const host = document.createElement("div");
	document.body.appendChild(host);
	return host.attachShadow({ mode: "open" });
}

/** Put a .panel (and optionally a .list) into the shadow root. */
function withPanel(shadow: ShadowRoot, opts: { list?: boolean } = {}): void {
	const p = document.createElement("div");
	p.className = "panel";
	if (opts.list) {
		const l = document.createElement("div");
		l.className = "list";
		p.appendChild(l);
	}
	const t = document.createElement("div");
	t.className = "panel-title";
	p.appendChild(t);
	shadow.appendChild(p);
}

describe("renderUI", () => {
	let shadow: ShadowRoot;
	let onRefresh: Mock<() => void>;

	beforeEach(() => {
		document.body.innerHTML = "";
		conversationStore.messages = [];
		conversationStore.rounds = [];
		panel.isOpen = false;
		panel.searchQuery = "";
		panel.reverseOrder = false;
		panel.currentRoundIdx = 0;
		panel.highlightInitialized = false;
		panel.lastRenderKey = "";
		shadow = makeShadow();
		onRefresh = vi.fn();
		resetHooks();
	});

	afterEach(() => {
		conversationStore.messages = [];
		conversationStore.rounds = [];
	});

	describe("the fast path", () => {
		it("skips the rebuild when nothing the output depends on changed", () => {
			conversationStore.rounds = [round("r1")];
			conversationStore.messages = [
				{ id: "m1", role: "user", content: "hi" } as never,
			];
			panel.isOpen = true;
			renderUI(shadow, onRefresh);
			clearCalls();

			renderUI(shadow, onRefresh);

			expect(hooks.reconcileList).not.toHaveBeenCalled();
			expect(hooks.ensurePanelSkeleton).not.toHaveBeenCalled();
			// Styles are still ensured, and the counter is refreshed in place.
			expect(hooks.ensureStyles).toHaveBeenCalledWith(shadow);
			expect(shadow.querySelector(".panel-title")!.textContent).toBe(
				"1 loaded rounds",
			);
		});

		it("re-renders once the round set changes", () => {
			conversationStore.rounds = [round("r1")];
			conversationStore.messages = [
				{ id: "m1", role: "user", content: "hi" } as never,
			];
			panel.isOpen = true;
			renderUI(shadow, onRefresh);
			clearCalls();
			conversationStore.rounds = [round("r1"), round("r2")];
			conversationStore.messages = [
				{ id: "m1", role: "user", content: "hi" } as never,
				{ id: "m2", role: "assistant", content: "yo" } as never,
			];

			renderUI(shadow, onRefresh);

			expect(hooks.reconcileList).toHaveBeenCalled();
		});

		it("always re-renders while a search is active", () => {
			// The list is filtered on every call, so it is cheaper to re-render
			// than to reason about the highlight state.
			conversationStore.rounds = [round("r1")];
			conversationStore.messages = [
				{ id: "m1", role: "user", content: "hi" } as never,
			];
			panel.isOpen = true;
			panel.searchQuery = "hello";
			renderUI(shadow, onRefresh);
			clearCalls();

			renderUI(shadow, onRefresh);

			expect(hooks.reconcileList).toHaveBeenCalled();
		});

		it("does not take the fast path when the panel DOM is missing", () => {
			conversationStore.rounds = [round("r1")];
			conversationStore.messages = [
				{ id: "m1", role: "user", content: "hi" } as never,
			];
			panel.isOpen = true;
			// Prime the key without leaving a .panel behind.
			panel.lastRenderKey = JSON.stringify([true, "", false, ["r1"]]);

			renderUI(shadow, onRefresh);

			expect(hooks.ensurePanelSkeleton).toHaveBeenCalled();
		});
	});

	it("renders nothing but styles when there are no messages", () => {
		renderUI(shadow, onRefresh);

		expect(hooks.ensureStyles).toHaveBeenCalledWith(shadow);
		expect(hooks.buildFab).not.toHaveBeenCalled();
		expect(hooks.ensurePanelSkeleton).not.toHaveBeenCalled();
	});

	describe("FAB mode (panel closed)", () => {
		beforeEach(() => {
			conversationStore.rounds = [round("r1"), round("r2")];
			conversationStore.messages = [
				{ id: "m1", role: "user", content: "hi" } as never,
			];
			panel.isOpen = false;
		});

		it("builds a FAB carrying the round count", () => {
			renderUI(shadow, onRefresh);

			expect(hooks.buildFab).toHaveBeenCalledWith(2);
			const fab = shadow.querySelector(".fab")!;
			expect(fab.getAttribute("data-msg-count")).toBe("2");
		});

		it("leaves an existing FAB alone when the count has not moved", () => {
			renderUI(shadow, onRefresh);
			const first = shadow.querySelector(".fab");
			clearCalls();
			panel.lastRenderKey = ""; // force past the fast path

			renderUI(shadow, onRefresh);

			expect(hooks.buildFab).not.toHaveBeenCalled();
			expect(shadow.querySelector(".fab")).toBe(first);
		});

		it("rebuilds the FAB when the count moves", () => {
			renderUI(shadow, onRefresh);
			clearCalls();
			panel.lastRenderKey = "";
			conversationStore.rounds = [round("r1"), round("r2"), round("r3")];

			renderUI(shadow, onRefresh);

			expect(hooks.buildFab).toHaveBeenCalledWith(3);
			expect(shadow.querySelector(".fab")!.getAttribute("data-msg-count")).toBe(
				"3",
			);
		});

		it("removes a leftover panel when switching back to FAB mode", () => {
			withPanel(shadow, { list: true });

			renderUI(shadow, onRefresh);

			expect(shadow.querySelector(".panel")).toBeNull();
			expect(shadow.querySelector(".fab")).not.toBeNull();
		});
	});

	describe("panel mode (panel open)", () => {
		beforeEach(() => {
			conversationStore.rounds = [round("r1"), round("r2")];
			conversationStore.messages = [
				{ id: "m1", role: "user", content: "hi" } as never,
			];
			panel.isOpen = true;
		});

		it("removes the FAB and reconciles the list", () => {
			const fab = document.createElement("button");
			fab.className = "fab";
			shadow.appendChild(fab);

			renderUI(shadow, onRefresh);

			expect(shadow.querySelector(".fab")).toBeNull();
			expect(hooks.ensurePanelSkeleton).toHaveBeenCalledWith(
				shadow,
				2,
				1,
				onRefresh,
			);
			expect(hooks.reconcileList).toHaveBeenCalled();
			expect(hooks.refreshCurrentHighlight).toHaveBeenCalled();
		});

		it("reverses the round order when reverseOrder is on", () => {
			panel.reverseOrder = true;

			renderUI(shadow, onRefresh);

			const passed = hooks.reconcileList.mock.calls[0]![1] as SidebarRound[];
			expect(passed.map((r) => r.id)).toEqual(["r2", "r1"]);
		});

		it("initialises the scroll highlight once", () => {
			renderUI(shadow, onRefresh);
			expect(hooks.setupScrollHighlight).toHaveBeenCalledTimes(1);
			expect(panel.highlightInitialized).toBe(true);

			panel.lastRenderKey = "";
			renderUI(shadow, onRefresh);
			expect(hooks.setupScrollHighlight).toHaveBeenCalledTimes(1);
		});

		it("does not steal the highlight while a search is active", () => {
			panel.searchQuery = "hello";
			renderUI(shadow, onRefresh);

			expect(hooks.setupScrollHighlight).not.toHaveBeenCalled();
			expect(panel.highlightInitialized).toBe(false);
		});
	});

	describe("host attribute sync", () => {
		beforeEach(() => {
			conversationStore.rounds = [round("r1"), round("r2")];
			conversationStore.messages = [
				{ id: "m1", role: "user", content: "hi" } as never,
			];
			panel.isOpen = true;
		});

		it("mirrors panel state onto the host element", () => {
			const host = document.createElement("div");
			host.id = "__edge_ai_sidebar_host";
			document.body.appendChild(host);

			renderUI(shadow, onRefresh);

			expect(host.getAttribute("data-ai-sidebar-open")).toBe("1");
			expect(host.getAttribute("data-ai-sidebar-rounds")).toBe("2");
			expect(host.getAttribute("data-ai-sidebar-msgs")).toBe("1");
		});

		it("reports the mode from the current route", () => {
			const host = document.createElement("div");
			host.id = "__edge_ai_sidebar_host";
			document.body.appendChild(host);
			const original = location.pathname;
			try {
				history.pushState({}, "", "/c/abc123");
				renderUI(shadow, onRefresh);
				expect(host.getAttribute("data-ai-sidebar-mode")).toBe("character");

				// The pathname is not part of renderKey, so a route change on its
				// own does not invalidate the fast path. Drop the key to force a
				// real render, which is what a route change does in production:
				// handleRouteChange clears the store, so the round ids move.
				history.pushState({}, "", original);
				panel.lastRenderKey = "";
				renderUI(shadow, onRefresh);
				expect(host.getAttribute("data-ai-sidebar-mode")).toBe("direct");
			} finally {
				history.pushState({}, "", original);
			}
		});

		it("leaves host attributes stale on the fast path", () => {
			// Pinned as-is rather than "fixed": syncHostAttributes runs after the
			// fast-path return, so a render that changes nothing leaves the
			// attributes at their previous values. data-ai-sidebar-mode is the one
			// that can drift, since the pathname is not in renderKey. Correcting it
			// would mean four setAttribute calls on every debounced observer tick,
			// which is exactly the work the fast path exists to skip.
			const host = document.createElement("div");
			host.id = "__edge_ai_sidebar_host";
			document.body.appendChild(host);
			const original = location.pathname;
			try {
				renderUI(shadow, onRefresh);
				expect(host.getAttribute("data-ai-sidebar-mode")).toBe("direct");

				history.pushState({}, "", "/c/abc123");
				renderUI(shadow, onRefresh);

				expect(host.getAttribute("data-ai-sidebar-mode")).toBe("direct");
			} finally {
				history.pushState({}, "", original);
			}
		});

		it("is a no-op when the host element is absent", () => {
			expect(() => renderUI(shadow, onRefresh)).not.toThrow();
		});
	});
});
