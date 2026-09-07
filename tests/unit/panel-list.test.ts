// Reconciling the round list against the DOM.
//
// ui/panel/list.ts was split out of the 413-line ui/panel.ts in Phase 5 and has
// had no tests since. reconcileList is the panel's only mutation path: it decides
// which rows exist, in what order, and whether the "no matches" placeholder is
// showing. createRoundEl/updateRoundEl are deliberately NOT mocked -- this is the
// integration between the diff and the row renderer, and mocking the renderer
// would only test the diff against a fiction.

import { beforeEach, describe, expect, it, vi } from "vitest";

import { reconcileList } from "../../src/ui/panel/list";
import { hiddenRoundIds } from "../../src/rounds";
import { panel } from "../../src/state";
import type { SidebarRound } from "../../src/types";

function round(
	id: string,
	overrides: Partial<SidebarRound> = {},
): SidebarRound {
	return {
		id,
		title: `Question ${id}`,
		messageCount: 2,
		index: 0,
		hasAnchor: true,
		...overrides,
	};
}

function rowIds(list: HTMLElement): string[] {
	return [...list.children]
		.map((el) => (el as HTMLElement).dataset.roundId)
		.filter((id): id is string => Boolean(id));
}

function titles(list: HTMLElement): string[] {
	return [...list.querySelectorAll(".item-title")].map((el) => el.textContent!);
}

