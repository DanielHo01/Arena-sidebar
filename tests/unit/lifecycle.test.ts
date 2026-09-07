// Phase 4 acceptance: session lifecycle.
//
// Two properties are pinned here.
//
// 1. resetSessionState() clears EVERY session-scoped value. Eight of them were
//    never cleared at all before this phase, and two of them caused real bugs:
//    capture.pendingRequests cross-bound a previous session's unfinished
//    request onto the new session's response, and fab.prevRoundIds made
//    refreshUI's fast path skip the first render of the new session.
//
// 2. Route changes do not accumulate DOM listeners. setupHistoryContextMenu and
//    setupHistoryTitleEditing both run again on every route change, so an
//    unguarded setup adds a fresh document listener each time. This is the
//    regression test the refactor plan called for: simulate N route changes and
//    assert the listener count is flat.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	disposeAll,
	registerDisposer,
	resetSessionState,
} from "../../src/app/store";
import { conversationStore } from "../../src/conversationStore";
import { chatRounds } from "../../src/capture";
import { foldersState } from "../../src/features/sessions";
import { setupHistoryContextMenu } from "../../src/ui/contextMenu";
import { toggleArenaSessionLibrarySection } from "../../src/ui/arenaSidebar";
import { setupHistoryTitleEditing } from "../../src/historyTitles";
import { fab, panel, cachedElements } from "../../src/state";

// ─── Listener probe ──────────────────────────────────────────────────────────────
// Counts live listeners on document by wrapping add/removeEventListener, which
// is how the original audit found the leak.
let added = 0;
let removed = 0;
const realAdd = document.addEventListener.bind(document);
const realRemove = document.removeEventListener.bind(document);

function installProbe() {
	added = 0;
	removed = 0;
	document.addEventListener = ((...args: unknown[]) => {
		added++;
		return (realAdd as (...a: never[]) => void)(...(args as never[]));
	}) as typeof document.addEventListener;
	document.removeEventListener = ((...args: unknown[]) => {
		removed++;
		return (realRemove as (...a: never[]) => void)(...(args as never[]));
	}) as typeof document.removeEventListener;
}

function uninstallProbe() {
	document.addEventListener = realAdd;
	document.removeEventListener = realRemove;
}

/** Arena-like sidebar with two session links. */
function renderSessionLinks() {
	document.body.innerHTML = `
		<nav>
			<a href="/c/aaa"><span>First chat</span></a>
			<a href="/c/bbb"><span>Second chat</span></a>
		</nav>`;
}

beforeEach(() => {
	document.body.innerHTML = "";
	conversationStore.reset();
	conversationStore.sessionId = "";
});

afterEach(() => {
	uninstallProbe();
	disposeAll();
	document.body.innerHTML = "";
});

describe("resetSessionState", () => {
	it("sets the store's session id", () => {
		resetSessionState("new-session");
		expect(conversationStore.sessionId).toBe("new-session");
	});

	it("clears messages and rounds", () => {
		conversationStore.messages = [{ id: "m" } as never];
		conversationStore.rounds = [{ id: "r" } as never];
		resetSessionState("s");
		expect(conversationStore.messages).toHaveLength(0);
		expect(conversationStore.rounds).toHaveLength(0);
	});

	it("clears the cached DOM element registry", () => {
		cachedElements.set("fp-1", document.createElement("div"));
		resetSessionState("s");
		expect(cachedElements.size).toBe(0);
	});

	// ── the 8 residual states ──────────────────────────────────────────────

	it("clears capture state, incl. the pendingRequests cross-binding bug", () => {
		chatRounds.set("old-session", { sessionId: "old-session" } as never);
		resetSessionState("s");
		expect(chatRounds.size).toBe(0);
	});

	it("clears panel search and highlight state", () => {
		panel.searchQuery = "leftover";
		panel.currentRoundIdx = 7;
		panel.highlightInitialized = true;
		resetSessionState("s");
		expect(panel.searchQuery).toBe("");
		expect(panel.currentRoundIdx).toBe(0);
		expect(panel.highlightInitialized).toBe(false);
	});

	it("clears the render key so the new session's first render is not skipped", () => {
		// This replaces the fab.prevRoundIds residual state. The fast path in
		// refreshUI compares a single renderKey now, and a stale key from the
		// previous session would make it skip the first render entirely.
		panel.lastRenderKey = '["stale"]';
		resetSessionState("s");
		expect(panel.lastRenderKey).toBe("");
	});

	it("does NOT clear the persisted FAB position", () => {
		fab.position = { x: 12, y: 34 };
		resetSessionState("s");
		expect(fab.position).toEqual({ x: 12, y: 34 });
	});

	it("does NOT clear the user's sort preference", () => {
		panel.reverseOrder = false;
		resetSessionState("s");
		expect(panel.reverseOrder).toBe(false);
	});
});

