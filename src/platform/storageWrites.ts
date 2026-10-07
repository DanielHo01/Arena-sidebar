// platform/storageWrites.ts — the write half of the chrome.storage adapter.
//
// Split out of ./storage.ts (Track A2): writes + quota retry + LRU eviction +
// the write-failure pub/sub. Reads, the backend registry and change
// subscriptions stay in storage.ts; this file reaches the backend only through
// getStorageBackend(). Together, the two files are the ONLY modules allowed to
// touch chrome.storage, and nothing here ever rejects — a failure returns a
// falsy result for that call only.

import type { Disposer } from "../types";
import { getStorageBackend } from "./storage";

/** Why a write did not happen. */
export type StorageWriteFailureReason = "unavailable" | "quota" | "error";

export interface StorageWriteResult {
	ok: boolean;
	/** Present when ok is false. */
	reason?: StorageWriteFailureReason;
	/** Snapshots evicted by the quota-retry path (0 when none were). */
	evicted?: number;
}

export interface StorageWriteFailure {
	key: string;
	reason: Exclude<StorageWriteFailureReason, "unavailable">;
	evicted: number;
}

const writeFailureListeners = new Set<(f: StorageWriteFailure) => void>();

/**
 * Subscribe to writes that failed even after the quota-retry path. This is
 * the seam that lets the UI toast "storage full" without the data layer
 * importing the UI layer. "unavailable" (no backend at all) is NOT reported:
 * every write fails that way in unsupported contexts and it would only spam.
 */
export function onStorageWriteFailed(
	listener: (f: StorageWriteFailure) => void,
): Disposer {
	writeFailureListeners.add(listener);
	return () => {
		writeFailureListeners.delete(listener);
	};
}

function emitWriteFailure(failure: StorageWriteFailure): void {
	for (const listener of writeFailureListeners) {
		try {
			listener(failure);
		} catch (error) {
			console.warn("[AI Sidebar] storage failure listener threw:", error);
		}
	}
}

/**
 * True when the rejection is chrome.storage.local's quota error
 * ("Resource::kQuotaBytes quota exceeded"). Matched loosely: Chromium has
 * shipped both `kQuotaBytes` and `QUOTA_BYTES` phrasings.
 */
export function isQuotaError(error: unknown): boolean {
	return /quota/i.test(String(error));
}

/**
 * Write one key, with an optional quota-retry: when the write rejects with a
 * quota error and evictOnQuota is set, the oldest session snapshots are
 * evicted and the write is retried exactly once (#22).
 *
 * Never rejects. Callers that need the failure reason (for UI feedback) use
 * this; callers that only need ok/fail use storageSet.
 */
export async function storageSetDetailed(
	key: string,
	value: unknown,
	opts?: { evictOnQuota?: boolean },
): Promise<StorageWriteResult> {
	const b = getStorageBackend();
	if (!b) return { ok: false, reason: "unavailable" };
	try {
		await b.set({ [key]: value });
		return { ok: true };
	} catch (error) {
		if (opts?.evictOnQuota && isQuotaError(error)) {
			const evicted = await evictOldestSnapshots(
				QUOTA_EVICT_KEEP,
				QUOTA_EVICT_BYTES,
			);
			try {
				await b.set({ [key]: value });
				return { ok: true, evicted };
			} catch (retryError) {
				console.warn(
					"[AI Sidebar] storageSet failed after eviction:",
					key,
					retryError,
				);
				const failure = {
					key,
					reason: isQuotaError(retryError)
						? ("quota" as const)
						: ("error" as const),
					evicted,
				};
				emitWriteFailure(failure);
				return { ok: false, reason: failure.reason, evicted };
			}
		}
		console.warn("[AI Sidebar] storageSet failed:", key, error);
		const reason = isQuotaError(error)
			? ("quota" as const)
			: ("error" as const);
		emitWriteFailure({ key, reason, evicted: 0 });
		return { ok: false, reason, evicted: 0 };
	}
}

/** Write one key. Resolves false when the write did not happen. */
export async function storageSet(
	key: string,
	value: unknown,
): Promise<boolean> {
	return (await storageSetDetailed(key, value)).ok;
}

/** Delete keys. Resolves false when the delete did not happen. */
export async function storageRemove(keys: string[]): Promise<boolean> {
	const b = getStorageBackend();
	if (!b || keys.length === 0) return keys.length === 0;
	try {
		await b.remove(keys);
		return true;
	} catch (error) {
		console.warn("[AI Sidebar] storageRemove failed:", keys, error);
		return false;
	}
}

