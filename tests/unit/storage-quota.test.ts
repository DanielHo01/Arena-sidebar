// Quota monitoring + LRU eviction (#22 / #23).
//
// chrome.storage.local is ~10MB and every session snapshot stores full
// message content. These tests pin down the three guards:
//
//   1. evictOldestSnapshots() deletes oldest-first, session keys only.
//   2. storageSetDetailed({evictOnQuota}) retries once past a quota error.
//   3. A write that fails for good is reported via onStorageWriteFailed so
//      the UI can toast instead of losing data silently.
//
// Plus getStorageUsage(), the header dot's data source.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	MAX_SESSION_SNAPSHOTS,
	QUOTA_EVICT_KEEP,
	SESSION_SNAPSHOT_PREFIX,
	evictOldestSnapshots,
	getStorageUsage,
	isQuotaError,
	onStorageWriteFailed,
	setStorageBackend,
	storageSetDetailed,
	type StorageBackend,
	type StorageWriteFailure,
} from "../../src/platform/storage";

const QUOTA_MESSAGE = "Resource::kQuotaBytes quota exceeded";

interface FakeOpts {
	/** set() rejects with a quota error this many times, then succeeds. */
	quotaFailures?: number;
	/** set() always rejects with a quota error. */
	quotaAlways?: boolean;
	/** get(null) rejects. */
	failList?: boolean;
	/** remove() rejects. */
	failRemove?: boolean;
	/** getBytesInUse() resolves this. Absent → the method is missing. */
	bytesInUse?: number;
	/** quotaBytes field. Absent → undefined. */
	quotaBytes?: number;
	/** getBytesInUse() rejects. */
	failUsage?: boolean;
}

function fakeBackend(opts: FakeOpts = {}) {
	const data = new Map<string, unknown>();
	let quotaLeft = opts.quotaFailures ?? 0;
	const backend: StorageBackend = {
		get: async (keys) => {
			if (opts.failList && keys === null) throw new Error("list boom");
			if (keys === null) return Object.fromEntries(data);
			const list = Array.isArray(keys) ? keys : [keys];
			const out: Record<string, unknown> = {};
			for (const k of list) if (data.has(k)) out[k] = data.get(k);
			return out;
		},
		set: async (items) => {
			if (opts.quotaAlways || quotaLeft > 0) {
				quotaLeft--;
				throw new Error(QUOTA_MESSAGE);
			}
			for (const [k, v] of Object.entries(items)) data.set(k, v);
		},
		remove: async (keys) => {
			if (opts.failRemove) throw new Error("remove boom");
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
		},
	};
	if (opts.bytesInUse !== undefined || opts.failUsage) {
		backend.getBytesInUse = async () => {
			if (opts.failUsage) throw new Error("usage boom");
			return opts.bytesInUse ?? 0;
		};
	}
	if (opts.quotaBytes !== undefined) backend.quotaBytes = opts.quotaBytes;
	return { backend, data };
}

function snapKey(i: number): string {
	return `${SESSION_SNAPSHOT_PREFIX}session-${i}`;
}

function seedSnapshots(
	data: Map<string, unknown>,
	count: number,
	startAt = 0,
): void {
	for (let i = 0; i < count; i++) {
		data.set(snapKey(startAt + i), {
			messages: [],
			lastSavedAt: 1000 + startAt + i,
			sessionId: `session-${startAt + i}`,
		});
	}
}

describe("isQuotaError", () => {
	it("matches Chromium's kQuotaBytes phrasing", () => {
		expect(isQuotaError(new Error(QUOTA_MESSAGE))).toBe(true);
	});

	it("matches the QUOTA_BYTES phrasing", () => {
		expect(isQuotaError("QUOTA_BYTES quota exceeded")).toBe(true);
	});

	it("rejects unrelated errors", () => {
		expect(isQuotaError(new Error("Extension context invalidated."))).toBe(
			false,
		);
		expect(isQuotaError(null)).toBe(false);
		expect(isQuotaError(undefined)).toBe(false);
	});
});

