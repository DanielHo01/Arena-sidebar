// The panel's keyboard shortcuts.
//
// ui/keyboard.ts was at 0% coverage. Its whole job is a set of edge conditions:
// which keys work when the panel is closed, and which ones must stand aside so
// Arena's own inputs keep their keys. Those conditions are exactly what a
// regression would quietly break -- a hijacked arrow key in the search box is
// not a crash, it is just an extension that feels broken.

import {
	afterEach,
	beforeEach,
	describe,
	expect,
	it,
	vi,
	type Mock,
} from "vitest";

import { setupKeyboardShortcuts } from "../../src/ui/keyboard";
import { panel } from "../../src/state";

/** Build a shadow root holding a .list with n rows. */
function makePanel(n: number): ShadowRoot {
	const host = document.createElement("div");
	document.body.appendChild(host);
	const shadow = host.attachShadow({ mode: "open" });
	const list = document.createElement("div");
	list.className = "list";
	for (let i = 0; i < n; i++) {
		const item = document.createElement("div");
		item.className = "item";
		item.dataset.roundIdx = String(i);
		item.dataset.roundId = `r${i}`;
		list.appendChild(item);
	}
	shadow.appendChild(list);
	return shadow;
}

function items(shadow: ShadowRoot): HTMLElement[] {
	return [...shadow.querySelectorAll<HTMLElement>(".item")];
}

function currentIdx(shadow: ShadowRoot): number {
	return items(shadow).findIndex((el) => el.classList.contains("current"));
}

/** jsdom ships no scrollIntoView at all; calling it throws. */
function stubScrollIntoView(): ReturnType<typeof vi.fn> {
	const fn = vi.fn();
	Element.prototype.scrollIntoView = fn as unknown as () => void;
	return fn;
}

function key(
	target: EventTarget,
	init: KeyboardEventInit & { key: string },
): KeyboardEvent {
	const ev = new KeyboardEvent("keydown", {
		bubbles: true,
		cancelable: true,
		...init,
	});
	target.dispatchEvent(ev);
	return ev;
}

/**
 * Every disposer handed back by setupKeyboardShortcuts, released after each test.
 *
 * Load-bearing, not tidiness: the listener is attached to `document`, which
 * survives `document.body.innerHTML = ""`. Without this, listeners accumulate
 * across tests and a single keydown fires all of them, mutating the shared
 * panel.currentRoundIdx once per leaked listener. That is how a test expecting
 * the selection to move to 1 saw 3.
 */
const disposers: Array<() => void> = [];

function setup(shadow: ShadowRoot, refreshUI: Mock<() => void>): () => void {
	const dispose = setupKeyboardShortcuts(shadow, refreshUI);
	disposers.push(dispose);
	return dispose;
}

