// Real-source test: conversationStore (canonical message store + rounds).
// Imports the ACTUAL production modules (conversationStore.ts, state.ts), unlike
// scripts/test-conversation-store.cjs which mirrored the logic with its own singleton.
//
// chrome.* is never invoked: saveToStorage/loadFromStorage guard on
// `typeof chrome === "undefined"`, so these modules are side-effect free on import.
//
// Migrated verbatim from scripts/test-src-store.ts (8 assertions).
import { beforeEach, describe, it, expect } from "vitest";
import {
	conversationStore,
	refreshStore,
	addCapturedMessage,
	bindDomAnchors,
	getMessagesForRound,
} from "../../src/conversationStore";
import { cachedElements } from "../../src/state";

// The store is a module-level singleton, so every test starts from empty.
// (The original script called reset() inline at the top of each test.)
beforeEach(() => {
	conversationStore.reset();
	cachedElements.clear();
});

describe("refreshStore", () => {
	it("dedup: same content added twice -> 1 message", () => {
		refreshStore({ dom: [{ id: "m1", role: "user", content: "same text" }] });
		refreshStore({ dom: [{ id: "m2", role: "user", content: "same text" }] });
		expect(conversationStore.messages).toHaveLength(1);
	});

	it("with empty opts -> no-op", () => {
		refreshStore({});
		expect(conversationStore.messages).toHaveLength(0);
		expect(conversationStore.rounds).toHaveLength(0);
	});
});

describe("addCapturedMessage", () => {
	it("capture origin upgrades a prior dom message of same content", () => {
		refreshStore({ dom: [{ id: "m1", role: "user", content: "hello world" }] });
		const added = addCapturedMessage({
			id: "cap",
			role: "user",
			content: "hello world",
			capturedAt: 123,
			sessionId: "s",
		});
		expect(added).toBe(false); // not new — merged into existing
		expect(conversationStore.messages).toHaveLength(1);
		expect(conversationStore.messages[0].origin).toBe("capture");
		expect(conversationStore.messages[0].capturedAt).toBe(123);
	});
});

describe("dom role normalisation", () => {
	it("system role normalized to assistant on dom insert", () => {
		refreshStore({ dom: [{ id: "m1", role: "system", content: "sys msg" }] });
		expect(conversationStore.messages[0].role).toBe("assistant");
	});
});

describe("getMessagesForRound", () => {
	it("returns user + its assistant replies", () => {
		refreshStore({
			dom: [
				{ id: "u1", role: "user", content: "q1" },
				{ id: "a1", role: "assistant", content: "r1" },
				{ id: "u2", role: "user", content: "q2" },
				{ id: "a2", role: "assistant", content: "r2" },
			],
			bindAnchors: false,
		});
		const msgs = getMessagesForRound("u1");
		expect(msgs).toHaveLength(2);
		expect(msgs.map((m) => m.id)).toEqual(["u1", "a1"]);
	});

	it("for last round reaches end of store", () => {
		refreshStore({
			dom: [
				{ id: "u1", role: "user", content: "q1" },
				{ id: "a1", role: "assistant", content: "r1" },
				{ id: "u2", role: "user", content: "q2" },
			],
			bindAnchors: false,
		});
		const msgs = getMessagesForRound("u2");
		expect(msgs).toHaveLength(1);
		expect(msgs.map((m) => m.id)).toEqual(["u2"]);
	});
});

describe("bindDomAnchors", () => {
	it("assigns domId from cachedElements by fingerprint", () => {
		// Fake DOM element — only the fields bindDomAnchors reads are needed.
		const fakeEl = { isConnected: true, textContent: "  hello   world  " };
		cachedElements.set("el-1", fakeEl as unknown as Element);
		refreshStore({
			dom: [{ id: "m1", role: "user", content: "hello world" }],
			bindAnchors: false,
		});
		bindDomAnchors();
		expect(conversationStore.messages[0].domId).toBe("el-1");
	});

	it("clears domIds whose element is disconnected", () => {
		const fakeEl = { isConnected: true, textContent: "abc def" };
		cachedElements.set("el-1", fakeEl as unknown as Element);
		refreshStore({
			dom: [{ id: "m1", role: "user", content: "abc def" }],
			bindAnchors: false,
		});
		bindDomAnchors();
		expect(conversationStore.messages[0].domId).toBe("el-1");

		// Simulate the element being recycled: swap the cache entry rather than
		// mutating it (isConnected is read-only on a real Element).
		cachedElements.set("el-1", {
			isConnected: false,
			textContent: "abc def",
		} as unknown as Element);
		bindDomAnchors();
		expect(conversationStore.messages[0].domId).toBeUndefined();
	});
});
