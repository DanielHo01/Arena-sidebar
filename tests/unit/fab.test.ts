// The floating action button: drag-to-move, and persisting where it landed.
//
// ui/fab.ts was at 0% coverage. Two of its behaviours are invisible until they
// break: the drag math reads getBoundingClientRect on every move, and the
// position is written to storage on mouseup only if the button is still in the
// document. Both are easy to regress with no test complaining.

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { buildFab, saveFabPosition } from "../../src/ui/fab";
import { fab, panel } from "../../src/state";
import { setStorageBackend } from "../../src/platform/storage";

/** jsdom returns all zeros from getBoundingClientRect, so deltas are always 0. */
function stubRect(el: HTMLElement, rect: { left: number; top: number }): void {
	el.getBoundingClientRect = () =>
		({
			left: rect.left,
			top: rect.top,
			right: 0,
			bottom: 0,
			width: 0,
			height: 0,
			x: rect.left,
			y: rect.top,
			toJSON() {},
		}) as DOMRect;
}

function mouse(
	type: "mousedown" | "mousemove" | "mouseup",
	target: EventTarget,
	clientX: number,
	clientY: number,
): void {
	target.dispatchEvent(
		new MouseEvent(type, { bubbles: true, cancelable: true, clientX, clientY }),
	);
}

/**
 * Track everything attached to `document` during a test and detach it after.
 *
 * The drag handlers live on `document`, which outlives `document.body.innerHTML
 * = ""`. Every test here does pair its mousedown with a mouseup, so the source
 * cleans up after itself -- but if it ever stops doing so, the leaked handlers
 * would share the module-level drag origin with later tests and silently absorb
 * their pointer deltas. That is exactly how removing the unbind calls in
 * `up()` passed the whole suite while failing when run on its own.
 */
const docListeners: Array<[string, EventListener]> = [];
const realAdd = document.addEventListener.bind(document);
const realRemove = document.removeEventListener.bind(document);

function trackDocumentListeners(): void {
	const patched = (
		type: string,
		listener: EventListenerOrEventListenerObject,
		options?: boolean | AddEventListenerOptions,
	): void => {
		if (typeof listener === "function") docListeners.push([type, listener]);
		realAdd(type, listener, options);
	};
	document.addEventListener = patched as typeof document.addEventListener;
}

function untrackDocumentListeners(): void {
	document.addEventListener = realAdd as typeof document.addEventListener;
	document.removeEventListener = realRemove;
	while (docListeners.length) {
		const [type, listener] = docListeners.pop()!;
		realRemove(type, listener);
	}
}

describe("saveFabPosition", () => {
	let written: Record<string, unknown>;

	beforeEach(() => {
		written = {};
		fab.position = null;
		trackDocumentListeners();
		setStorageBackend({
			get: async () => ({}),
			set: async (items) => {
				Object.assign(written, items);
			},
			remove: async () => {},
		});
	});

	afterEach(() => {
		untrackDocumentListeners();
		setStorageBackend(null);
	});

	it("stores the position in state and under the fabPosition key", () => {
		saveFabPosition(120, 340);

		expect(fab.position).toEqual({ x: 120, y: 340 });
		expect(written.fabPosition).toEqual({ x: 120, y: 340 });
	});
});