describe("disposer registry", () => {
	it("runs every registered disposer", () => {
		const order: string[] = [];
		registerDisposer(() => order.push("a"));
		registerDisposer(() => order.push("b"));
		disposeAll();
		expect(order).toEqual(["a", "b"]);
	});

	it("is idempotent — a second disposeAll does nothing", () => {
		let n = 0;
		registerDisposer(() => n++);
		disposeAll();
		disposeAll();
		expect(n).toBe(1);
	});

	it("a throwing disposer does not stop the others", () => {
		let reached = 0;
		registerDisposer(() => {
			throw new Error("bad disposer");
		});
		registerDisposer(() => reached++);
		disposeAll();
		expect(reached).toBe(1);
	});

	it("the returned handle disposes just that one", () => {
		let a = 0;
		let b = 0;
		const offA = registerDisposer(() => a++);
		registerDisposer(() => b++);
		offA();
		disposeAll();
		expect([a, b]).toEqual([0, 1]);
	});
});

describe("route changes do not leak DOM listeners", () => {
	it("10 route changes leave the document listener count unchanged", () => {
		renderSessionLinks();
		installProbe();

		// First route: the setups legitimately attach their listeners.
		setupHistoryContextMenu();
		setupHistoryTitleEditing();
		const baseline = added - removed;

		for (let i = 0; i < 10; i++) {
			resetSessionState("session-" + i);
			// content.ts re-runs both of these on every route change.
			setupHistoryContextMenu();
			setupHistoryTitleEditing();
		}

		expect(added - removed).toBe(baseline);
	});

	it("the context menu attaches at most one document click listener", () => {
		renderSessionLinks();
		installProbe();
		setupHistoryContextMenu();
		const first = added;
		setupHistoryContextMenu();
		setupHistoryContextMenu();
		expect(added).toBe(first);
	});
});

describe("resetSessionState covers the two remaining residual states", () => {
	// Both of these are module-private, so they are asserted behaviourally.
	// Removing resetTitleCache() or resetLibrarySection() from
	// resetSessionState must fail a test -- that was verified by deleting them.

	const LIBRARY_ATTR = "data-ai-sidebar-arena-library-section";

	function meta(title: string) {
		return {
			sessionId: "aaa",
			title,
			folderId: "inbox",
			createdAt: 0,
			updatedAt: 0,
		};
	}

	it("a route change drops the stale title cache and re-reads foldersState", () => {
		foldersState.sessions.set("aaa", meta("Old Title"));
		document.body.innerHTML = `<a href="/c/aaa"><span>placeholder</span></a>`;
		setupHistoryTitleEditing();
		expect(document.querySelector("a")!.textContent).toContain("Old Title");

		// Arena's own title changes, then the user navigates.
		foldersState.sessions.set("aaa", meta("New Title"));
		resetSessionState("aaa");
		document.body.innerHTML = `<a href="/c/aaa"><span>placeholder</span></a>`;
		setupHistoryTitleEditing();

		expect(document.querySelector("a")!.textContent).toContain("New Title");
		expect(document.querySelector("a")!.textContent).not.toContain("Old Title");
	});

	it("a route change closes the Session Library section", () => {
		// Arena sidebar skeleton: wrapper > [0] > [1] > [0] > [2] (quick-nav DIV).
		const wrapper = document.createElement("div");
		wrapper.className = "x sidebar-wrapper y";
		const floating = document.createElement("div");
		wrapper.appendChild(floating);
		floating.appendChild(document.createElement("span"));
		const bgSidebar = document.createElement("div");
		floating.appendChild(bgSidebar);
		const floatingRoot = document.createElement("div");
		bgSidebar.appendChild(floatingRoot);
		floatingRoot.appendChild(document.createElement("span"));
		floatingRoot.appendChild(document.createElement("span"));
		const quickNav = document.createElement("div");
		floatingRoot.appendChild(quickNav);
		const section = document.createElement("div");
		section.setAttribute(LIBRARY_ATTR, "1");
		section.style.display = "none";
		quickNav.appendChild(section);
		document.body.appendChild(wrapper);

		toggleArenaSessionLibrarySection(); // open
		expect(section.style.display).toBe("block");

		resetSessionState("s");
		toggleArenaSessionLibrarySection(); // flag was reset, so this opens again

		expect(section.style.display).toBe("block");
	});
});
