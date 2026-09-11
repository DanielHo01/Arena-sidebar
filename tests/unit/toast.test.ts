// ui/toast.ts — the in-panel transient notification (#22).
//
// One toast at a time; an identical message while one is visible is dropped
// so a failing periodic save cannot stack toasts.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { showToast } from "../../src/ui/toast";

function makeShadow(): ShadowRoot {
	const host = document.createElement("div");
	document.body.appendChild(host);
	return host.attachShadow({ mode: "open" });
}

describe("showToast", () => {
	let shadow: ShadowRoot;

	beforeEach(() => {
		document.body.innerHTML = "";
		shadow = makeShadow();
		vi.useFakeTimers();
	});

	afterEach(() => {
		vi.useRealTimers();
	});

	it("renders the message", () => {
		showToast(shadow, "本地存储已满");
		expect(shadow.querySelector(".ai-toast")?.textContent).toBe("本地存储已满");
	});

	it("ignores blank text", () => {
		showToast(shadow, "   ");
		expect(shadow.querySelector(".ai-toast")).toBeNull();
	});

	it("drops an identical message while one is visible", () => {
		showToast(shadow, "same");
		showToast(shadow, "same");
		expect(shadow.querySelectorAll(".ai-toast")).toHaveLength(1);
	});

	it("replaces a different message", () => {
		showToast(shadow, "first");
		showToast(shadow, "second");
		expect(shadow.querySelectorAll(".ai-toast")).toHaveLength(1);
		expect(shadow.querySelector(".ai-toast")?.textContent).toBe("second");
	});

	it("auto-dismisses after 4s", () => {
		showToast(shadow, "gone soon");
		expect(shadow.querySelector(".ai-toast")).not.toBeNull();
		vi.advanceTimersByTime(3999);
		expect(shadow.querySelector(".ai-toast")).not.toBeNull();
		vi.advanceTimersByTime(1);
		expect(shadow.querySelector(".ai-toast")).toBeNull();
	});

	it("the same text toasts again after dismissal", () => {
		showToast(shadow, "again");
		vi.advanceTimersByTime(4000);
		showToast(shadow, "again");
		expect(shadow.querySelector(".ai-toast")?.textContent).toBe("again");
	});
});
