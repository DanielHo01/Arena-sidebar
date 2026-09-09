// Rendering of one row in the round list.
//
// ui/panel/roundItem.ts was split out of the 413-line ui/panel.ts in Phase 5 and
// has had no tests since. It owns the copy button whose success tick used to lie
// (fixed in f9da540 by routing through platform/clipboard.ts), so both branches
// are pinned here rather than left to memory.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { createRoundEl, updateRoundEl } from "../../src/ui/panel/roundItem";
import {
	hiddenRoundIds,
	loadHiddenRounds,
	resetHiddenRounds,
} from "../../src/rounds";
import { conversationStore } from "../../src/conversationStore";
import { panel } from "../../src/state";
import { setClipboardBackend } from "../../src/platform/clipboard";
import { setStorageBackend } from "../../src/platform/storage";
import {
	deleteRound,
	getMessagesForRound,
	scrollToRound,
} from "../../src/features/roundNav";
import type { SidebarRound } from "../../src/types";

vi.mock("../../src/features/roundNav", () => ({
	scrollToRound: vi.fn(() => false),
	getMessagesForRound: vi.fn(() => []),
	deleteRound: vi.fn(() => true),
}));

const mockScroll = vi.mocked(scrollToRound);
const mockMessages = vi.mocked(getMessagesForRound);
const mockDelete = vi.mocked(deleteRound);

function round(overrides: Partial<SidebarRound> = {}): SidebarRound {
	return {
		id: "r1",
		title: "First question",
		messageCount: 2,
		index: 0,
		hasAnchor: true,
		...overrides,
	};
}

function copyButton(el: HTMLElement): HTMLButtonElement {
	return el.querySelectorAll<HTMLButtonElement>(".item-action")[0]!;
}

function hideButton(el: HTMLElement): HTMLButtonElement {
	return el.querySelectorAll<HTMLButtonElement>(".item-action")[1]!;
}

function editButton(el: HTMLElement): HTMLButtonElement {
	return el.querySelector<HTMLButtonElement>(".item-edit")!;
}

function deleteButton(el: HTMLElement): HTMLButtonElement {
	return el.querySelector<HTMLButtonElement>(".item-delete")!;
}