describe("reconcileList", () => {
	let list: HTMLElement;
	const refreshUI = vi.fn();

	beforeEach(() => {
		document.body.innerHTML = "";
		list = document.createElement("div");
		document.body.appendChild(list);
		// Module-level state shared with the whole test process. panel.searchQuery
		// in particular leaks between tests and silently changes the filter.
		panel.searchQuery = "";
		panel.showHiddenRounds = false;
		hiddenRoundIds.clear();
		refreshUI.mockClear();
	});

	it("renders one row per round, in order", () => {
		reconcileList(list, [round("a"), round("b"), round("c")], refreshUI);

		expect(rowIds(list)).toEqual(["a", "b", "c"]);
		expect(list.querySelectorAll(".item")).toHaveLength(3);
	});

	it("shows a placeholder when there are no rounds at all", () => {
		reconcileList(list, [], refreshUI);

		expect(list.querySelector(".empty")?.textContent).toBe(
			"No messages detected",
		);
		expect(list.querySelectorAll(".item")).toHaveLength(0);
	});

	it("names the query when nothing matched it", () => {
		panel.searchQuery = "zzz";
		reconcileList(list, [round("a")], refreshUI);

		expect(list.querySelector(".empty")?.textContent).toBe(
			'No matches for "zzz"',
		);
	});

	it("clears the placeholder once rounds appear", () => {
		reconcileList(list, [], refreshUI);
		expect(list.querySelector(".empty")).not.toBeNull();

		reconcileList(list, [round("a")], refreshUI);
		expect(list.querySelector(".empty")).toBeNull();
		expect(rowIds(list)).toEqual(["a"]);
	});

	it("reuses existing row elements instead of rebuilding them", () => {
		// The point of diffing rather than re-rendering: identity must survive, or
		// focus, hover state and scroll position are thrown away on every refresh.
		reconcileList(list, [round("a"), round("b")], refreshUI);
		const before = list.children[1];

		reconcileList(list, [round("a"), round("b")], refreshUI);

		expect(list.children[1]).toBe(before);
	});

	it("updates a reused row in place when its content changes", () => {
		reconcileList(list, [round("a", { title: "Old title" })], refreshUI);
		expect(titles(list)).toEqual(["Old title"]);

		reconcileList(list, [round("a", { title: "New title" })], refreshUI);

		expect(titles(list)).toEqual(["New title"]);
		expect(list.querySelectorAll(".item")).toHaveLength(1);
	});

	it("removes rows for rounds that are gone", () => {
		reconcileList(list, [round("a"), round("b"), round("c")], refreshUI);

		reconcileList(list, [round("a"), round("c")], refreshUI);

		expect(rowIds(list)).toEqual(["a", "c"]);
	});

	it("reorders rows when the round order changes", () => {
		reconcileList(list, [round("a"), round("b"), round("c")], refreshUI);

		reconcileList(list, [round("c"), round("a"), round("b")], refreshUI);

		expect(rowIds(list)).toEqual(["c", "a", "b"]);
	});

	it("inserts a round that appeared in the middle", () => {
		reconcileList(list, [round("a"), round("c")], refreshUI);

		reconcileList(list, [round("a"), round("b"), round("c")], refreshUI);

		expect(rowIds(list)).toEqual(["a", "b", "c"]);
	});

	it("hides rounds the user dismissed", () => {
		hiddenRoundIds.add("b");

		reconcileList(list, [round("a"), round("b"), round("c")], refreshUI);

		expect(rowIds(list)).toEqual(["a", "c"]);
	});

	it("shows the placeholder when every round is hidden", () => {
		hiddenRoundIds.add("a");

		reconcileList(list, [round("a")], refreshUI);

		expect(list.querySelector(".empty")?.textContent).toBe(
			"No messages detected",
		);
		expect(rowIds(list)).toEqual([]);
	});

	it("matches the query against the round title", () => {
		panel.searchQuery = "second";

		reconcileList(
			list,
			[
				round("a", { title: "First thing" }),
				round("b", { title: "Second thing" }),
			],
			refreshUI,
		);

		expect(rowIds(list)).toEqual(["b"]);
	});

	it("matches the query against the user and assistant previews", () => {
		panel.searchQuery = "banana";

		reconcileList(
			list,
			[
				round("a", { assistantPreview: "apple pie" }),
				round("b", { userPreview: "banana split" }),
			],
			refreshUI,
		);

		expect(rowIds(list)).toEqual(["b"]);
	});

	it("ignores case and surrounding whitespace in the query", () => {
		panel.searchQuery = "  SECOND  ";

		reconcileList(
			list,
			[
				round("a", { title: "First thing" }),
				round("b", { title: "Second thing" }),
			],
			refreshUI,
		);

		expect(rowIds(list)).toEqual(["b"]);
	});

	it("matches nothing when a preview field is absent", () => {
		// userPreview/assistantPreview are optional; the filter must not throw on
		// undefined and must not treat it as a match.
		panel.searchQuery = "undefined";

		reconcileList(list, [round("a")], refreshUI);

		expect(list.querySelector(".empty")).not.toBeNull();
	});

	it("keeps working when the list already holds unrelated children", () => {
		// Children without data-round-id are not part of the diff and must survive.
		const marker = document.createElement("div");
		marker.className = "header";
		list.appendChild(marker);

		reconcileList(list, [round("a")], refreshUI);

		expect(list.contains(marker)).toBe(true);
		expect(rowIds(list)).toEqual(["a"]);
	});

	describe("hidden-rounds footer bar", () => {
		it("is absent when nothing is hidden", () => {
			reconcileList(list, [round("a"), round("b")], refreshUI);

			expect(list.querySelector(".hidden-bar")).toBeNull();
		});

		it("shows the hidden count and stays after the rows", () => {
			hiddenRoundIds.add("b");

			reconcileList(list, [round("a"), round("b"), round("c")], refreshUI);

			const bar = list.querySelector(".hidden-bar");
			expect(bar?.textContent).toBe("1 hidden round — click to show");
			// Rounds first, bar last — the reconcile loop positions rows by index,
			// so the bar must never sit between them.
			expect(list.lastElementChild).toBe(bar);
			expect(rowIds(list)).toEqual(["a", "c"]);
		});

		it("pluralises the count", () => {
			hiddenRoundIds.add("a");
			hiddenRoundIds.add("b");

			reconcileList(list, [round("a"), round("b"), round("c")], refreshUI);

			expect(list.querySelector(".hidden-bar")?.textContent).toBe(
				"2 hidden rounds — click to show",
			);
		});

		it("keeps the bar when every round is hidden — the escape hatch", () => {
			// Without the bar here, ✕ would be a dead end: no rows, no way back.
			hiddenRoundIds.add("a");

			reconcileList(list, [round("a")], refreshUI);

			expect(list.querySelector(".empty")?.textContent).toBe(
				"No messages detected",
			);
			expect(list.querySelector(".hidden-bar")).not.toBeNull();
			expect(list.lastElementChild?.className).toBe("hidden-bar");
		});

		it("removes the bar once nothing is hidden anymore", () => {
			hiddenRoundIds.add("a");
			reconcileList(list, [round("a"), round("b")], refreshUI);
			expect(list.querySelector(".hidden-bar")).not.toBeNull();

			hiddenRoundIds.delete("a");
			reconcileList(list, [round("a"), round("b")], refreshUI);

			expect(list.querySelector(".hidden-bar")).toBeNull();
			expect(rowIds(list)).toEqual(["a", "b"]);
		});

		it("toggles reveal mode on click and refreshes", () => {
			hiddenRoundIds.add("b");
			reconcileList(list, [round("a"), round("b")], refreshUI);
			refreshUI.mockClear();

			(list.querySelector(".hidden-bar") as HTMLElement).click();

			expect(panel.showHiddenRounds).toBe(true);
			expect(refreshUI).toHaveBeenCalledTimes(1);
		});
	});

	describe("reveal mode", () => {
		it("renders hidden rounds in place, dimmed, keeping order", () => {
			hiddenRoundIds.add("b");
			panel.showHiddenRounds = true;

			reconcileList(list, [round("a"), round("b"), round("c")], refreshUI);

			expect(rowIds(list)).toEqual(["a", "b", "c"]);
			const hiddenRow = list.querySelector('[data-round-id="b"]');
			expect(hiddenRow?.classList.contains("item-hidden")).toBe(true);
			expect(
				list
					.querySelector('[data-round-id="a"]')
					?.classList.contains("item-hidden"),
			).toBe(false);
		});

		it("labels the bar for collapsing while active", () => {
			hiddenRoundIds.add("b");
			panel.showHiddenRounds = true;

			reconcileList(list, [round("a"), round("b")], refreshUI);

			expect(list.querySelector(".hidden-bar")?.textContent).toBe(
				"1 hidden round — click to hide again",
			);
		});

		it("lets a row flip its flag without leaving the list", () => {
			// In reveal mode a restored row stays in the diff, so its element
			// must be updated in place, not rebuilt from scratch.
			hiddenRoundIds.add("a");
			panel.showHiddenRounds = true;
			reconcileList(list, [round("a"), round("b")], refreshUI);
			const rowBefore = list.querySelector('[data-round-id="a"]');

			hiddenRoundIds.delete("a");
			reconcileList(list, [round("a"), round("b")], refreshUI);

			expect(list.querySelector('[data-round-id="a"]')).toBe(rowBefore);
			expect(rowBefore?.classList.contains("item-hidden")).toBe(false);
			expect(rowBefore?.querySelector(".item-visibility")?.textContent).toBe(
				"✕",
			);
		});

		it("still applies the search filter to hidden rounds", () => {
			hiddenRoundIds.add("a");
			panel.showHiddenRounds = true;
			panel.searchQuery = "question b";

			reconcileList(list, [round("a"), round("b")], refreshUI);

			expect(rowIds(list)).toEqual(["b"]);
		});
	});
});