describe("buildFab", () => {
	let written: Record<string, unknown>;

	beforeEach(() => {
		document.body.innerHTML = "";
		written = {};
		fab.position = null;
		panel.isOpen = false;
		panel.isDragging = false;
		trackDocumentListeners();
		setStorageBackend({
			get: async () => ({}),
			set: async (items) => {
				Object.assign(written, items);
			},
			remove: async () => {},
		});
	});

	afterEach(() => {
		untrackDocumentListeners();
		setStorageBackend(null);
	});

	it("builds a button carrying the round count", () => {
		const btn = buildFab(7);

		expect(btn.tagName).toBe("BUTTON");
		expect(btn.className).toBe("fab");
		expect(btn.getAttribute("aria-label")).toBe(
			"Open message navigator (7 rounds loaded)",
		);
		expect(btn.title).toBe("7 rounds loaded");
		// The icon is injected as markup, so it is a child element rather than text.
		expect(btn.querySelector("svg")).not.toBeNull();
	});

	it("applies a persisted position on build", () => {
		fab.position = { x: 40, y: 500 };

		const btn = buildFab(1);

		expect(btn.style.left).toBe("40px");
		expect(btn.style.top).toBe("500px");
		// Both must be cleared or the default right-anchored CSS wins.
		expect(btn.style.right).toBe("auto");
		expect(btn.style.transform).toBe("none");
	});

	it("leaves the button in its default corner with no saved position", () => {
		const btn = buildFab(1);

		expect(btn.style.left).toBe("");
		expect(btn.style.top).toBe("");
	});

	it("opens the panel when clicked", () => {
		const btn = buildFab(3);
		document.body.appendChild(btn);

		btn.click();

		expect(panel.isOpen).toBe(true);
	});

	describe("dragging", () => {
		it("tracks the pointer and clears the default anchoring", () => {
			const btn = buildFab(2);
			document.body.appendChild(btn);
			stubRect(btn, { left: 100, top: 50 });

			mouse("mousedown", btn, 200, 200);
			expect(panel.isDragging).toBe(true);

			mouse("mousemove", document, 230, 210);

			expect(btn.style.left).toBe("130px");
			expect(btn.style.top).toBe("60px");
			expect(btn.style.right).toBe("auto");
			expect(btn.style.transform).toBe("none");

			// Release, or the document listeners leak into later tests.
			mouse("mouseup", document, 230, 210);
		});

		it("starts the drag when the press lands on the icon inside the button", () => {
			const btn = buildFab(2);
			document.body.appendChild(btn);
			stubRect(btn, { left: 0, top: 0 });
			const svg = btn.querySelector("svg")!;

			mouse("mousedown", svg, 10, 10);

			expect(panel.isDragging).toBe(true);
			mouse("mouseup", document, 10, 10);
		});

		it("ignores a press on a nested element of its own", () => {
			// Defensive: a descendant that is itself .fab belongs to that element.
			const btn = buildFab(2);
			document.body.appendChild(btn);
			stubRect(btn, { left: 0, top: 0 });
			const inner = document.createElement("span");
			inner.className = "fab";
			btn.appendChild(inner);

			mouse("mousedown", inner, 5, 5);

			expect(panel.isDragging).toBe(false);
		});

		it("persists the final position on release", () => {
			const btn = buildFab(2);
			document.body.appendChild(btn);
			stubRect(btn, { left: 320, top: 180 });

			mouse("mousedown", btn, 0, 0);
			mouse("mousemove", document, 10, 10);
			mouse("mouseup", document, 10, 10);

			expect(panel.isDragging).toBe(false);
			expect(fab.position).toEqual({ x: 320, y: 180 });
			expect(written.fabPosition).toEqual({ x: 320, y: 180 });
		});

		it("does not persist when the button is already gone", () => {
			const btn = buildFab(2);
			document.body.appendChild(btn);
			stubRect(btn, { left: 320, top: 180 });

			mouse("mousedown", btn, 0, 0);
			// The DOM loop can tear the FAB down mid-drag.
			btn.remove();
			mouse("mouseup", document, 0, 0);

			expect(panel.isDragging).toBe(false);
			expect(fab.position).toBeNull();
			expect(written.fabPosition).toBeUndefined();
		});

		it("stops responding to the pointer after release", () => {
			const btn = buildFab(2);
			document.body.appendChild(btn);
			stubRect(btn, { left: 100, top: 50 });

			mouse("mousedown", btn, 0, 0);
			mouse("mousemove", document, 10, 10);
			mouse("mouseup", document, 10, 10);
			const after = btn.style.left;

			mouse("mousemove", document, 999, 999);

			expect(btn.style.left).toBe(after);
		});
	});
});