describe("createRoundEl", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
		// Both are module-level state shared across the whole test process; leaving
		// either dirty makes a later test fail for the wrong reason.
		// resetHiddenRounds also drops the adopted session id, so persistence
		// tests start from a clean slate.
		resetHiddenRounds();
		conversationStore.reset();
		setStorageBackend(null);
		panel.isOpen = true;
		panel.currentRoundIdx = 0;
		mockScroll.mockClear();
		// Default to no messages, like the real function returns for an
		// unknown round — roundMetaLabel and the edit button both call it.
		mockMessages.mockReset().mockReturnValue([]);
		mockDelete.mockReset();
		mockDelete.mockReturnValue(true);
		setClipboardBackend(null);
		window.history.pushState({}, "", "/");
	});

	it("renders the row structure the stylesheet and diffing rely on", () => {
		const el = createRoundEl(round(), 2, vi.fn());

		expect(el.className).toBe("item");
		expect(el.dataset.roundId).toBe("r1");
		expect(el.dataset.roundIdx).toBe("2");
		expect(el.querySelector(".item-meta-label")).not.toBeNull();
		expect(el.querySelectorAll(".item-action")).toHaveLength(4);
		expect(el.querySelector(".item-title")?.textContent).toBe("First question");
		expect(el.querySelector(".item-assistant-preview")).not.toBeNull();
	});

	it("labels a single-response round with just its number", () => {
		const el = createRoundEl(round({ assistantCount: 1 }), 0, vi.fn());
		expect(el.querySelector(".item-meta-label")?.textContent).toBe("Round 1");
	});

	it("labels a multi-response round with the response count", () => {
		const el = createRoundEl(round({ assistantCount: 3 }), 4, vi.fn());
		expect(el.querySelector(".item-meta-label")?.textContent).toBe(
			"Round 5 · 3 responses",
		);
	});

	it("shows the assistant preview when there is one", () => {
		const el = createRoundEl(
			round({ assistantPreview: "Here is the answer" }),
			0,
			vi.fn(),
		);
		expect(el.querySelector(".item-assistant-preview")?.textContent).toBe(
			"Here is the answer",
		);
	});

	it("shows a generating placeholder before the assistant replies", () => {
		const el = createRoundEl(round(), 0, vi.fn());
		expect(el.querySelector(".item-assistant-preview")?.textContent).toBe(
			"Generating…",
		);
	});

	it("copies the round's messages and confirms only on a real write", async () => {
		mockMessages.mockReturnValue([
			{ id: "m1", role: "user", content: "hello" },
			{ id: "m2", role: "assistant", content: "hi there" },
		]);
		setClipboardBackend({ writeText: vi.fn().mockResolvedValue(undefined) });
		const el = createRoundEl(round(), 0, vi.fn());

		copyButton(el).click();
		await Promise.resolve();
		await Promise.resolve();

		expect(copyButton(el).textContent).toBe("✅");
		expect(mockMessages).toHaveBeenCalledWith("r1");
	});

	it("reports a failed copy instead of claiming success", async () => {
		// The bug this guards: the old code flipped the tick in a bare .then, so a
		// denied clipboard permission still looked like a successful copy.
		mockMessages.mockReturnValue([
			{ id: "m1", role: "user", content: "hello" },
		]);
		setClipboardBackend({
			writeText: vi.fn().mockRejectedValue(new Error("x")),
		});
		const el = createRoundEl(round(), 0, vi.fn());

		copyButton(el).click();
		await Promise.resolve();
		await Promise.resolve();

		expect(copyButton(el).textContent).toBe("⚠️");
		expect(copyButton(el).title).toContain("failed");
	});

	it("does not touch the clipboard when the round has no text", async () => {
		const writeText = vi.fn().mockResolvedValue(undefined);
		setClipboardBackend({ writeText });
		mockMessages.mockReturnValue([]);
		const el = createRoundEl(round(), 0, vi.fn());

		copyButton(el).click();
		await Promise.resolve();

		expect(writeText).not.toHaveBeenCalled();
		expect(copyButton(el).textContent).toBe("📋");
	});

	it("hides the round and refreshes the panel", () => {
		const refreshUI = vi.fn();
		const el = createRoundEl(round({ id: "r9" }), 0, refreshUI);

		hideButton(el).click();

		expect(hiddenRoundIds.has("r9")).toBe(true);
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	it("scrolls to the round and marks it current when clicked", () => {
		const el = createRoundEl(round({ id: "r7" }), 5, vi.fn());

		el.click();

		expect(mockScroll).toHaveBeenCalledWith("r7");
		expect(panel.currentRoundIdx).toBe(5);
	});

	it("closes the panel after a click when not on a session route", () => {
		panel.isOpen = true;
		const el = createRoundEl(round(), 0, vi.fn());

		el.click();

		expect(panel.isOpen).toBe(false);
	});

	it("keeps the panel open on a session route", () => {
		// Character-chat sessions keep the navigator docked; auto-closing it there
		// would hide it on every single row click.
		window.history.pushState({}, "", "/c/abc123");
		panel.isOpen = true;
		const el = createRoundEl(round(), 0, vi.fn());

		el.click();

		expect(panel.isOpen).toBe(true);
	});
});

