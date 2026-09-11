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
	dropTombstonedMessages,
	editMessageContent,
} from "../../src/conversationStore";
import { deleteRound, getMessagesForRound } from "../../src/features/roundNav";
import {
	deletedMessageKeys,
	resetDeletedMessages,
	tombstoneKey,
} from "../../src/rounds";
import { cachedElements, panel } from "../../src/state";
import { setStorageBackend } from "../../src/platform/storage";

// The store is a module-level singleton, so every test starts from empty.
// (The original script called reset() inline at the top of each test.)
beforeEach(() => {
	conversationStore.reset();
	cachedElements.clear();
	resetDeletedMessages();
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

describe("editMessageContent (#15)", () => {
	it("replaces content but keeps the original fingerprint", () => {
		refreshStore({
			dom: [
				{ id: "u1", role: "user", content: "orig question" },
				{ id: "a1", role: "assistant", content: "answer" },
			],
		});
		const before = conversationStore.messages[0].fingerprint;

		expect(editMessageContent("u1", "fixed question")).toBe(true);

		const msg = conversationStore.messages[0];
		expect(msg.content).toBe("fixed question");
		expect(msg.fingerprint).toBe(before);
		expect(msg.edited).toBe(true);
		expect(msg.editedFrom).toBe("orig question");
		expect(msg.editedAt).toEqual(expect.any(Number));
		// The round title follows the edited text.
		expect(conversationStore.rounds[0].title).toBe("fixed question");
	});

	it("rejects unknown ids, empty text, and no-op edits", () => {
		refreshStore({ dom: [{ id: "u1", role: "user", content: "hi" }] });
		expect(editMessageContent("nope", "x")).toBe(false);
		expect(editMessageContent("u1", "   ")).toBe(false);
		expect(editMessageContent("u1", "hi")).toBe(false);
		expect(conversationStore.messages[0].edited).toBeUndefined();
	});

	it("keeps the first original across repeated edits", () => {
		refreshStore({ dom: [{ id: "u1", role: "user", content: "v1" }] });
		editMessageContent("u1", "v2");
		editMessageContent("u1", "v3");
		expect(conversationStore.messages[0].content).toBe("v3");
		expect(conversationStore.messages[0].editedFrom).toBe("v1");
	});

	it("wins over a later DOM re-extract of the original", () => {
		refreshStore({ dom: [{ id: "u1", role: "user", content: "orig" }] });
		editMessageContent("u1", "fixed");
		// The page still holds the original; the next scan returns it with a
		// fresh random id, exactly like production re-extracts do.
		refreshStore({
			dom: [{ id: "msg-0-x7q2", role: "user", content: "orig" }],
		});
		expect(conversationStore.messages).toHaveLength(1);
		expect(conversationStore.messages[0].content).toBe("fixed");
	});

	it("invalidates the render fast path (ids don't move on edit)", () => {
		refreshStore({ dom: [{ id: "u1", role: "user", content: "hi" }] });
		panel.lastRenderKey = "junk";
		editMessageContent("u1", "hello");
		expect(panel.lastRenderKey).toBe("");
	});
});

describe("deleteRound (#15)", () => {
	function seedTwoRounds() {
		refreshStore({
			dom: [
				{ id: "u1", role: "user", content: "first" },
				{ id: "a1", role: "assistant", content: "answer one" },
				{ id: "u2", role: "user", content: "second" },
				{ id: "a2", role: "assistant", content: "answer two" },
			],
		});
	}

	it("drops the round's messages and tombstones their fingerprints", () => {
		seedTwoRounds();
		expect(deleteRound("u1")).toBe(true);
		expect(conversationStore.messages.map((m) => m.id)).toEqual(["u2", "a2"]);
		expect(conversationStore.rounds.map((r) => r.id)).toEqual(["u2"]);
		expect(deletedMessageKeys.size).toBe(2);
	});

	it("returns false for unknown or already-deleted rounds", () => {
		seedTwoRounds();
		expect(deleteRound("nope")).toBe(false);
		expect(deleteRound("u1")).toBe(true);
		expect(deleteRound("u1")).toBe(false);
	});

	it("stays deleted across a DOM re-extract of the same content", () => {
		seedTwoRounds();
		deleteRound("u1");
		// Production re-extracts mint fresh ids; only fingerprints match.
		refreshStore({
			dom: [
				{ id: "msg-0-aaa", role: "user", content: "first" },
				{ id: "msg-1-bbb", role: "assistant", content: "answer one" },
				{ id: "msg-2-ccc", role: "user", content: "second" },
				{ id: "msg-3-ddd", role: "assistant", content: "answer two" },
			],
		});
		expect(conversationStore.messages.map((m) => m.id)).toEqual(["u2", "a2"]);
		expect(conversationStore.rounds).toHaveLength(1);
	});

	it("tombstones one occurrence without touching its repeats", () => {
		refreshStore({
			dom: [
				{ id: "u1", role: "user", content: "again" },
				{ id: "u2", role: "user", content: "again" },
			],
		});
		// Two user turns, no assistants: two single-message rounds.
		expect(conversationStore.rounds).toHaveLength(2);
		deleteRound("u1");
		refreshStore({
			dom: [
				{ id: "x1", role: "user", content: "again" },
				{ id: "x2", role: "user", content: "again" },
			],
		});
		expect(conversationStore.messages).toHaveLength(1);
		expect(conversationStore.messages[0].id).toBe("u2");
	});
});

describe("dropTombstonedMessages (#15)", () => {
	it("drops live messages whose tombstones arrived from another tab", () => {
		refreshStore({
			dom: [
				{ id: "u1", role: "user", content: "first" },
				{ id: "a1", role: "assistant", content: "answer one" },
			],
		});
		const fp = conversationStore.messages[0].fingerprint!;
		deletedMessageKeys.add(tombstoneKey(fp, 0));

		expect(dropTombstonedMessages()).toBe(true);
		expect(conversationStore.messages.map((m) => m.id)).toEqual(["a1"]);
		// The round referenced the dropped user turn — recomputed, not stale.
		expect(conversationStore.rounds).toHaveLength(1);
		expect(conversationStore.rounds[0].id).toBe("a1");
	});

	it("returns false when nothing is tombstoned", () => {
		refreshStore({ dom: [{ id: "u1", role: "user", content: "hi" }] });
		expect(dropTombstonedMessages()).toBe(false);
	});

	it("loadFromStorage drops messages whose tombstones landed after the write", async () => {
		const data = new Map<string, unknown>();
		setStorageBackend({
			get: async (keys: string | string[] | null) => {
				const list =
					keys === null
						? [...data.keys()]
						: Array.isArray(keys)
							? keys
							: [keys];
				return Object.fromEntries(
					list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]),
				);
			},
			set: async (items: Record<string, unknown>) => {
				for (const [k, v] of Object.entries(items)) data.set(k, v);
			},
			remove: async () => {},
		});
		try {
			conversationStore.sessionId = "s1";
			refreshStore({
				dom: [
					{ id: "u1", role: "user", content: "first" },
					{ id: "a1", role: "assistant", content: "answer one" },
				],
			});
			await conversationStore.saveToStorage();
			// A delete whose session-save never landed (crash, or another
			// tab's 2s loop overwriting it): tombstone present, payload stale.
			const fp = conversationStore.messages[0].fingerprint!;
			deletedMessageKeys.add(tombstoneKey(fp, 0));
			conversationStore.reset();

			const restored = await conversationStore.loadFromStorage("s1");

			expect(restored).toEqual({ msgs: 1, rounds: 1 });
			expect(conversationStore.messages.map((m) => m.id)).toEqual(["a1"]);
		} finally {
			setStorageBackend(null);
			conversationStore.sessionId = "";
		}
	});
});

