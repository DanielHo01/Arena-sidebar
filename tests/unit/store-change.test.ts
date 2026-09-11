// The store's change subscription — the seam that breaks the layer inversion.
//
// Before this, conversationStore.ts (data) imported folders.ts (760 lines of
// CRUD + Arena DOM injection + context menu + inline CSS) purely to call
// upsertSessionMetaFromStore() after a successful write. The data layer knew
// about the UI injection layer.
//
// The store now emits a snapshot; folders subscribes. These tests pin the
// contract: what is emitted, when, and that a bad listener cannot take the
// store down with it.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	conversationStore,
	onStoreChange,
	type StoreSnapshot,
} from "../../src/conversationStore";
import {
	setStorageBackend,
	type StorageBackend,
} from "../../src/platform/storage";
import type { SidebarMessage } from "../../src/types";

function workingBackend(): StorageBackend {
	const data = new Map<string, unknown>();
	return {
		get: async (keys) => {
			if (keys === null) return Object.fromEntries(data);
			const list = Array.isArray(keys) ? keys : [keys];
			const out: Record<string, unknown> = {};
			for (const k of list) if (data.has(k)) out[k] = data.get(k);
			return out;
		},
		set: async (items) => {
			for (const [k, v] of Object.entries(items)) data.set(k, v);
		},
		remove: async (keys) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
		},
	};
}

function failingBackend(): StorageBackend {
	return {
		get: async () => ({}),
		set: async () => {
			throw new Error("quota");
		},
		remove: async () => {},
	};
}

function msg(role: "user" | "assistant", content: string): SidebarMessage {
	return {
		id: role + "-" + content,
		role,
		content,
		fingerprint: "",
		domId: "",
		origin: "dom",
	} as SidebarMessage;
}

function seed(n = 2) {
	conversationStore.sessionId = "sess-emit";
	conversationStore.messages = [msg("user", "q"), msg("assistant", "a")].slice(
		0,
		n,
	);
	conversationStore.rounds = [
		{ id: "r0", index: 0, title: "Round 1" } as never,
	];
}

const disposers: Array<() => void> = [];
function subscribe(fn: (s: StoreSnapshot) => void) {
	disposers.push(onStoreChange(fn));
}

beforeEach(() => {
	conversationStore.reset();
	conversationStore.sessionId = "";
	setStorageBackend(workingBackend());
});

afterEach(() => {
	while (disposers.length) disposers.pop()!();
	setStorageBackend(null);
	conversationStore.reset();
});

describe("onStoreChange", () => {
	it("fires with a snapshot after a successful save", async () => {
		seed();
		const seen: StoreSnapshot[] = [];
		subscribe((s) => seen.push(s));
		await conversationStore.saveToStorage();
		expect(seen).toHaveLength(1);
	});

	it("snapshot carries sessionId and the counts the folder index needs", async () => {
		seed();
		let snap: StoreSnapshot | null = null;
		subscribe((s) => (snap = s));
		await conversationStore.saveToStorage();
		expect(snap!.sessionId).toBe("sess-emit");
		expect(snap!.messageCount).toBe(2);
		expect(snap!.roundCount).toBe(1);
	});

	it("exposes the first round title so the subscriber can build a fallback title", async () => {
		seed();
		let snap: StoreSnapshot | null = null;
		subscribe((s) => (snap = s));
		await conversationStore.saveToStorage();
		expect(snap!.firstRoundTitle).toBe("Round 1");
	});

	it("does not fire when there is nothing to save", async () => {
		const seen: StoreSnapshot[] = [];
		subscribe((s) => seen.push(s));
		await conversationStore.saveToStorage();
		expect(seen).toHaveLength(0);
	});

	it("does not fire when the write fails", async () => {
		setStorageBackend(failingBackend());
		seed();
		const seen: StoreSnapshot[] = [];
		subscribe((s) => seen.push(s));
		await conversationStore.saveToStorage();
		expect(seen).toHaveLength(0);
	});

	it("delivers to every subscriber", async () => {
		seed();
		let a = 0;
		let b = 0;
		subscribe(() => a++);
		subscribe(() => b++);
		await conversationStore.saveToStorage();
		expect([a, b]).toEqual([1, 1]);
	});

	it("stops delivering after the Disposer runs", async () => {
		seed();
		let n = 0;
		const dispose = onStoreChange(() => n++);
		await conversationStore.saveToStorage();
		dispose();
		await conversationStore.saveToStorage();
		expect(n).toBe(1);
	});

	it("a throwing listener does not stop the others", async () => {
		seed();
		let reached = 0;
		subscribe(() => {
			throw new Error("listener blew up");
		});
		subscribe(() => reached++);
		await conversationStore.saveToStorage();
		expect(reached).toBe(1);
	});

	it("a throwing listener does not make saveToStorage reject", async () => {
		seed();
		subscribe(() => {
			throw new Error("listener blew up");
		});
		// Resolves true: the write landed, and the throwing listener neither
		// rejected the save nor starved the others.
		await expect(conversationStore.saveToStorage()).resolves.toBe(true);
	});
});