describe("updateRoundEl", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("refreshes the label, title, preview and index in place", () => {
		const el = createRoundEl(round(), 0, vi.fn());

		updateRoundEl(
			el,
			round({
				title: "Renamed question",
				assistantCount: 2,
				assistantPreview: "Second answer",
			}),
			3,
		);

		expect(el.dataset.roundIdx).toBe("3");
		expect(el.querySelector(".item-meta-label")?.textContent).toBe(
			"Round 4 · 2 responses",
		);
		expect(el.querySelector(".item-title")?.textContent).toBe(
			"Renamed question",
		);
		expect(el.querySelector(".item-assistant-preview")?.textContent).toBe(
			"2 responses · Second answer",
		);
	});

	it("falls back to the placeholder when a reply disappears", () => {
		const el = createRoundEl(
			round({ assistantPreview: "Here is the answer" }),
			0,
			vi.fn(),
		);

		updateRoundEl(el, round({ assistantPreview: undefined }), 0);

		expect(el.querySelector(".item-assistant-preview")?.textContent).toBe(
			"Generating…",
		);
	});

	it("tolerates a row that is missing its inner elements", () => {
		// The guards exist because updateRoundEl runs against DOM the reconciler
		// found, not DOM it built. A bare div must not throw.
		const bare = document.createElement("div");
		expect(() => updateRoundEl(bare, round(), 1)).not.toThrow();
		expect(bare.dataset.roundIdx).toBe("1");
	});

	it("flips the button and dimmed class when the round becomes hidden", () => {
		const el = createRoundEl(round({ id: "r1" }), 0, vi.fn());
		expect(hideButton(el).textContent).toBe("✕");
		expect(el.classList.contains("item-hidden")).toBe(false);

		hiddenRoundIds.add("r1");
		updateRoundEl(el, round({ id: "r1" }), 0);

		expect(hideButton(el).textContent).toBe("↩");
		expect(hideButton(el).title).toBe("Restore this round");
		expect(el.classList.contains("item-hidden")).toBe(true);
	});

	it("flips back when the flag is cleared", () => {
		hiddenRoundIds.add("r1");
		const el = createRoundEl(round({ id: "r1" }), 0, vi.fn());
		expect(hideButton(el).textContent).toBe("↩");

		hiddenRoundIds.delete("r1");
		updateRoundEl(el, round({ id: "r1" }), 0);

		expect(hideButton(el).textContent).toBe("✕");
		expect(hideButton(el).title).toBe("Hide this round");
		expect(el.classList.contains("item-hidden")).toBe(false);
	});
});

describe("hidden-round persistence", () => {
	/** Minimal in-memory StorageBackend recording writes in `data`. */
	function memoryBackend() {
		const data = new Map<string, unknown>();
		return {
			data,
			backend: {
				get: async (keys: string | string[] | null) => {
					if (keys === null) return Object.fromEntries(data);
					const list = Array.isArray(keys) ? keys : [keys];
					return Object.fromEntries(
						list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]),
					);
				},
				set: async (items: Record<string, unknown>) => {
					for (const [k, v] of Object.entries(items)) data.set(k, v);
				},
				remove: async (keys: string | string[]) => {
					for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
				},
			},
		};
	}

	it("persists a hide to the adopted session's key", async () => {
		const { data, backend } = memoryBackend();
		setStorageBackend(backend);
		await loadHiddenRounds("s1");

		const el = createRoundEl(round({ id: "r9" }), 0, vi.fn());
		hideButton(el).click();

		expect(data.get("edge-ai-sidebar:hidden-rounds:s1")).toEqual(["r9"]);
	});

	it("renders a hidden round dimmed with a restore button", async () => {
		const { data, backend } = memoryBackend();
		data.set("edge-ai-sidebar:hidden-rounds:s1", ["r9"]);
		setStorageBackend(backend);
		await loadHiddenRounds("s1");

		const el = createRoundEl(round({ id: "r9" }), 0, vi.fn());
		expect(el.classList.contains("item-hidden")).toBe(true);
		expect(hideButton(el).textContent).toBe("↩");
	});

	it("restores a hidden round and persists the removal", async () => {
		const { data, backend } = memoryBackend();
		data.set("edge-ai-sidebar:hidden-rounds:s1", ["r9"]);
		setStorageBackend(backend);
		await loadHiddenRounds("s1");

		const refreshUI = vi.fn();
		const el = createRoundEl(round({ id: "r9" }), 0, refreshUI);
		hideButton(el).click();

		expect(hiddenRoundIds.has("r9")).toBe(false);
		expect(data.get("edge-ai-sidebar:hidden-rounds:s1")).toEqual([]);
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	it("hides without persisting when no session was adopted (direct chat)", async () => {
		const { data, backend } = memoryBackend();
		setStorageBackend(backend);
		await loadHiddenRounds(""); // direct-chat routes have no session id

		const el = createRoundEl(round({ id: "r1" }), 0, vi.fn());
		hideButton(el).click();

		// The flag still works in memory — it just has the same lifetime as the
		// rounds themselves, which direct chats never persist either.
		expect(hiddenRoundIds.has("r1")).toBe(true);
		expect(data.size).toBe(0);
	});
});