// ─── Quota monitoring + LRU eviction (#22 / #23) ──────────────────────────────────────────
//
// chrome.storage.local is ~10MB and every session snapshot stores full message
// content. Without a ceiling the area fills up and EVERY write (snapshots,
// folder index, hidden flags) starts failing — silently, per call. The two
// guards:
//
//   1. Proactive trim: after each snapshot save the store keeps the newest
//      MAX_SESSION_SNAPSHOTS within SNAPSHOT_BYTES_BUDGET (throttled; see
//      conversationStore). The byte budget is the real guard — a 100-round
//      session snapshots at ~1MB, so a count cap alone cannot bound the area.
//   2. Reactive quota retry: storageSetDetailed with evictOnQuota evicts to
//      the emergency budget and retries once.
//
// Only `edge-ai-sidebar:session:*` keys are ever evicted — the folder index,
// renames, hidden flags and theme are small and irreplaceable, while a
// snapshot is re-derivable: revisiting the session re-extracts it from DOM.
// (Edits made inside the extension on an evicted session are the one thing
// that is not recoverable; the emergency path accepts that.)

/** Key prefix for per-session message snapshots. */
export const SESSION_SNAPSHOT_PREFIX = "edge-ai-sidebar:session:";

/** Proactive cap: newest N snapshots are kept, older ones trimmed. */
export const MAX_SESSION_SNAPSHOTS = 50;

/**
 * Proactive byte budget for all snapshots combined. 6 of ~10MB: folders,
 * hidden flags and headroom own the rest.
 */
export const SNAPSHOT_BYTES_BUDGET = 6 * 1024 * 1024;

/** Emergency floor: a quota retry keeps at most the newest N snapshots. */
export const QUOTA_EVICT_KEEP = 10;

/** Emergency byte budget a quota retry evicts down to. */
export const QUOTA_EVICT_BYTES = 3 * 1024 * 1024;

/** Approximate serialized size of one stored snapshot value. */
function snapshotBytes(value: unknown): number {
	const recorded = (value as { bytes?: unknown })?.bytes;
	if (typeof recorded === "number" && recorded >= 0) return recorded;
	// Legacy payloads (written before `bytes` existed) are measured live.
	// JSON length counts UTF-16 code units, chrome counts bytes — close
	// enough for a budget with 40% headroom baked in.
	try {
		return JSON.stringify(value)?.length ?? 0;
	} catch {
		return 0;
	}
}

/**
 * Delete the oldest session snapshots, keeping a newest-first window bounded
 * by BOTH `keepNewest` count and `byteBudget` bytes (by payload lastSavedAt;
 * payloads without one count as oldest). The single newest snapshot is always
 * spared from the byte budget — evicting the session the user is in to satisfy
 * an average cannot be right; if it alone exceeds quota the retry fails
 * honestly and the UI toasts.
 *
 * Resolves with the number of keys removed. Never rejects.
 */
export async function evictOldestSnapshots(
	keepNewest: number = MAX_SESSION_SNAPSHOTS,
	byteBudget: number = SNAPSHOT_BYTES_BUDGET,
): Promise<number> {
	const b = getStorageBackend();
	if (!b) return 0;
	let all: Record<string, unknown>;
	try {
		all = (await b.get(null)) ?? {};
	} catch (error) {
		console.warn("[AI Sidebar] evictOldestSnapshots: list failed:", error);
		return 0;
	}
	const snapshots = Object.entries(all)
		.filter(([k]) => k.startsWith(SESSION_SNAPSHOT_PREFIX))
		.map(([k, v]) => ({
			k,
			lastSavedAt:
				typeof (v as { lastSavedAt?: unknown })?.lastSavedAt === "number"
					? ((v as { lastSavedAt: number }).lastSavedAt ?? 0)
					: 0,
			bytes: snapshotBytes(v),
		}))
		.sort((a, b2) => a.lastSavedAt - b2.lastSavedAt);
	// Newest-first: keep while under both caps. The first (newest) entry
	// bypasses the byte budget (see docstring) but not the count gate, so
	// keepNewest=0 still evicts everything.
	let keptCount = 0;
	let keptBytes = 0;
	const victimKeys: string[] = [];
	for (const s of [...snapshots].reverse()) {
		if (
			keptCount < keepNewest &&
			(keptCount === 0 || keptBytes + s.bytes <= byteBudget)
		) {
			keptCount++;
			keptBytes += s.bytes;
		} else {
			victimKeys.push(s.k);
		}
	}
	if (victimKeys.length === 0) return 0;
	try {
		await b.remove(victimKeys);
	} catch (error) {
		console.warn("[AI Sidebar] evictOldestSnapshots: remove failed:", error);
		return 0;
	}
	return victimKeys.length;
}