describe("setupKeyboardShortcuts", () => {
	let shadow: ShadowRoot;
	let refreshUI: Mock<() => void>;

	beforeEach(() => {
		document.body.innerHTML = "";
		// panel is module-level state shared with the whole test process.
		panel.isOpen = false;
		panel.currentRoundIdx = 0;
		shadow = makePanel(4);
		refreshUI = vi.fn();
		stubScrollIntoView();
	});

	afterEach(() => {
		// Detach every listener before the next test, or it keeps reacting to that
		// test's keydowns through the shared `panel` state.
		while (disposers.length) disposers.pop()?.();
	});

	it("opens the panel on Alt+S even when it is closed", () => {
		setup(shadow, refreshUI);

		const ev = key(document, { key: "s", altKey: true });

		expect(panel.isOpen).toBe(true);
		expect(refreshUI).toHaveBeenCalledTimes(1);
		expect(ev.defaultPrevented).toBe(true);
	});

	it("closes the panel on a second Alt+S", () => {
		setup(shadow, refreshUI);
		panel.isOpen = true;

		key(document, { key: "S", altKey: true });

		expect(panel.isOpen).toBe(false);
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	it("ignores a bare S without Alt", () => {
		setup(shadow, refreshUI);

		key(document, { key: "s" });

		expect(panel.isOpen).toBe(false);
		expect(refreshUI).not.toHaveBeenCalled();
	});

	it("ignores every navigation key while the panel is closed", () => {
		setup(shadow, refreshUI);
		panel.isOpen = false;

		key(document, { key: "ArrowDown" });
		key(document, { key: "ArrowUp" });
		key(document, { key: "Enter" });
		key(document, { key: "Escape" });

		expect(panel.currentRoundIdx).toBe(0);
		expect(refreshUI).not.toHaveBeenCalled();
	});

	it("moves the selection down and marks the new row current", () => {
		setup(shadow, refreshUI);
		panel.isOpen = true;

		key(document, { key: "ArrowDown" });

		expect(panel.currentRoundIdx).toBe(1);
		// refreshCurrentHighlight is the real implementation, so the class is the
		// observable proof that the panel and the state agree.
		expect(currentIdx(shadow)).toBe(1);
	});

	it("moves the selection up", () => {
		setup(shadow, refreshUI);
		panel.isOpen = true;
		panel.currentRoundIdx = 2;

		key(document, { key: "ArrowUp" });

		expect(panel.currentRoundIdx).toBe(1);
		expect(currentIdx(shadow)).toBe(1);
	});

	it("clamps at both ends instead of selecting nothing", () => {
		setup(shadow, refreshUI);
		panel.isOpen = true;

		key(document, { key: "ArrowUp" });
		expect(panel.currentRoundIdx).toBe(0);

		panel.currentRoundIdx = 3;
		key(document, { key: "ArrowDown" });
		expect(panel.currentRoundIdx).toBe(3);
	});

	it("scrolls the selected row into view", () => {
		const scroll = stubScrollIntoView();
		setup(shadow, refreshUI);
		panel.isOpen = true;

		key(document, { key: "ArrowDown" });

		expect(scroll).toHaveBeenCalledWith({ block: "nearest" });
	});

	it("activates the selected row on Enter", () => {
		setup(shadow, refreshUI);
		panel.isOpen = true;
		panel.currentRoundIdx = 2;
		const target = items(shadow)[2]!;
		const click = vi.fn();
		target.addEventListener("click", click);

		const ev = key(document, { key: "Enter" });

		expect(click).toHaveBeenCalledTimes(1);
		expect(ev.defaultPrevented).toBe(true);
	});

	it("closes the panel on Escape", () => {
		setup(shadow, refreshUI);
		panel.isOpen = true;

		key(document, { key: "Escape" });

		expect(panel.isOpen).toBe(false);
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	describe("stands aside inside editable fields", () => {
		// Sprint 6: without this, typing in the panel's own search box moved the
		// selection and Escape closed the panel instead of clearing the query.
		function editable(tag: string): HTMLElement {
			const el = document.createElement(tag);
			document.body.appendChild(el);
			return el;
		}

		beforeEach(() => {
			panel.isOpen = true;
		});

		it("leaves arrow keys to an <input>", () => {
			setup(shadow, refreshUI);
			const input = editable("input");

			const ev = key(input, { key: "ArrowDown" });

			expect(panel.currentRoundIdx).toBe(0);
			expect(ev.defaultPrevented).toBe(false);
		});

		it("leaves arrow keys to a <textarea>", () => {
			setup(shadow, refreshUI);

			key(editable("textarea"), { key: "ArrowUp" });

			expect(panel.currentRoundIdx).toBe(0);
		});

		it("leaves arrow keys to a <select>", () => {
			setup(shadow, refreshUI);

			key(editable("select"), { key: "ArrowDown" });

			expect(panel.currentRoundIdx).toBe(0);
		});

		it("leaves arrow keys to a contentEditable host", () => {
			setup(shadow, refreshUI);
			const host = editable("div");
			host.contentEditable = "true";
			// jsdom does not implement isContentEditable -- it stays undefined even
			// with contentEditable="true", so the guard could never fire here. Stub
			// it the same way scrollIntoView and getBoundingClientRect are stubbed;
			// the production check is correct in a real browser.
			Object.defineProperty(host, "isContentEditable", {
				configurable: true,
				get: () => true,
			});

			key(host, { key: "ArrowDown" });

			expect(panel.currentRoundIdx).toBe(0);
		});

		it("leaves Escape to an <input> so it can clear its own value", () => {
			setup(shadow, refreshUI);

			const ev = key(editable("input"), { key: "Escape" });

			expect(panel.isOpen).toBe(true);
			expect(ev.defaultPrevented).toBe(false);
		});

		it("leaves Enter to an <input>", () => {
			setup(shadow, refreshUI);
			const input = editable("input");
			const click = vi.fn();
			items(shadow)[0]!.addEventListener("click", click);

			key(input, { key: "Enter" });

			expect(click).not.toHaveBeenCalled();
		});

		it("still honours Alt+S from inside an input", () => {
			// The toggle is the one shortcut that must work everywhere.
			setup(shadow, refreshUI);

			key(editable("input"), { key: "s", altKey: true });

			expect(panel.isOpen).toBe(false);
			expect(refreshUI).toHaveBeenCalledTimes(1);
		});
	});

	it("does nothing when the panel has no list yet", () => {
		// The skeleton builds .list, but a key can arrive before it exists.
		const empty = document.createElement("div").attachShadow({ mode: "open" });
		setup(empty, refreshUI);
		panel.isOpen = true;

		expect(() => key(document, { key: "ArrowDown" })).not.toThrow();
		expect(panel.currentRoundIdx).toBe(0);
	});

	it("stops listening once disposed", () => {
		const dispose = setup(shadow, refreshUI);
		dispose();

		key(document, { key: "s", altKey: true });

		expect(panel.isOpen).toBe(false);
		expect(refreshUI).not.toHaveBeenCalled();
	});
});
