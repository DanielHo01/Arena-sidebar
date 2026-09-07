// User-managed round state — hidden flags only.
// roundSummaries was removed in phase10a cleanup (never written by any code).
// Round grouping lives in conversationStore.computeRounds (single source of truth).

export const hiddenRoundIds = new Set<string>();