describe("edit and delete buttons (#15)", () => {
	function seedRoundWithUser() {
		mockMessages.mockReturnValue([
			{ id: "u1", role: "user", content: "original question" },
			{ id: "a1", role: "assistant", content: "answer" },
		]);
		conversationStore.messages = [
			{ id: "u1", role: "user", content: "original question" } as never,
			{ id: "a1", role: "assistant", content: "answer" } as never,
		];
	}

	it("edits the user message inline and refreshes", () => {
		seedRoundWithUser();
		const refreshUI = vi.fn();
		const el = createRoundEl(round({ id: "r1" }), 0, refreshUI);

		editButton(el).click();
		const input = el.querySelector(
			".item-title input",
		) as HTMLInputElement | null;
		expect(input).not.toBeNull();
		expect(input!.value).toBe("original question");

		input!.value = "corrected question";
		input!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Enter", bubbles: true }),
		);

		expect(conversationStore.messages[0].content).toBe("corrected question");
		expect(conversationStore.messages[0].edited).toBe(true);
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	it("leaves the store alone when the edit is cancelled", () => {
		seedRoundWithUser();
		const refreshUI = vi.fn();
		const el = createRoundEl(
			round({ id: "r1", title: "original…" }),
			0,
			refreshUI,
		);

		editButton(el).click();
		const input = el.querySelector(
			".item-title input",
		) as HTMLInputElement | null;
		input!.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);

		expect(conversationStore.messages[0].content).toBe("original question");
		// A re-render restores the truncated title — the cancel path must ask
		// for one, since the editor leaves the full text in the row.
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	it("hides the edit button for rounds without a user turn", () => {
		const el = createRoundEl(
			round({ id: "r1", hasUserTurn: false }),
			0,
			vi.fn(),
		);
		expect(editButton(el).style.display).toBe("none");
	});

	it("marks the meta label when a message was edited", () => {
		const el = createRoundEl(round({ id: "r1", edited: true }), 0, vi.fn());
		expect(el.querySelector(".item-meta-label")?.textContent).toBe(
			"Round 1 · ✏️ edited",
		);
	});

	it("combines the edited marker with the response count", () => {
		const el = createRoundEl(
			round({ id: "r1", assistantCount: 2, edited: true }),
			0,
			vi.fn(),
		);
		expect(el.querySelector(".item-meta-label")?.textContent).toBe(
			"Round 1 · 2 responses · ✏️ edited",
		);
	});

	it("arms on first click and deletes on second", () => {
		const refreshUI = vi.fn();
		const el = createRoundEl(round({ id: "r7" }), 0, refreshUI);
		const btn = deleteButton(el);

		btn.click();
		expect(mockDelete).not.toHaveBeenCalled();
		expect(btn.textContent).toBe("❓");

		btn.click();
		expect(mockDelete).toHaveBeenCalledWith("r7");
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	it("does not refresh when the delete reports nothing to remove", () => {
		mockDelete.mockReturnValue(false);
		const refreshUI = vi.fn();
		const el = createRoundEl(round({ id: "r7" }), 0, refreshUI);

		deleteButton(el).click();
		deleteButton(el).click();

		expect(mockDelete).toHaveBeenCalledWith("r7");
		expect(refreshUI).not.toHaveBeenCalled();
	});

	it("disarms after 3s without a second click", () => {
		vi.useFakeTimers();
		try {
			const el = createRoundEl(round({ id: "r7" }), 0, vi.fn());
			const btn = deleteButton(el);
			btn.click();
			expect(btn.textContent).toBe("❓");
			vi.advanceTimersByTime(3000);
			expect(btn.textContent).toBe("🗑️");
			btn.click(); // arms again instead of deleting
			expect(mockDelete).not.toHaveBeenCalled();
		} finally {
			vi.useRealTimers();
		}
	});
});