describe("getStorageUsage", () => {
	afterEach(() => setStorageBackend(null));

	it("is null when no backend exists", async () => {
		setStorageBackend(null);
		await expect(getStorageUsage()).resolves.toBeNull();
	});

	it("is null when the backend cannot report usage", async () => {
		setStorageBackend(fakeBackend().backend);
		await expect(getStorageUsage()).resolves.toBeNull();
	});

	it("reports used vs quota", async () => {
		setStorageBackend(
			fakeBackend({ bytesInUse: 1024, quotaBytes: 2048 }).backend,
		);
		await expect(getStorageUsage()).resolves.toEqual({
			used: 1024,
			quota: 2048,
		});
	});

	it("defaults the quota to 10MB", async () => {
		setStorageBackend(fakeBackend({ bytesInUse: 5 }).backend);
		await expect(getStorageUsage()).resolves.toEqual({
			used: 5,
			quota: 10 * 1024 * 1024,
		});
	});

	it("never rejects", async () => {
		setStorageBackend(fakeBackend({ failUsage: true }).backend);
		await expect(getStorageUsage()).resolves.toBeNull();
	});

	it("reads getBytesInUse/QUOTA_BYTES from the real chrome backend", async () => {
		setStorageBackend(null);
		const getBytesInUse = vi.fn(async () => 42);
		vi.stubGlobal("chrome", {
			storage: { local: { getBytesInUse, QUOTA_BYTES: 100 } },
		});
		try {
			await expect(getStorageUsage()).resolves.toEqual({
				used: 42,
				quota: 100,
			});
			expect(getBytesInUse).toHaveBeenCalledWith(null);
		} finally {
			vi.unstubAllGlobals();
		}
	});
});

describe("evictOldestSnapshots", () => {
	afterEach(() => setStorageBackend(null));

	it("is a no-op without a backend", async () => {
		setStorageBackend(null);
		await expect(evictOldestSnapshots()).resolves.toBe(0);
	});

	it("keeps everything under the cap", async () => {
		const f = fakeBackend();
		setStorageBackend(f.backend);
		seedSnapshots(f.data, 3);
		await expect(evictOldestSnapshots(50)).resolves.toBe(0);
		expect(f.data.size).toBe(3);
	});

	it("removes oldest-first by lastSavedAt, keeping the newest N", async () => {
		const f = fakeBackend();
		setStorageBackend(f.backend);
		seedSnapshots(f.data, 5);
		await expect(evictOldestSnapshots(2)).resolves.toBe(3);
		expect([...f.data.keys()].sort()).toEqual([snapKey(3), snapKey(4)]);
	});

	it("treats payloads without lastSavedAt as oldest", async () => {
		const f = fakeBackend();
		setStorageBackend(f.backend);
		f.data.set(snapKey(0), { messages: [] });
		seedSnapshots(f.data, 2, 1);
		await expect(evictOldestSnapshots(2)).resolves.toBe(1);
		expect(f.data.has(snapKey(0))).toBe(false);
	});

	it("never touches non-snapshot keys", async () => {
		const f = fakeBackend();
		setStorageBackend(f.backend);
		f.data.set("edge-ai-sidebar:folders", { folders: [] });
		f.data.set("historyTitle_abc", "x");
		f.data.set("fabPosition", { x: 1, y: 2 });
		seedSnapshots(f.data, 3);
		// keepNewest=0: every snapshot goes, nothing else does.
		await expect(evictOldestSnapshots(0)).resolves.toBe(3);
		expect([...f.data.keys()].sort()).toEqual([
			"edge-ai-sidebar:folders",
			"fabPosition",
			"historyTitle_abc",
		]);
	});

	it("defaults to MAX_SESSION_SNAPSHOTS", async () => {
		const f = fakeBackend();
		setStorageBackend(f.backend);
		seedSnapshots(f.data, MAX_SESSION_SNAPSHOTS + 5);
		await expect(evictOldestSnapshots()).resolves.toBe(5);
		expect(f.data.size).toBe(MAX_SESSION_SNAPSHOTS);
	});

	it("resolves 0 when the list fails, instead of throwing", async () => {
		setStorageBackend(fakeBackend({ failList: true }).backend);
		await expect(evictOldestSnapshots(0)).resolves.toBe(0);
	});

	it("resolves 0 when the remove fails, instead of throwing", async () => {
		const f = fakeBackend({ failRemove: true });
		setStorageBackend(f.backend);
		seedSnapshots(f.data, 3);
		await expect(evictOldestSnapshots(0)).resolves.toBe(0);
		expect(f.data.size).toBe(3);
	});
});

