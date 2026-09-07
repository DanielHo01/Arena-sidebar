// Phase 1 bug fix: setupHistoryContextMenu was not idempotent and had no
// teardown. content.ts calls it once at bootstrap AND on every SPA route
// change, so each navigation added another document-level click listener,
// another keydown listener, and another MutationObserver watching all of
// document.body with subtree:true. Measured before the fix: 3 calls ->
// 3/3/3. Because every observer re-runs a full-body querySelectorAll on each
// mutation, the cost compounds with session count.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { setupHistoryContextMenu } from "../../src/ui/contextMenu";

let addSpy: ReturnType<typeof vi.spyOn>;
// Plain counters rather than vi.fn(): the inferred Mock type is not callable,
// and all we need is "how many times".
let observeCount = 0;
let disconnectCount = 0;

// folders.ts keeps a module-level singleton registration, which survives across
// tests in this file (Vitest isolates per file, not per test). Without this the
// idempotence guard short-circuits the 2nd+ test and its counters read zero.
// Runs before the spies are installed so its churn is not counted.
function disposeAnyRegistration() {
	setupHistoryContextMenu()();
}

beforeEach(() => {
	disposeAnyRegistration();
	document.body.innerHTML = '<a href="/c/abc123">Chat A</a>';
	document.head.innerHTML = "";
	addSpy = vi.spyOn(document, "addEventListener");

	// Wrap MutationObserver so construction and teardown can be counted while
	// keeping the real implementation. Only the constructor and disconnect are
	// overridden — observe is inherited untouched.
	observeCount = 0;
	disconnectCount = 0;
	const RealMO = globalThis.MutationObserver;
	vi.stubGlobal(
		"MutationObserver",
		class extends RealMO {
			constructor(cb: MutationCallback) {
				super(cb);
				observeCount++;
			}
			override disconnect(): void {
				disconnectCount++;
				super.disconnect();
			}
		},
	);
});

afterEach(() => {
	vi.unstubAllGlobals();
	vi.restoreAllMocks();
	document.body.innerHTML = "";
	document.head.innerHTML = "";
});

function countEvent(type: string): number {
	return (addSpy.mock.calls as unknown[][]).filter((c) => c[0] === type).length;
}

describe("setupHistoryContextMenu lifecycle", () => {
	it("registers exactly one click and one keydown listener", () => {
		setupHistoryContextMenu();
		expect(countEvent("click")).toBe(1);
		expect(countEvent("keydown")).toBe(1);
	});

	it("is idempotent: calling it on every route change does not stack listeners", () => {
		setupHistoryContextMenu();
		setupHistoryContextMenu();
		setupHistoryContextMenu();
		// Before the fix this was 3 / 3.
		expect(countEvent("click")).toBe(1);
		expect(countEvent("keydown")).toBe(1);
	});

	it("creates exactly one body-wide MutationObserver no matter how many calls", () => {
		setupHistoryContextMenu();
		setupHistoryContextMenu();
		setupHistoryContextMenu();
		// Before the fix this was 3.
		expect(observeCount).toBe(1);
	});

	it("returns a disposer function", () => {
		const dispose = setupHistoryContextMenu() as unknown;
		expect(typeof dispose).toBe("function");
	});

	it("the disposer removes its listeners and disconnects the observer", () => {
		const removeSpy = vi.spyOn(document, "removeEventListener");
		const dispose = setupHistoryContextMenu();
		dispose();
		const removed = removeSpy.mock.calls.map((c) => c[0]);
		expect(removed).toContain("click");
		expect(removed).toContain("keydown");
		expect(disconnectCount).toBe(1);
	});

	it("can be set up again after being disposed", () => {
		const dispose = setupHistoryContextMenu();
		dispose();
		const dispose2 = setupHistoryContextMenu();
		expect(typeof dispose2).toBe("function");
		// two constructions total (one per setup), never more
		expect(observeCount).toBe(2);
	});

	it("still injects its stylesheet exactly once", () => {
		setupHistoryContextMenu();
		setupHistoryContextMenu();
		expect(
			document.head.querySelectorAll("#ai-sidebar-ctx-style"),
		).toHaveLength(1);
	});

	it("still binds the contextmenu handler to history links", () => {
		setupHistoryContextMenu();
		const link = document.querySelector<HTMLAnchorElement>('a[href*="/c/"]')!;
		expect(link.dataset.aiSidebarCtxBound).toBe("1");
	});
});
