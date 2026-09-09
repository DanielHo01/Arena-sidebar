import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	getMessagesForRound,
	scrollToRound,
} from "../../src/features/roundNav";
import { conversationStore } from "../../src/conversationStore";
import { cachedElements } from "../../src/state";
import type { SidebarMessage, SidebarRound } from "../../src/types";

const originalScrollDescriptor = Object.getOwnPropertyDescriptor(
	HTMLElement.prototype,
	"scrollIntoView",
);

function message(
	id: string,
	overrides: Partial<SidebarMessage> = {},
): SidebarMessage {
	return {
		id,
		role: "user",
		content: id + " content",
		...overrides,
	};
}

function round(id: string, index: number): SidebarRound {
	return {
		id,
		title: "Round " + (index + 1),
		messageCount: 1,
		index,
		hasAnchor: false,
	};
}

let scrollIntoView: ReturnType<typeof vi.fn>;

beforeEach(() => {
	conversationStore.reset();
	cachedElements.clear();
	document.body.innerHTML = "";

	scrollIntoView = vi.fn();
	Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
		configurable: true,
		value: scrollIntoView,
	});
	vi.stubGlobal("CSS", {
		escape: (value: string) => value,
	});
	vi.useFakeTimers();
});

afterEach(() => {
	vi.useRealTimers();
	vi.unstubAllGlobals();
	cachedElements.clear();
	conversationStore.reset();
	document.body.innerHTML = "";

	if (originalScrollDescriptor) {
		Object.defineProperty(
			HTMLElement.prototype,
			"scrollIntoView",
			originalScrollDescriptor,
		);
	} else {
		Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
	}
});

describe("scrollToRound", () => {
	it("returns false without scrolling when the round message is missing", () => {
		expect(scrollToRound("missing")).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});

	it("uses the cached DOM anchor and removes its flash class after 1500ms", () => {
		const anchor = document.createElement("div");
		conversationStore.messages = [message("m1", { domId: "dom-1" })];
		cachedElements.set("dom-1", anchor);

		expect(scrollToRound("m1")).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledWith({
			behavior: "smooth",
			block: "start",
		});
		expect(anchor.classList.contains("ai-sidebar-flash")).toBe(true);

		vi.advanceTimersByTime(1499);
		expect(anchor.classList.contains("ai-sidebar-flash")).toBe(true);
		vi.advanceTimersByTime(1);
		expect(anchor.classList.contains("ai-sidebar-flash")).toBe(false);
	});

	it("falls back to the page query when a cached domId is stale", () => {
		const anchor = document.createElement("div");
		anchor.setAttribute("data-ai-sidebar-id", "dom-stale");
		document.body.appendChild(anchor);
		conversationStore.messages = [message("m1", { domId: "dom-stale" })];

		expect(scrollToRound("m1")).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledTimes(1);
		expect(anchor.classList.contains("ai-sidebar-flash")).toBe(true);

		vi.advanceTimersByTime(1500);
		expect(anchor.classList.contains("ai-sidebar-flash")).toBe(false);
	});

	it("queries by the message id when no domId is available", () => {
		const anchor = document.createElement("div");
		anchor.setAttribute("data-ai-sidebar-id", "m2");
		document.body.appendChild(anchor);
		conversationStore.messages = [message("m2")];

		expect(scrollToRound("m2")).toBe(true);
		expect(scrollIntoView).toHaveBeenCalledTimes(1);
		expect(anchor.classList.contains("ai-sidebar-flash")).toBe(true);
	});

	it("returns false when neither the cache nor the page has an anchor", () => {
		conversationStore.messages = [message("m3", { domId: "missing-dom" })];

		expect(scrollToRound("m3")).toBe(false);
		expect(scrollIntoView).not.toHaveBeenCalled();
	});
});

describe("getMessagesForRound", () => {
	beforeEach(() => {
		conversationStore.messages = [
			message("m1"),
			message("a1", { role: "assistant" }),
			message("m2"),
			message("a2", { role: "assistant" }),
		];
	});

	it("returns an empty array when the round does not exist", () => {
		conversationStore.rounds = [round("m1", 0)];

		expect(getMessagesForRound("unknown")).toEqual([]);
	});

	it("returns an empty array when the round start message is absent", () => {
		conversationStore.rounds = [round("missing-message", 0)];

		expect(getMessagesForRound("missing-message")).toEqual([]);
	});

	it("slices a middle round before the next round starts", () => {
		conversationStore.rounds = [round("m1", 0), round("m2", 1)];

		expect(getMessagesForRound("m1").map((item) => item.id)).toEqual([
			"m1",
			"a1",
		]);
	});

	it("returns the final round through the end of the message store", () => {
		conversationStore.rounds = [round("m1", 0), round("m2", 1)];

		expect(getMessagesForRound("m2").map((item) => item.id)).toEqual([
			"m2",
			"a2",
		]);
	});

	it("uses the end of the store when a next round has no matching message", () => {
		conversationStore.rounds = [round("m1", 0), round("not-in-store", 1)];

		expect(getMessagesForRound("m1").map((item) => item.id)).toEqual([
			"m1",
			"a1",
			"m2",
			"a2",
		]);
	});
});
