// ui/inlineRename.ts — the shared inline text editor behind both rename paths.
//
// Before this module the same interaction existed twice with different semantics:
// historyTitles.ts built an <input> by hand for double-click rename, while
// contextMenu.ts called window.prompt() for right-click rename. Two problems
// followed. prompt() is a blocking native dialog that cannot be styled to match
// the extension, and jsdom does not implement it at all, so the context-menu
// rename path had zero test coverage and could not gain any. And the two paths
// disagreed on edge cases — emptying the field on double-click wrote the old
// title back (bumping updatedAt), while emptying it in the prompt did nothing.
//
// These assertions pin the single contract both callers now share.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { beginInlineRename } from "../../src/ui/inlineRename";

let target: Element;

beforeEach(() => {
	document.body.innerHTML = `<div id="t">Original Title</div>`;
	target = document.getElementById("t")!;
});

afterEach(() => {
	vi.restoreAllMocks();
	document.body.innerHTML = "";
});

/** The input currently inside the target, if any. */
function input(): HTMLInputElement | null {
	return target.querySelector("input");
}

function key(k: string): void {
	input()!.dispatchEvent(
		new KeyboardEvent("keydown", { key: k, bubbles: true }),
	);
}

describe("beginInlineRename", () => {
	it("swaps the target's text for a focused, selected, prefilled input", () => {
		beginInlineRename({
			target,
			initial: "Original Title",
			onCommit: () => {},
		});

		const el = input();
		expect(el).not.toBeNull();
		expect(el!.value).toBe("Original Title");
		expect(el!.type).toBe("text");
		expect(document.activeElement).toBe(el);
		// The old text must be gone, not merely covered.
		expect(target.textContent).toBe("");
	});

	it("commits the trimmed value on Enter", () => {
		const onCommit = vi.fn();
		beginInlineRename({ target, initial: "Old", onCommit });

		input()!.value = "  New Name  ";
		key("Enter");

		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith("New Name");
	});

	it("commits on blur", () => {
		const onCommit = vi.fn();
		beginInlineRename({ target, initial: "Old", onCommit });

		input()!.value = "Blurred";
		input()!.dispatchEvent(new FocusEvent("blur"));

		expect(onCommit).toHaveBeenCalledTimes(1);
		expect(onCommit).toHaveBeenCalledWith("Blurred");
	});

	it("cancels on Escape, restoring the original text and not committing", () => {
		const onCommit = vi.fn();
		const onCancel = vi.fn();
		beginInlineRename({
			target,
			initial: "Original Title",
			onCommit,
			onCancel,
		});

		input()!.value = "Discarded";
		key("Escape");

		expect(onCommit).not.toHaveBeenCalled();
		expect(onCancel).toHaveBeenCalledTimes(1);
		expect(target.textContent).toBe("Original Title");
		expect(input()).toBeNull();
	});

	it("treats an emptied field as a cancel, not a commit", () => {
		// The two old paths disagreed here: double-click wrote the old title back
		// (bumping updatedAt for no visible change), the prompt wrote nothing.
		// Cancel is the behaviour that matches user intent.
		const onCommit = vi.fn();
		beginInlineRename({ target, initial: "Original Title", onCommit });

		input()!.value = "   ";
		key("Enter");

		expect(onCommit).not.toHaveBeenCalled();
		expect(target.textContent).toBe("Original Title");
		expect(input()).toBeNull();
	});

	it("commits at most once when Enter is followed by the resulting blur", () => {
		// Enter commits and replaces the target's contents, so the field leaves the
		// DOM -- which fires its blur handler a second time. Without the latch that
		// double-commits and writes to storage twice. The blur is dispatched on the
		// field itself, because that is where the listener lives; dispatching it on
		// the target would exercise nothing and let the latch go untested.
		const onCommit = vi.fn();
		beginInlineRename({ target, initial: "Old", onCommit });

		const field = input()!;
		field.value = "Once";
		key("Enter");
		field.dispatchEvent(new FocusEvent("blur"));

		expect(onCommit).toHaveBeenCalledTimes(1);
	});

	it("does not commit on the blur that follows an Escape", () => {
		const onCommit = vi.fn();
		beginInlineRename({ target, initial: "Original Title", onCommit });

		const field = input()!;
		field.value = "Discarded";
		key("Escape");
		field.dispatchEvent(new FocusEvent("blur"));

		expect(onCommit).not.toHaveBeenCalled();
		expect(target.textContent).toBe("Original Title");
	});

	it("ignores keys other than Enter and Escape", () => {
		// Typing must not settle the edit. Covers the branch where the keydown
		// handler matches neither commit nor cancel.
		const onCommit = vi.fn();
		const onCancel = vi.fn();
		beginInlineRename({
			target,
			initial: "Original Title",
			onCommit,
			onCancel,
		});

		input()!.value = "Still editing";
		key("a");
		key("Tab");

		expect(onCommit).not.toHaveBeenCalled();
		expect(onCancel).not.toHaveBeenCalled();
		expect(input()).not.toBeNull();
		expect(target.textContent).toBe("");
	});
});
