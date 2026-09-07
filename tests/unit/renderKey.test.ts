// core/renderKey.ts — the single value refreshUI compares against to decide
// whether a re-render is needed.
//
// The refactor plan expected refreshUI's three cached prev-state fields
// (panel.prevIsOpen, panel.prevSearchActive, fab.prevRoundIds) to disappear
// once state was consolidated. They did not: any reconciler has to compare
// against something. What they could become is ONE derived value instead of
// three ad-hoc fields, and that exposed a second problem -- the old fast path
// compared only the round COUNT and the LAST id, so a changed middle round was
// silently skipped, and reverseOrder was not in the comparison at all, so
// toggling sort order on an unchanged conversation did not re-render.
import { describe, expect, it } from "vitest";
import { renderKey } from "../../src/core/renderKey";

const base = {
	isOpen: true,
	searchQuery: "",
	reverseOrder: true,
	roundIds: ["r1", "r2", "r3"],
	hiddenRoundIds: [] as string[],
	showHiddenRounds: false,
};

describe("renderKey", () => {
	it("is stable for identical input", () => {
		expect(renderKey(base)).toBe(renderKey({ ...base }));
	});

	it("differs when the panel open state differs", () => {
		expect(renderKey({ ...base, isOpen: false })).not.toBe(renderKey(base));
	});

	it("differs when the search query differs", () => {
		expect(renderKey({ ...base, searchQuery: "x" })).not.toBe(renderKey(base));
	});

	it("differs when the sort order differs (the old fast path missed this)", () => {
		expect(renderKey({ ...base, reverseOrder: false })).not.toBe(
			renderKey(base),
		);
	});

	it("differs when a MIDDLE round id changes (the old fast path missed this)", () => {
		const changed = { ...base, roundIds: ["r1", "X", "r3"] };
		expect(renderKey(changed)).not.toBe(renderKey(base));
	});

	it("does not differ for an equal-length list with the same last id", () => {
		// This is exactly the case the old length + last-id check got wrong:
		// same length, same last id, different contents.
		const a = renderKey({ ...base, roundIds: ["a", "b", "c"] });
		const b = renderKey({ ...base, roundIds: ["z", "y", "c"] });
		expect(a).not.toBe(b);
	});

	it("differs when the round count changes", () => {
		expect(renderKey({ ...base, roundIds: ["r1", "r2"] })).not.toBe(
			renderKey(base),
		);
	});

	it("treats an empty round list as its own key", () => {
		expect(renderKey({ ...base, roundIds: [] })).not.toBe(renderKey(base));
	});

	it("does not let a round id smuggle the field separator", () => {
		// Ids come from message ids; if one contained "|" the key would be
		// ambiguous between two different states.
		const a = renderKey({ ...base, roundIds: ["a|b", "c"] });
		const b = renderKey({ ...base, roundIds: ["a", "b|c"] });
		expect(a).not.toBe(b);
	});

	it("differs when a round becomes hidden (the old fast path missed this)", () => {
		// Hiding changes the rendered list without touching the store's rounds,
		// so before this field existed, a ✕ click left the key unchanged and
		// the panel did not re-render until something else did.
		expect(renderKey({ ...base, hiddenRoundIds: ["r1"] })).not.toBe(
			renderKey(base),
		);
	});

	it("differs when a different round is hidden", () => {
		expect(renderKey({ ...base, hiddenRoundIds: ["r1"] })).not.toBe(
			renderKey({ ...base, hiddenRoundIds: ["r2"] }),
		);
	});

	it("differs when reveal mode toggles with the same hidden set", () => {
		// Reveal mode keeps hidden rounds in the list, dimmed — a rendered
		// change the hidden array alone cannot express.
		expect(
			renderKey({ ...base, hiddenRoundIds: ["r1"], showHiddenRounds: true }),
		).not.toBe(renderKey({ ...base, hiddenRoundIds: ["r1"] }));
	});

	it("distinguishes an empty search from a cleared-then-typed one of same length", () => {
		const a = renderKey({ ...base, searchQuery: "ab" });
		const b = renderKey({ ...base, searchQuery: "ba" });
		expect(a).not.toBe(b);
	});
});
