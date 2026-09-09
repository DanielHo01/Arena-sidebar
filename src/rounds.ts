// User-managed round state — hidden flags and deleted-message tombstones,
// persisted per session.
//
// History: hidden flags were a plain in-memory Set with no persistence and no
// unhide control (docs/handoff-2026-09-07.md §5.1). That made ✕ an irreversible
// action that a page refresh silently undid — and worse, round ids are not
// unique per session (bootstrap messages get deterministic ids like "boot-3"
// and round.id is simply msg.id), so a flag set in one session leaked into
// every session visited afterwards until the next reset.
//
// The fix is structural: flags are keyed by the real session id in storage,
// so two conversations cannot collide, and the panel renders a restore
// affordance for them (ui/panel/list.ts + ui/panel/roundItem.ts). Round
// grouping still lives in core/rounds.ts (single source of truth).
//
// #15 adds the second half: hard delete (🗑️). Where ✕ hides a round but keeps
// it restorable, 🗑️ drops its messages from the store and tombstones their
// fingerprints so the next DOM re-extract cannot resurrect them. Tombstones
// follow the same per-session key + cross-tab sync design as hidden flags.

import { onStorageChanged, storageGet, storageSet } from "./platform/storage";
import type { Disposer } from "./types";

export const hiddenRoundIds = new Set<string>();

/**
 * Storage key holding one session's hidden-round flags: a `string[]` of round
 * ids. A dedicated key rather than a field of the `session:{sid}` record: that
 * record is rewritten wholesale by the 2s capture-save loop, so an extra field
 * there would race with it and lose. Independent keys isolate the writes.
 */
export function hiddenRoundsKey(sessionId: string): string {
	return `edge-ai-sidebar:hidden-rounds:${sessionId}`;
}

/** The session whose flags are live in hiddenRoundIds; "" = none adopted. */
let currentSid = "";

/**
 * Drop every hidden-round flag and forget the session they belonged to.
 * Called by app/store.ts on session change, before the new session's flags
 * are loaded. Also disarms persistHiddenRounds() until the next load adopts
 * a session — there is nothing sensible to write flags for in between.
 */
export function resetHiddenRounds(): void {
	hiddenRoundIds.clear();
	currentSid = "";
}

/**
 * Adopt `sessionId` and load its flags from storage. An empty session id
 * (direct-chat routes have none) means "no flags", matching the old reset.
 *
 * Stale-load guard: two loads can be in flight when the user switches
 * sessions quickly (route change to A, then to B before A's read resolves).
 * The guard drops a result that no longer matches the latest adopted session
 * — without it, whichever read resolved LAST would win, which is not
 * necessarily the session on screen.
 */
export async function loadHiddenRounds(sessionId: string): Promise<void> {
	currentSid = sessionId;
	hiddenRoundIds.clear();
	if (!sessionId) return;
	const data = await storageGet(hiddenRoundsKey(sessionId));
	if (currentSid !== sessionId) return;
	applyHiddenRounds(data);
}

/**
 * Write the live flags back to storage. Fire-and-forget: the adapter never
 * rejects and reports failure by resolving false, which there is nothing to
 * do about at the call sites (the next toggle writes again).
 *
 * No-op while no session is adopted: direct-chat rounds are not persisted at
 * all (conversationStore.saveToStorage skips them for the same reason), so
 * their flags stay in-memory only — the same lifetime as the rounds themselves.
 */
export function persistHiddenRounds(): void {
	if (!currentSid) return;
	void storageSet(hiddenRoundsKey(currentSid), Array.from(hiddenRoundIds));
}

/**
 * Replace the live flags wholesale. Exported for the cross-tab sync below;
 * loadHiddenRounds is the only other caller.
 */
export function applyHiddenRounds(ids: unknown): void {
	hiddenRoundIds.clear();
	if (!Array.isArray(ids)) return;
	for (const id of ids) {
		if (typeof id === "string") hiddenRoundIds.add(id);
	}
}

/**
 * Keep hidden flags in step when another tab writes them.
 *
 * chrome.storage.onChanged also fires in the tab that performed the write, so
 * the echo of our own write arrives here too; when the stored value still
 * matches the live set it is skipped (the apply would be harmless, but the
 * refresh it triggers is not free). Change events per key arrive in write
 * order, so after any burst of writes the last one always wins.
 *
 * The subscription is per session (the key contains the session id), so the
 * caller re-subscribes on every route change and disposes the old handle —
 * see app/loop.ts handleRouteChange and content.ts bootstrap.
 */
export function setupHiddenRoundsSync(
	sessionId: string,
	onChange: () => void,
): Disposer {
	return onStorageChanged(hiddenRoundsKey(sessionId), (change) => {
		const next = (change as { newValue?: unknown } | undefined)?.newValue;
		if (sameStringSet(hiddenRoundIds, next)) return;
		applyHiddenRounds(next);
		onChange();
	});
}

/** True when `ids` is exactly what `live` already contains. */
function sameStringSet(live: Set<string>, ids: unknown): boolean {
	if (!Array.isArray(ids) || ids.length !== live.size) return false;
	return ids.every((id) => typeof id === "string" && live.has(id));
}

// ─── Deleted-message tombstones (#15) ─────────────────────────────────────────
//
// A hard-deleted round must stay deleted: without tombstones the next DOM
// re-extract would find the same messages again and resurrect them. Keys are
// fingerprint + occurrence — message ids are useless here because DOM
// re-extracts mint fresh random ids, while fingerprints renumber identically.
// Same per-session key, stale-load guard, and cross-tab sync as hidden flags.

export const deletedMessageKeys = new Set<string>();

/** Tombstone key for one message: content fingerprint + occurrence index. */
export function tombstoneKey(fingerprint: string, occurrence: number): string {
	return `${fingerprint}#${occurrence}`;
}

export function deletedMessagesKey(sessionId: string): string {
	return `edge-ai-sidebar:deleted-messages:${sessionId}`;
}

/** The session whose tombstones are live in deletedMessageKeys. */
let deletedSid = "";

export function resetDeletedMessages(): void {
	deletedMessageKeys.clear();
	deletedSid = "";
}

export async function loadDeletedMessages(sessionId: string): Promise<void> {
	deletedSid = sessionId;
	deletedMessageKeys.clear();
	if (!sessionId) return;
	const data = await storageGet(deletedMessagesKey(sessionId));
	if (deletedSid !== sessionId) return;
	applyDeletedMessages(data);
}

export function persistDeletedMessages(): void {
	if (!deletedSid) return;
	void storageSet(
		deletedMessagesKey(deletedSid),
		Array.from(deletedMessageKeys),
	);
}

export function applyDeletedMessages(ids: unknown): void {
	deletedMessageKeys.clear();
	if (!Array.isArray(ids)) return;
	for (const id of ids) {
		if (typeof id === "string") deletedMessageKeys.add(id);
	}
}

export function setupDeletedMessagesSync(
	sessionId: string,
	onChange: () => void,
): Disposer {
	return onStorageChanged(deletedMessagesKey(sessionId), (change) => {
		const next = (change as { newValue?: unknown } | undefined)?.newValue;
		if (sameStringSet(deletedMessageKeys, next)) return;
		applyDeletedMessages(next);
		onChange();
	});
}