describe("storageSetDetailed", () => {
	let failures: StorageWriteFailure[];
	let disposeFailureSub: () => void;

	beforeEach(() => {
		failures = [];
		disposeFailureSub = onStorageWriteFailed((f) => failures.push(f));
	});

	afterEach(() => {
		disposeFailureSub();
		setStorageBackend(null);
	});

	it("reports ok on success and emits nothing", async () => {
		setStorageBackend(fakeBackend().backend);
		const result = await storageSetDetailed("k", 1, { evictOnQuota: true });
		expect(result).toEqual({ ok: true });
		expect(failures).toHaveLength(0);
	});

	it("reports unavailable without a backend and emits nothing", async () => {
		setStorageBackend(null);
		const result = await storageSetDetailed("k", 1, { evictOnQuota: true });
		expect(result).toEqual({ ok: false, reason: "unavailable" });
		expect(failures).toHaveLength(0);
	});

	it("a non-quota error reports error without evicting", async () => {
		const f = fakeBackend();
		setStorageBackend(f.backend);
		seedSnapshots(f.data, 3);
		// Fail the set with a generic error exactly once, then succeed — but
		// without a quota trigger there is no retry, so it must surface.
		const origSet = f.backend.set;
		let calls = 0;
		f.backend.set = async (items) => {
			calls++;
			if (calls === 1) throw new Error("Extension context invalidated.");
			return origSet(items);
		};
		const result = await storageSetDetailed("k", 1, { evictOnQuota: true });
		expect(result).toEqual({ ok: false, reason: "error", evicted: 0 });
		expect(f.data.size).toBe(3); // snapshots untouched
		expect(failures).toEqual([{ key: "k", reason: "error", evicted: 0 }]);
	});

	it("a quota error without evictOnQuota reports quota and emits", async () => {
		const f = fakeBackend({ quotaFailures: 1 });
		setStorageBackend(f.backend);
		seedSnapshots(f.data, 3);
		const result = await storageSetDetailed("k", 1);
		expect(result).toEqual({ ok: false, reason: "quota", evicted: 0 });
		expect(f.data.size).toBe(3);
		expect(failures).toEqual([{ key: "k", reason: "quota", evicted: 0 }]);
	});

	it("a quota error with evictOnQuota evicts, then the retry lands", async () => {
		const f = fakeBackend({ quotaFailures: 1 });
		setStorageBackend(f.backend);
		seedSnapshots(f.data, QUOTA_EVICT_KEEP + 4);
		const result = await storageSetDetailed(
			"edge-ai-sidebar:session:new",
			{ messages: [] },
			{ evictOnQuota: true },
		);
		expect(result).toEqual({ ok: true, evicted: 4 });
		// Newest QUOTA_EVICT_KEEP survive, plus the retried write.
		expect(f.data.size).toBe(QUOTA_EVICT_KEEP + 1);
		expect(f.data.has("edge-ai-sidebar:session:new")).toBe(true);
		expect(failures).toHaveLength(0);
	});

	it("a quota that survives eviction reports quota with the evicted count", async () => {
		const f = fakeBackend({ quotaAlways: true });
		setStorageBackend(f.backend);
		seedSnapshots(f.data, QUOTA_EVICT_KEEP + 4);
		const result = await storageSetDetailed("k", 1, { evictOnQuota: true });
		expect(result).toEqual({ ok: false, reason: "quota", evicted: 4 });
		expect(failures).toEqual([{ key: "k", reason: "quota", evicted: 4 }]);
	});
});

describe("onStorageWriteFailed", () => {
	afterEach(() => setStorageBackend(null));

	it("the disposer stops delivery", async () => {
		setStorageBackend(fakeBackend({ quotaAlways: true }).backend);
		const seen: StorageWriteFailure[] = [];
		const dispose = onStorageWriteFailed((f) => seen.push(f));
		await storageSetDetailed("a", 1);
		dispose();
		await storageSetDetailed("b", 2);
		expect(seen).toEqual([{ key: "a", reason: "quota", evicted: 0 }]);
	});

	it("a throwing listener does not starve the others", async () => {
		setStorageBackend(fakeBackend({ quotaAlways: true }).backend);
		const seen: string[] = [];
		const bad = onStorageWriteFailed(() => {
			throw new Error("listener boom");
		});
		const good = onStorageWriteFailed((f) => seen.push(f.key));
		await storageSetDetailed("a", 1);
		bad();
		good();
		expect(seen).toEqual(["a"]);
	});

	it("a listener can be unsubscribed twice", () => {
		const dispose = onStorageWriteFailed(vi.fn());
		dispose();
		expect(() => dispose()).not.toThrow();
	});
});
