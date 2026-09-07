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
}

/** Stable key over everything the rendered UI depends on. */
export function renderKey(input: RenderKeyInput): string {
	return JSON.stringify([
		input.isOpen,
		input.searchQuery,
		input.reverseOrder,
		input.roundIds,
	]);
}
