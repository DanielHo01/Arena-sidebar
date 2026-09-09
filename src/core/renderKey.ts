// core/renderKey.ts — one derived value that decides whether refreshUI must
// re-render.
//
// Replaces three ad-hoc prev-state fields (panel.prevIsOpen,
// panel.prevSearchActive, fab.prevRoundIds) with a single comparable string.
//
// It also fixes two things the old comparison got wrong:
//   - it compared only the round COUNT plus the LAST id, so swapping a middle
//     round ("a","b","c" -> "z","y","c") looked unchanged and the panel kept
//     showing stale rows;
//   - reverseOrder was not part of it at all, so toggling sort order on an
//     unchanged conversation hit the fast path and never re-rendered.
//
// JSON encoding is deliberate: a bare join() would let an id containing the
// separator make two different states produce the same key.

export interface RenderKeyInput {
	isOpen: boolean;
	searchQuery: string;
	reverseOrder: boolean;
	roundIds: string[];
	/**
	 * Round ids currently flagged hidden. Hiding changes the rendered list
	 * without touching the store's rounds, so without this field the fast
	 * path concluded "nothing changed" and a ✕ click did not re-render the
	 * panel until something else did. Reveal mode does not change the hidden
	 * set either, hence the separate boolean below.
	 */
	hiddenRoundIds: string[];
	/** Reveal mode: hidden rounds render dimmed with a restore button. */
	showHiddenRounds: boolean;
	/**
	 * Battle mode with an empty store (#14). Detection renames the empty
	 * state, so without this field a vote bar appearing on an otherwise
	 * unchanged page would not re-render the notice.
	 */
	battleMode: boolean;
}

/** Stable key over everything the rendered UI depends on. */
export function renderKey(input: RenderKeyInput): string {
	return JSON.stringify([
		input.isOpen,
		input.searchQuery,
		input.reverseOrder,
		input.roundIds,
		input.hiddenRoundIds,
		input.showHiddenRounds,
		input.battleMode,
	]);
}
