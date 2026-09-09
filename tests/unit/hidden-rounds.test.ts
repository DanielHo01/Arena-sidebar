// src/rounds.ts — per-session persistence of hidden-round flags.
//
// Before this module grew a storage layer, ✕ was irreversible-but-forgotten:
// nothing was written, nothing could be unhidden, and because round ids are
// deterministic per session ("boot-3"), a flag set in one conversation leaked
// into the next one visited in the same tab. These tests pin the three halves
// of the fix: the key design (namespaced by the real session id), the
// load/persist lifecycle with its stale-load guard, and the cross-tab sync.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	applyHiddenRounds,
	hiddenRoundIds,
	hiddenRoundsKey,
	loadHiddenRounds,
	persistHiddenRounds,
	resetHiddenRounds,
	setupHiddenRoundsSync,
} from "../../src/rounds";
import { setStorageBackend } from "../../src/platform/storage";

/** Minimal in-memory StorageBackend recording writes in `data`. */
function memoryBackend() {
	const data = new Map<string, unknown>();
	return {
		data,
		backend: {
			get: async (keys: string | string[] | null) => {
				if (keys === null) return Object.fromEntries(data);
				const list = Array.isArray(keys) ? keys : [keys];
				return Object.fromEntries(
					list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]),
				);
			},
			set: async (items: Record<string, unknown>) => {
				for (const [k, v] of Object.entries(items)) data.set(k, v);
			},
			remove: async (keys: string | string[]) => {
				for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
			},
		},
	};
}

/**
 * Stub chrome.storage.onChanged — onStorageChanged reads chrome directly (the
 * test backend only covers get/set), so the sync path needs a global stub.
 */
function stubChromeOnChanged() {
	type Listener = (
		changes: Record<string, { oldValue?: unknown; newValue?: unknown }>,
		area: string,
	) => void;
	const listeners: Listener[] = [];
	vi.stubGlobal("chrome", {
		storage: {
			onChanged: {
				addListener: (l: Listener) => listeners.push(l),
				removeListener: (l: Listener) => {
					const i = listeners.indexOf(l);
					if (i >= 0) listeners.splice(i, 1);
				},
			},
		},
	});
	return {
		fire(key: string, newValue: unknown) {
			for (const l of [...listeners]) l({ [key]: { newValue } }, "local");
		},
		count: () => listeners.length,
	};
}

describe("hiddenRoundsKey", () => {
	it("namespaces the key by the real session id", () => {
		// This is the whole fix for the boot-3 collision: two sessions share
		// round ids but never storage keys.
		expect(hiddenRoundsKey("aaa")).toBe("edge-ai-sidebar:hidden-rounds:aaa");
		expect(hiddenRoundsKey("bbb")).toBe("edge-ai-sidebar:hidden-rounds:bbb");
	});
});

describe("loadHiddenRounds", () => {
	beforeEach(() => {
		setStorageBackend(memoryBackend().backend);
		resetHiddenRounds();
	});
	afterEach(() => setStorageBackend(null));

	it("adopts the session and fills the set from storage", async () => {
		const { data, backend } = memoryBackend();
		data.set(hiddenRoundsKey("s1"), ["r1", "r2"]);
		setStorageBackend(backend);

		await loadHiddenRounds("s1");

		expect([...hiddenRoundIds]).toEqual(["r1", "r2"]);
	});

	it("treats a missing key as no flags", async () => {
		await loadHiddenRounds("never-seen");
		expect(hiddenRoundIds.size).toBe(0);
	});

	it("ignores garbage instead of throwing", async () => {
		const { data, backend } = memoryBackend();
		// Storage is untyped (storageGet → unknown); a corrupted entry must
		// degrade to "no flags", never break the panel.
		data.set(hiddenRoundsKey("s1"), "not-an-array");
		data.set(hiddenRoundsKey("s2"), [42, "ok", null]);
		setStorageBackend(backend);

		await loadHiddenRounds("s1");
		expect(hiddenRoundIds.size).toBe(0);

		await loadHiddenRounds("s2");
		expect([...hiddenRoundIds]).toEqual(["ok"]);
	});

	it("means 'no flags' for an empty session id (direct chat)", async () => {
		hiddenRoundIds.add("stale");
		await loadHiddenRounds("");
		expect(hiddenRoundIds.size).toBe(0);
	});

	it("drops a result that a newer load superseded (stale guard)", async () => {
		// Two reads in flight; the one for the session the user just LEFT
		// resolves last. Without the guard it would win and the panel would
		// show the old conversation's hidden rounds.
		const { data, backend } = memoryBackend();
		data.set(hiddenRoundsKey("aaa"), ["from-aaa"]);
		data.set(hiddenRoundsKey("bbb"), ["from-bbb"]);
		let releaseA!: (v: unknown) => void;
		const gateA = new Promise((resolve) => {
			releaseA = resolve;
		});
		const slowBackend = {
			...backend,
			get: async (keys: string | string[] | null) => {
				if (keys === hiddenRoundsKey("aaa")) await gateA;
				return backend.get(keys);
			},
		};
		setStorageBackend(slowBackend);

		const loadA = loadHiddenRounds("aaa");
		const loadB = loadHiddenRounds("bbb");
		await loadB;
		expect([...hiddenRoundIds]).toEqual(["from-bbb"]);

		releaseA(undefined);
		await loadA;
		expect([...hiddenRoundIds]).toEqual(["from-bbb"]); // aaa's late result dropped
	});

	it("drops a result that a reset superseded", async () => {
		const { data, backend } = memoryBackend();
		data.set(hiddenRoundsKey("aaa"), ["from-aaa"]);
		let release!: (v: unknown) => void;
		const gate = new Promise((resolve) => {
			release = resolve;
		});
		setStorageBackend({
			...backend,
			get: async (keys: string | string[] | null) => {
				await gate;
				return backend.get(keys);
			},
		});

		const loadA = loadHiddenRounds("aaa");
		resetHiddenRounds(); // route change cleared everything mid-read
		release(undefined);
		await loadA;

		expect(hiddenRoundIds.size).toBe(0);
	});
});