describe("saveToStorage persistence (#22/#23)", () => {
	function memBackend() {
		const data = new Map<string, unknown>();
		setStorageBackend({
			get: async (keys: string | string[] | null) => {
				const list =
					keys === null
						? [...data.keys()]
						: Array.isArray(keys)
							? keys
							: [keys];
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
		});
		return data;
	}

	it("resolves false without a session or messages", async () => {
		memBackend();
		try {
			conversationStore.sessionId = "";
			refreshStore({ dom: [{ id: "m1", role: "user", content: "x" }] });
			expect(await conversationStore.saveToStorage()).toBe(false);
			conversationStore.sessionId = "s1";
			conversationStore.reset();
			expect(await conversationStore.saveToStorage()).toBe(false);
		} finally {
			setStorageBackend(null);
			conversationStore.sessionId = "";
		}
	});

	it("resolves false when storage is unavailable", async () => {
		setStorageBackend(null);
		try {
			conversationStore.sessionId = "s1";
			refreshStore({ dom: [{ id: "m1", role: "user", content: "x" }] });
			expect(await conversationStore.saveToStorage()).toBe(false);
		} finally {
			conversationStore.sessionId = "";
		}
	});

	it("strips domId from the payload but keeps it live (#22 slimming)", async () => {
		const data = memBackend();
		try {
			conversationStore.sessionId = "s1";
			refreshStore({
				dom: [{ id: "m1", role: "user", content: "hello" }],
			});
			conversationStore.messages[0].domId = "ais-7";
			expect(await conversationStore.saveToStorage()).toBe(true);

			const payload = data.get("edge-ai-sidebar:session:s1") as {
				messages: Array<{ domId?: string; content: string }>;
				bytes: number;
			};
			expect(payload.messages[0].content).toBe("hello");
			expect("domId" in payload.messages[0]).toBe(false);
			// Recorded size feeds the byte-budget eviction; approximate
			// (self-size excluded) within a few chars.
			expect(typeof payload.bytes).toBe("number");
			expect(
				Math.abs(payload.bytes - JSON.stringify(payload).length),
			).toBeLessThan(32);
			// The live message is untouched — only the persisted copy slims.
			expect(conversationStore.messages[0].domId).toBe("ais-7");
		} finally {
			setStorageBackend(null);
			conversationStore.sessionId = "";
		}
	});

	it("a domId-less payload restores and rebinds", async () => {
		memBackend();
		try {
			conversationStore.sessionId = "s1";
			refreshStore({
				dom: [
					{ id: "u1", role: "user", content: "first" },
					{ id: "a1", role: "assistant", content: "answer one" },
				],
			});
			await conversationStore.saveToStorage();
			conversationStore.reset();
			const restored = await conversationStore.loadFromStorage("s1");
			expect(restored).toEqual({ msgs: 2, rounds: 1 });
		} finally {
			setStorageBackend(null);
			conversationStore.sessionId = "";
		}
	});
});
