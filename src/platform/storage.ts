// platform/storage.ts — reads, backend plumbing and change subscriptions.
//
// The write half (storageSet*, storageRemove, quota retry, eviction, the
// write-failure pub/sub) lives in ./storageWrites.ts, which reads the backend
// through getStorageBackend() below. The split is one-directional — this file
// never imports storageWrites — so no cycle is possible. Together, the two
// files are the ONLY modules allowed to touch chrome.storage.
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

/**
 * Backend accessor for ./storageWrites.ts, the write half of this module.
 * Exported so the dependency runs one way (writes -> reads) and no cycle is
 * possible. Test fakes installed via setStorageBackend are visible here too.
 */
export function getStorageBackend(): StorageBackend | null {
	return backend();
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

/**
 * Subscribe to writes of every key starting with `prefix` in the local area.
 * The handler receives the change and the full key (so callers can derive the
 * per-key identifier, e.g. a session id after SESSION_META_PREFIX). Returns a
 * Disposer; the caller owns teardown.
 */
export function onStorageChangedPrefix(
	prefix: string,
	handler: (change: unknown, key: string) => void,
): Disposer {
	if (typeof chrome === "undefined" || !chrome.storage?.onChanged) {
		return () => {};
	}
	const listener = (
		changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
		areaName: string,
	) => {
		if (areaName !== "local") return;
		for (const [key, change] of Object.entries(changes)) {
			if (key.startsWith(prefix)) handler(change, key);
		}
	};
	chrome.storage.onChanged.addListener(listener);
	return () => chrome.storage.onChanged.removeListener(listener);
}
