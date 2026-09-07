// Phase 1 bug fix: the dedup fingerprint was content-only
// ("fp-" + length + "-" + first 80 chars), so a user who genuinely sent the
// same short message twice had those turns collapsed into one.
//
// Measured before the fix, through the real refreshStore + computeRounds:
//   input  6 messages (3x "继续" + 3 distinct replies)
//   -> store.messages.length = 4   (expected 6)
//   -> computeRounds().length = 1  (expected 3)
//
// Cross-source dedup must still work: DOM and capture both observe the same
// message, and capture carries the fuller text, so they have to merge. The fix
// therefore disambiguates by *occurrence within the source stream* rather than
// by content alone.
import { beforeEach, describe, expect, it } from "vitest";
import {
	addCapturedMessage,
	conversationStore,
	refreshStore,
} from "../../src/conversationStore";
import { computeRounds } from "../../src/core/rounds";

beforeEach(() => {
	conversationStore.reset();
});

describe("repeated identical messages are preserved", () => {
	const threeContinues = [
		{ id: "a1", role: "user" as const, content: "继续" },
		{
			id: "b1",
			role: "assistant" as const,
			content: "第一段续写内容，这里是助手的回答 A。",
		},
		{ id: "a2", role: "user" as const, content: "继续" },
		{
			id: "b2",
			role: "assistant" as const,
			content: "第二段续写内容，这里是助手的回答 B。",
		},
		{ id: "a3", role: "user" as const, content: "继续" },
		{
			id: "b3",
			role: "assistant" as const,
			content: "第三段续写内容，这里是助手的回答 C。",
		},
	];

	it("one pass with 3 identical user turns keeps all 6 messages", () => {
		refreshStore({ dom: threeContinues, bindAnchors: false });
		// Before the fix this was 4.
		expect(conversationStore.messages).toHaveLength(6);
	});

	it("and produces one round per user turn", () => {
		refreshStore({ dom: threeContinues, bindAnchors: false });
		// Before the fix this was 1.
		expect(computeRounds(conversationStore.messages)).toHaveLength(3);
	});

	it("re-extracting the same DOM does not duplicate them", () => {
		refreshStore({ dom: threeContinues, bindAnchors: false });
		refreshStore({ dom: threeContinues, bindAnchors: false });
		refreshStore({ dom: threeContinues, bindAnchors: false });
		expect(conversationStore.messages).toHaveLength(6);
	});
});

describe("cross-source dedup still merges", () => {
	it("same content across two separate passes -> 1 message (unchanged behaviour)", () => {
		refreshStore({ dom: [{ id: "m1", role: "user", content: "same text" }] });
		refreshStore({ dom: [{ id: "m2", role: "user", content: "same text" }] });
		expect(conversationStore.messages).toHaveLength(1);
	});

	it("a captured message merges into the matching DOM message", () => {
		refreshStore({
			dom: [
				{ id: "a1", role: "user", content: "继续" },
				{ id: "b1", role: "assistant", content: "回答 A" },
				{ id: "a2", role: "user", content: "继续" },
				{ id: "b2", role: "assistant", content: "回答 B" },
			],
			bindAnchors: false,
		});
		const before = conversationStore.messages.length;
		const added = addCapturedMessage({
			id: "cap",
			role: "user",
			content: "继续",
			capturedAt: 999,
			sessionId: "s",
		});
		expect(added).toBe(false); // merged, not new
		expect(conversationStore.messages).toHaveLength(before);
		expect(conversationStore.messages[0].origin).toBe("capture");
		expect(conversationStore.messages[0].capturedAt).toBe(999);
	});

	it("the second captured repeat merges into the second occurrence", () => {
		refreshStore({
			dom: [
				{ id: "a1", role: "user", content: "继续" },
				{ id: "a2", role: "user", content: "继续" },
			],
			bindAnchors: false,
		});
		addCapturedMessage({
			id: "cap1",
			role: "user",
			content: "继续",
			capturedAt: 1,
			sessionId: "s",
		});
		addCapturedMessage({
			id: "cap2",
			role: "user",
			content: "继续",
			capturedAt: 2,
			sessionId: "s",
		});
		expect(conversationStore.messages).toHaveLength(2);
		expect(conversationStore.messages[0].capturedAt).toBe(1);
		expect(conversationStore.messages[1].capturedAt).toBe(2);
	});
});
