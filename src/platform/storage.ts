// platform/storage.ts — the ONLY module allowed to touch chrome.storage.
//
// Why this exists: there were 14 hand-rolled storage call sites across 5 files
// (fab, content, conversationStore, folders x5, historyTitles), each repeating
// `typeof chrome === "undefined" || !chrome.storage`, its own try/catch, and its
// own lastError branch. Three consequences, all real:
//
//   1. Every site fed `contextValid`, a one-way global kill switch. A single
//      lastError from ANY call permanently disabled storage for the whole tab.
//      historyTitles.ts carried a comment saying it deliberately bypassed the
//      flag because it was too destructive — a workaround for a workaround.
//   2. Error handling was inconsistent: some sites called invalidateContext(),
//      one had an empty branch with only a comment, two swallowed silently.
//   3. None of it was testable, because none of it was injectable.
//
// This module replaces all of it with per-call error handling. A failure returns
// a falsy result for that call only; the next call is unaffected. Nothing here
// ever rejects, so a storage failure can never crash the content script.
//
// `contextValid` / `invalidateContext` in state.ts are now dead and removed.
//
// Backend injection: tests call setStorageBackend(fake). Production uses
// chrome.storage.local's MV3 promise form.
import type { Disposer } from "../types";

export interface StorageBackend {
	get(keys: string | string[] | null): Promise<Record<string, unknown>>;
	set(items: Record<string, unknown>): Promise<void>;
	remove(keys: string | string[]): Promise<void>;
	/**
	 * Optional: chrome.storage.local.getBytesInUse. Absent in tests unless the
	 * fake provides it — getStorageUsage() resolves null without it.
	 */
	getBytesInUse?(keys?: string | string[] | null): Promise<number>;
	/** Optional: chrome.storage.local.QUOTA_BYTES. */
	quotaBytes?: number;
}

let override: StorageBackend | null = null;

/** Install a fake backend for tests. Pass null to restore chrome. */
export function setStorageBackend(b: StorageBackend | null): void {
	override = b;
}

function chromeBackend(): StorageBackend | null {
	if (typeof chrome === "undefined" || !chrome.storage?.local) return null;
	const local = chrome.storage.local;
	return {
		get: (keys) =>
			local.get(keys as string | string[] | Record<string, unknown> | null),
		set: (items) => local.set(items),
		remove: (keys) => local.remove(keys as string | string[]),
		getBytesInUse: (keys) => local.getBytesInUse(keys ?? null),
		quotaBytes: local.QUOTA_BYTES,
	};
}

function backend(): StorageBackend | null {
	return override ?? chromeBackend();
}

/** True when a storage backend exists at all. */
export function storageAvailable(): boolean {
	return backend() !== null;
}

/**
 * Read one key. Resolves undefined when the key is absent, when storage is
 * unavailable, or when the read failed — callers cannot distinguish those, and
 * by design should not need to: all three mean "treat as not present".
 */
export async function storageGet(key: string): Promise<unknown> {
	const b = backend();
	if (!b) return undefined;
	try {
		const result = await b.get(key);
		return result?.[key];
	} catch (error) {
		console.warn("[AI Sidebar] storageGet failed:", key, error);
		return undefined;
	}
}

/** Read every key. Used by the legacy historyTitle_* migration. */
export async function storageGetAll(): Promise<Record<string, unknown>> {
	const b = backend();
	if (!b) return {};
	try {
		return (await b.get(null)) ?? {};
	} catch (error) {
		console.warn("[AI Sidebar] storageGetAll failed:", error);
		return {};
	}
}

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
	const b = backend();
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
				console.log(
					`[AI Sidebar] storageSet recovered after evicting ${evicted} snapshot(s):`,
					key,
				);
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
	const b = backend();
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
 * Delete the oldest keys under `prefix`, keeping a newest-first window bounded
 * by BOTH `keepNewest` count and `byteBudget` bytes (by payload lastSavedAt /
 * updatedAt; payloads with neither count as oldest). The single newest entry
 * is always spared from the byte budget — evicting the session the user is in
 * to satisfy an average cannot be right; if it alone exceeds quota the retry
 * fails honestly and the UI toasts.
 *
 * Resolves with the number of keys removed. Never rejects.
 */
export async function evictOldestKeys(
	prefix: string,
	keepNewest: number,
	byteBudget: number,
): Promise<number> {
	const b = backend();
	if (!b) return 0;
	let all: Record<string, unknown>;
	try {
		all = (await b.get(null)) ?? {};
	} catch (error) {
		console.warn("[AI Sidebar] evictOldestKeys: list failed:", error);
		return 0;
	}
	const snapshots = Object.entries(all)
		.filter(([k]) => k.startsWith(prefix))
		.map(([k, v]) => ({
			k,
			// Snapshots stamp lastSavedAt, overlay mirrors stamp updatedAt.
			lastSavedAt:
				typeof (v as { lastSavedAt?: unknown })?.lastSavedAt === "number"
					? (v as { lastSavedAt: number }).lastSavedAt
					: typeof (v as { updatedAt?: unknown })?.updatedAt === "number"
						? (v as { updatedAt: number }).updatedAt
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
		console.warn("[AI Sidebar] evictOldestKeys: remove failed:", error);
		return 0;
	}
	console.log(
		`[AI Sidebar] evictOldestKeys: removed ${victimKeys.length} oldest key(s) under ${prefix}`,
	);
	return victimKeys.length;
}

/** Snapshot-flavoured evictOldestKeys: newest 50 within 6MB. */
export async function evictOldestSnapshots(
	keepNewest: number = MAX_SESSION_SNAPSHOTS,
	byteBudget: number = SNAPSHOT_BYTES_BUDGET,
): Promise<number> {
	return evictOldestKeys(SESSION_SNAPSHOT_PREFIX, keepNewest, byteBudget);
}

export interface StorageUsage {
	used: number;
	quota: number;
}

/**
 * Bytes in use vs quota for the local area. Resolves null when no backend
 * exists or the backend cannot report usage (test fakes without
 * getBytesInUse). Never rejects.
 */
export async function getStorageUsage(): Promise<StorageUsage | null> {
	const b = backend();
	if (!b?.getBytesInUse) return null;
	try {
		const used = await b.getBytesInUse(null);
		const quota = b.quotaBytes ?? 10 * 1024 * 1024;
		return { used, quota };
	} catch (error) {
		console.warn("[AI Sidebar] getStorageUsage failed:", error);
		return null;
	}
}

/**
 * Subscribe to writes of one key in the local area. Returns a Disposer; the
 * caller owns teardown, per the rule that every setup* returns one.
 */
export function onStorageChanged(
	key: string,
	handler: (change: unknown) => void,
): Disposer {
	if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
		return () => {};
	}
	const listener = (
		changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
		areaName: string,
	) => {
		if (areaName !== "local") return;
		if (!(key in changes)) return;
		handler(changes[key]);
	};
	chrome.storage.onChanged.addListener(listener);
	return () => chrome.storage.onChanged.removeListener(listener);
}
