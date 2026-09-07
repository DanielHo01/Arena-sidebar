// ui/inlineRename.ts — the shared inline text editor behind both rename paths.
//
// Renaming a session used to be implemented twice with different semantics:
// historyTitles.ts hand-built an <input> for double-click rename, while
// contextMenu.ts called window.prompt() for right-click rename.
//
// That divergence cost twice. prompt() is a blocking native dialog that cannot be
// styled to match the extension, and jsdom does not implement it at all — so the
// context-menu rename path had zero test coverage and structurally could not gain
// any. And the two paths disagreed on edge cases: emptying the field on
// double-click wrote the old title back (bumping updatedAt for no visible
// change), while emptying it in the prompt wrote nothing.
//
// Divergent copies of one interaction are the same failure mode that produced the
// titleCache bug — two write paths for one operation, only one of which knew
// about a piece of state. So there is one editor now, and both callers use it.

import { h } from "./dom";

export interface InlineRenameOptions {
	/**
	 * Element whose text is replaced by the input, and restored on cancel. Typed
	 * as Element, not HTMLElement, because the callers reach it through
	 * closest("span, div, p") and querySelector("span"), which both return Element.
	 */
	target: Element;
	/** Value to prefill, and to restore if the edit is abandoned. */
	initial: string;
	/** Called once with the trimmed text when the edit is accepted. */
	onCommit: (newText: string) => void;
	/** Called once if the edit is abandoned (Escape, or an emptied field). */
	onCancel?: () => void;
}

/**
 * Replace `target`'s text with a text input, committing on Enter or blur and
 * cancelling on Escape.
 *
 * Leaves `target` holding either the new text or the original — never the input —
 * so callers only have to persist, never clean up the DOM.
 *
 * Settles at most once. Enter commits and removes the input, which fires blur;
 * without a latch that would commit twice and write to storage twice.
 */
export function beginInlineRename(opts: InlineRenameOptions): void {
	const { target, initial, onCommit, onCancel } = opts;

	const field = h("input", {
		type: "text",
		value: initial,
		style: {
			width: "100%",
			minWidth: "0",
			font: "inherit",
			background: "white",
			border: "1px solid #3b82f6",
			padding: "2px 4px",
			borderRadius: "3px",
			color: "black",
		},
	});

	target.textContent = "";
	target.appendChild(field);
	field.focus();
	field.select();

	let settled = false;

	const finish = (commit: boolean): void => {
		if (settled) return;
		settled = true;
		// No `|| ""` guard: HTMLInputElement.value is typed `string` and is never
		// null, so the fallback could only ever replace "" with "" -- an extra
		// branch that never changes the result.
		const typed = field.value.trim();
		// An emptied field is a cancel, not a commit of the old value: writing the
		// title back would bump updatedAt and persist for no visible change.
		if (commit && typed) {
			target.textContent = typed;
			onCommit(typed);
			return;
		}
		target.textContent = initial;
		onCancel?.();
	};

	field.addEventListener("blur", () => finish(true));
	field.addEventListener("keydown", (ev) => {
		// Stop the panel's global shortcuts from also handling these keys.
		ev.stopPropagation();
		if (ev.key === "Enter") {
			ev.preventDefault();
			finish(true);
		} else if (ev.key === "Escape") {
			finish(false);
		}
	});
}
