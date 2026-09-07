// platform/storage.ts — the single chrome.storage adapter.
//
// Before this module existed there were 14 hand-rolled storage sites across 5
// files, each re-implementing `typeof chrome` + try/catch + lastError with
// inconsistent behaviour. Worst of all, all of them fed `contextValid`, a
// one-way global kill switch: a single lastError from ANY call permanently
// disabled storage for the whole tab. historyTitles.ts even had a comment
// saying it deliberately bypassed the flag because it was too destructive.
//
// The central property these tests pin down is therefore NOT "it reads and
// writes" but "a failure is per-call".
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	onStorageChanged,
	setStorageBackend,
	storageAvailable,
	storageGet,
	storageGetAll,
	storageRemove,
	storageSet,
	type StorageBackend,
} from "../../src/platform/storage";

/** In-memory backend. `fail` makes the NEXT call reject, once. */
function fakeBackend() {
	const data = new Map<string, unknown>();
	const state = { failNext: false };
	const guard = () => {
		if (state.failNext) {
			state.failNext = false;
			throw new Error("Extension context invalidated.");
		}
	};
	const backend: StorageBackend = {
		get: async (keys) => {
			guard();
			if (keys === null) return Object.fromEntries(data);
			const list = Array.isArray(keys) ? keys : [keys];
			const out: Record<string, unknown> = {};
			for (const k of list) if (data.has(k)) out[k] = data.get(k);
			return out;
		},
		set: async (items) => {
			guard();
			for (const [k, v] of Object.entries(items)) data.set(k, v);
		},
		remove: async (keys) => {
			guard();
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
		},
	};
	return { backend, data, state };
}

describe("storageAvailable", () => {
	beforeEach(() => setStorageBackend(null));
	afterEach(() => setStorageBackend(null));

	it("is false when no backend is installed (jsdom has no chrome)", () => {
		expect(storageAvailable()).toBe(false);
	});

	it("is true once a backend is injected", () => {
		setStorageBackend(fakeBackend().backend);
		expect(storageAvailable()).toBe(true);
	});
});

describe("read / write", () => {
	let f: ReturnType<typeof fakeBackend>;
	beforeEach(() => {
		f = fakeBackend();
		setStorageBackend(f.backend);
	});
	afterEach(() => setStorageBackend(null));

	it("round-trips a value under the exact key given", async () => {
		const ok = await storageSet("edge-ai-sidebar:folders", { n: 1 });
		expect(ok).toBe(true);
		expect(f.data.get("edge-ai-sidebar:folders")).toEqual({ n: 1 });
		expect(await storageGet("edge-ai-sidebar:folders")).toEqual({ n: 1 });
	});

	it("returns undefined for a key that was never written", async () => {
		expect(await storageGet("nope")).toBeUndefined();
	});

	it("returns {} from getAll when nothing is stored", async () => {
		expect(await storageGetAll()).toEqual({});
	});

	it("getAll sees every key, for the migration path", async () => {
		await storageSet("historyTitle_abc", "旧标题");
		await storageSet("historyTitle_def", "另一个");
		await storageSet("edge-ai-sidebar:folders", {});
		const all = await storageGetAll();
		expect(Object.keys(all).sort()).toEqual([
			"edge-ai-sidebar:folders",
			"historyTitle_abc",
			"historyTitle_def",
		]);
	});

	it("remove deletes and reports success", async () => {
		await storageSet("a", 1);
		await storageSet("b", 2);
		expect(await storageRemove(["a", "b"])).toBe(true);
		expect(f.data.size).toBe(0);
	});
});

describe("per-call error handling (the contextValid regression)", () => {
	let f: ReturnType<typeof fakeBackend>;
	beforeEach(() => {
		f = fakeBackend();
		setStorageBackend(f.backend);
	});
	afterEach(() => setStorageBackend(null));

	it("a failed get does not disable the next get", async () => {
		f.state.failNext = true;
		expect(await storageGet("k")).toBeUndefined();
		// The old code would have flipped contextValid here and every later
		// call would silently no-op forever.
		await storageSet("k", "value");
		expect(await storageGet("k")).toBe("value");
	});

	it("a failed set returns false but the next set succeeds", async () => {
		f.state.failNext = true;
		expect(await storageSet("k", 1)).toBe(false);
		expect(await storageSet("k", 2)).toBe(true);
		expect(f.data.get("k")).toBe(2);
	});

	it("a failed getAll returns {} instead of throwing", async () => {
		f.state.failNext = true;
		await expect(storageGetAll()).resolves.toEqual({});
	});

	it("a failed remove returns false instead of throwing", async () => {
		f.state.failNext = true;
		await expect(storageRemove(["x"])).resolves.toBe(false);
	});

	it("never rejects, so callers cannot crash the content script", async () => {
		f.state.failNext = true;
		await expect(storageGet("k")).resolves.toBeUndefined();
	});

	it("writes still land when storage is unavailable", async () => {
		setStorageBackend(null);
		expect(await storageSet("k", 1)).toBe(false);
		expect(await storageGet("k")).toBeUndefined();
	});
});

describe("onStorageChanged", () => {
	let listeners: Array<(changes: unknown, area: string) => void>;
	let disposed: number;

	beforeEach(() => {
		listeners = [];
		disposed = 0;
		const backend = fakeBackend().backend;
		setStorageBackend(backend);
		vi.stubGlobal("chrome", {
			storage: {
				local: backend,
				onChanged: {
					addListener: (cb: (c: unknown, a: string) => void) => {
						listeners.push(cb);
					},
					removeListener: () => {
						disposed++;
					},
				},
			},
		});
	});

	afterEach(() => {
		vi.unstubAllGlobals();
		setStorageBackend(null);
	});

	it("fires only for the watched key", () => {
		const seen: unknown[] = [];
		onStorageChanged("watched", (v) => seen.push(v));
		for (const cb of listeners)
			cb({ other: { newValue: 1 }, watched: { newValue: 2 } }, "local");
		expect(seen).toEqual([{ newValue: 2 }]);
	});

	it("ignores changes from a different storage area", () => {
		const seen: unknown[] = [];
		onStorageChanged("watched", (v) => seen.push(v));
		for (const cb of listeners) cb({ watched: { newValue: 2 } }, "sync");
		expect(seen).toHaveLength(0);
	});

	it("returns a Disposer that removes the listener", () => {
		const dispose = onStorageChanged("watched", () => {});
		expect(listeners).toHaveLength(1);
		dispose();
		expect(disposed).toBe(1);
	});

	it("does not throw when chrome.storage.onChanged is absent", () => {
		vi.stubGlobal("chrome", { storage: { local: fakeBackend().backend } });
		expect(() => onStorageChanged("k", () => {})).not.toThrow();
	});
});