describe("persistHiddenRounds", () => {
	beforeEach(() => {
		setStorageBackend(memoryBackend().backend);
		resetHiddenRounds();
	});
	afterEach(() => setStorageBackend(null));

	it("writes the live flags under the adopted session's key", async () => {
		const { data, backend } = memoryBackend();
		setStorageBackend(backend);
		await loadHiddenRounds("s1");

		hiddenRoundIds.add("r1");
		hiddenRoundIds.add("r2");
		persistHiddenRounds();
		// storageSet is fire-and-forget; flush the microtask queue.
		await Promise.resolve();

		expect(data.get(hiddenRoundsKey("s1"))).toEqual(["r1", "r2"]);
	});

	it("is a no-op until a session is adopted", async () => {
		const { data, backend } = memoryBackend();
		setStorageBackend(backend);

		hiddenRoundIds.add("r1");
		persistHiddenRounds();
		await Promise.resolve();

		expect(data.size).toBe(0);
	});

	it("stops writing after resetHiddenRounds disarms the session", async () => {
		const { data, backend } = memoryBackend();
		setStorageBackend(backend);
		await loadHiddenRounds("s1");
		resetHiddenRounds();

		hiddenRoundIds.add("r1");
		persistHiddenRounds();
		await Promise.resolve();

		expect(data.size).toBe(0);
	});
});

describe("applyHiddenRounds", () => {
	beforeEach(() => resetHiddenRounds());

	it("replaces the live set wholesale", () => {
		hiddenRoundIds.add("old");
		applyHiddenRounds(["a", "b"]);
		expect([...hiddenRoundIds]).toEqual(["a", "b"]);
	});

	it("clears on a non-array value", () => {
		hiddenRoundIds.add("old");
		applyHiddenRounds(undefined);
		expect(hiddenRoundIds.size).toBe(0);
	});
});

describe("setupHiddenRoundsSync", () => {
	beforeEach(() => {
		resetHiddenRounds();
		setStorageBackend(null);
	});
	afterEach(() => {
		vi.unstubAllGlobals();
		setStorageBackend(null);
	});

	it("applies another tab's write and notifies", () => {
		const chrome = stubChromeOnChanged();
		hiddenRoundIds.add("r1");
		const onChange = vi.fn();

		const dispose = setupHiddenRoundsSync("s1", onChange);
		expect(chrome.count()).toBe(1);

		chrome.fire(hiddenRoundsKey("s1"), ["r1", "r2"]);

		expect([...hiddenRoundIds]).toEqual(["r1", "r2"]);
		expect(onChange).toHaveBeenCalledTimes(1);
		dispose();
	});

	it("skips the echo of its own write when nothing else changed", () => {
		const chrome = stubChromeOnChanged();
		hiddenRoundIds.add("r1");
		const onChange = vi.fn();
		setupHiddenRoundsSync("s1", onChange);

		// This is exactly what our own persistHiddenRounds() wrote.
		chrome.fire(hiddenRoundsKey("s1"), ["r1"]);

		expect([...hiddenRoundIds]).toEqual(["r1"]);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("ignores writes to other sessions' keys", () => {
		const chrome = stubChromeOnChanged();
		const onChange = vi.fn();
		setupHiddenRoundsSync("s1", onChange);

		chrome.fire(hiddenRoundsKey("s2"), ["other-session"]);

		expect(hiddenRoundIds.size).toBe(0);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("unsubscribes on dispose", () => {
		const chrome = stubChromeOnChanged();
		const onChange = vi.fn();
		const dispose = setupHiddenRoundsSync("s1", onChange);
		dispose();

		expect(chrome.count()).toBe(0);
		chrome.fire(hiddenRoundsKey("s1"), ["r9"]);
		expect(hiddenRoundIds.size).toBe(0);
		expect(onChange).not.toHaveBeenCalled();
	});

	it("survives an absent chrome global (returns a no-op disposer)", () => {
		// jsdom and the test backend have no chrome.storage.onChanged; the
		// subscription must degrade to a no-op, not throw.
		expect(() => setupHiddenRoundsSync("s1", vi.fn())).not.toThrow();
	});
});
