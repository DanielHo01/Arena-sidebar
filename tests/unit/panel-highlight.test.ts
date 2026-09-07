// Which round is marked as the one currently in view.
//
// panel.currentRoundIdx is the single source of truth; the DOM carries it as a
// `.current` class on the matching `.item`. ui/panel/highlight.ts was split out
// of the 413-line ui/panel.ts in Phase 5 and had never been covered since.

import { beforeEach, describe, expect, it, vi } from "vitest";

import {
	refreshCurrentHighlight,
	setupScrollHighlight,
} from "../../src/ui/panel/highlight";
import { panel } from "../../src/state";

function item(idx: number): HTMLElement {
	const el = document.createElement("div");
	el.className = "item";
	el.dataset.roundIdx = String(idx);
	return el;
}

/** jsdom has no layout, so getBoundingClientRect is all zeros; stub it. */
function rect(el: Element, top: number, bottom: number): void {
	el.getBoundingClientRect = () => ({ top, bottom }) as DOMRect;
}

function flushRaf(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

describe("refreshCurrentHighlight", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		// panel is module-level state shared with every other test file in this
		// process, so it must be reset or the index leaks between tests.
		panel.currentRoundIdx = 0;
	});

	it("returns without throwing when there is no list", () => {
		expect(() => refreshCurrentHighlight(null)).not.toThrow();
	});

	it("marks only the current round", () => {
		const list = document.createElement("div");
		const [a, b, c] = [item(0), item(1), item(2)];
		list.append(a, b, c);
		panel.currentRoundIdx = 1;

		refreshCurrentHighlight(list);

		expect(b.classList.contains("current")).toBe(true);
		expect(a.classList.contains("current")).toBe(false);
		expect(c.classList.contains("current")).toBe(false);
	});

	it("moves the mark when the current round changes", () => {
		const list = document.createElement("div");
		const [a, b] = [item(0), item(1)];
		list.append(a, b);

		panel.currentRoundIdx = 0;
		refreshCurrentHighlight(list);
		expect(a.classList.contains("current")).toBe(true);

		panel.currentRoundIdx = 1;
		refreshCurrentHighlight(list);
		expect(a.classList.contains("current")).toBe(false);
		expect(b.classList.contains("current")).toBe(true);
	});

	it("marks nothing when no row matches the index", () => {
		const list = document.createElement("div");
		list.append(item(0), item(1));
		panel.currentRoundIdx = 9;

		refreshCurrentHighlight(list);

		expect(list.querySelectorAll(".current")).toHaveLength(0);
	});
});

describe("setupScrollHighlight", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		panel.currentRoundIdx = 0;
	});

	it("returns undefined when there is no list", () => {
		expect(setupScrollHighlight(null)).toBeUndefined();
	});

	it("returns a disposer that detaches the scroll listener", () => {
		const list = document.createElement("div");
		const remove = vi.spyOn(list, "removeEventListener");

		const dispose = setupScrollHighlight(list);
		expect(typeof dispose).toBe("function");

		dispose?.();
		expect(remove).toHaveBeenCalledWith("scroll", expect.any(Function));
	});

	it("highlights the row with the largest visible overlap", async () => {
		const list = document.createElement("div");
		const [a, b] = [item(0), item(1)];
		list.append(a, b);
		rect(list, 0, 100);
		rect(a, 0, 20); // 20px visible
		rect(b, 50, 150); // 50px visible

		setupScrollHighlight(list);
		list.dispatchEvent(new Event("scroll"));
		await flushRaf();

		expect(panel.currentRoundIdx).toBe(1);
		expect(b.classList.contains("current")).toBe(true);
		expect(a.classList.contains("current")).toBe(false);
	});

	it("ignores scrolls that arrive before the previous frame ran", async () => {
		// The ticking latch exists so a burst of scroll events costs one layout
		// pass, not one per event. Assert the work happens once.
		const list = document.createElement("div");
		const [a, b] = [item(0), item(1)];
		list.append(a, b);
		rect(list, 0, 100);
		rect(a, 0, 20);
		rect(b, 50, 150);

		let rafCalls = 0;
		const realRaf = globalThis.requestAnimationFrame;
		vi.spyOn(globalThis, "requestAnimationFrame").mockImplementation((cb) => {
			rafCalls += 1;
			return realRaf(cb);
		});

		setupScrollHighlight(list);
		list.dispatchEvent(new Event("scroll"));
		list.dispatchEvent(new Event("scroll"));
		list.dispatchEvent(new Event("scroll"));

		expect(rafCalls).toBe(1);

		await flushRaf();
		expect(panel.currentRoundIdx).toBe(1);
		vi.restoreAllMocks();
	});

	it("stops reacting to scroll after disposal", async () => {
		const list = document.createElement("div");
		const [a, b] = [item(0), item(1)];
		list.append(a, b);
		rect(list, 0, 100);
		rect(a, 0, 20);
		rect(b, 50, 150);

		const dispose = setupScrollHighlight(list);
		dispose?.();

		list.dispatchEvent(new Event("scroll"));
		await flushRaf();

		expect(panel.currentRoundIdx).toBe(0);
	});
});
