// User-managed round state — summaries and hidden flags.
// Public exports:
//   roundSummaries     — Map<roundId, { title, summary }>  (user edits)
//   hiddenRoundIds     — Set<roundId>  (hidden by user)
// Round grouping lives in conversationStore.computeRounds (single source of truth).

// ─── User-managed state ────────────────────────────────────────────────────────────

export const roundSummaries = new Map<
	string,
	{ title: string; summary: string }
>();
export const hiddenRoundIds = new Set<string>();

