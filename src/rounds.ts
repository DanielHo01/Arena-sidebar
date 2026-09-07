// User-managed round state — hidden flags only.
// roundSummaries was removed in phase10a cleanup (never written by any code).
// Round grouping lives in core/rounds.ts (single source of truth).

export const hiddenRoundIds = new Set<string>();

/**
 * Drop every hidden-round flag. Called by app/store.ts on session change.
 *
 * This is session-scoped state even though the set itself is global, because
 * round ids are not unique per session: bootstrap messages get deterministic ids
 * ("boot-" + results.length, "boot-" + path + "-" + n) and round.id is simply
 * msg.id. Two different conversations therefore produce colliding ids, and
 * without this reset a round hidden in one session stays hidden in every session
 * visited afterwards -- permanently, since the panel has no unhide control.
 */
export function resetHiddenRounds(): void {
	hiddenRoundIds.clear();
}
