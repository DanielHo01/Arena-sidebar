// core/serialize.ts — the export/summary text builders.
//
// These were closures inside exportConversation() in ui/modals.ts, interleaved
// with DOM dialog code, so they could not be tested at all. They are now pure
// functions of (messages, captured rounds, a model-name resolver).
import { describe, expect, it } from "vitest";
import {
	buildExportRounds,
	buildJson,
	buildMarkdown,
	buildSummaryPrompt,
	indexCapturedByUser,
	type SerializeInput,
} from "../../src/core/serialize";
import type { CapturedRound, SidebarMessage } from "../../src/types";

function msg(
	role: "user" | "assistant",
	content: string,
	id = "",
): SidebarMessage {
	return {
		id: id || role + "-" + content.slice(0, 8),
		role,
		content,
		fingerprint: "",
		domId: "",
		origin: "dom",
	} as SidebarMessage;
}

function input(over: Partial<SerializeInput> = {}): SerializeInput {
	return {
		sessionId: "sess-1",
		url: "https://arena.ai/c/sess-1",
		exportedAt: "2026-01-01T00:00:00.000Z",
		messages: [],
		captured: [],
		resolveModelName: () => "",
		...over,
	};
}

function cap(over: Partial<CapturedRound> = {}): CapturedRound {
	return {
		sessionId: "sess-1",
		request: {
			kind: "chat-request",
			url: "u",
			sessionId: "sess-1",
			mode: "direct",
			modality: "text",
			modelAId: "m-a",
			modelBId: "",
			userMessageId: "um-1",
			content: "问题",
			attachmentCount: 0,
			ts: 1,
		},
		response: {
			kind: "chat-response",
			aText: "captured A",
			aReasoning: "",
			aFinished: true,
			aError: "",
			bText: "",
			bReasoning: "",
			bFinished: false,
			bError: "",
			ts: 2,
		},
		completed: true,
		...over,
	};
}

describe("buildSummaryPrompt", () => {
	it("is empty when there are no user messages", () => {
		expect(
			buildSummaryPrompt(input({ messages: [msg("assistant", "hi")] })),
		).toBe("");
	});

	it("carries the instruction header and the output schema", () => {
		const t = buildSummaryPrompt(
			input({ messages: [msg("user", "问题一"), msg("assistant", "答案")] }),
		);
		expect(t).toContain("请用中文为以下对话的每一轮生成一个 JSON 总结");
		expect(t).toContain('"rounds"');
	});

	it("numbers each user turn as a round", () => {
		const t = buildSummaryPrompt(
			input({
				messages: [
					msg("user", "q1"),
					msg("assistant", "a1"),
					msg("user", "q2"),
					msg("assistant", "a2"),
				],
			}),
		);
		expect(t).toContain("=== Round 1 ===");
		expect(t).toContain("=== Round 2 ===");
		expect(t).toContain("[用户问题]: q1");
		expect(t).toContain("[回答 1]: a1");
	});

	it("emits assistant messages that precede the first user turn as lead context", () => {
		const t = buildSummaryPrompt(
			input({
				messages: [msg("assistant", "系统前言"), msg("user", "真正的问题")],
			}),
		);
		expect(t).toContain("=== 前置上下文 ===");
		expect(t).toContain("[前置助手消息]: 系统前言");
	});

	it("omits the lead-context section when there is none", () => {
		const t = buildSummaryPrompt(
			input({ messages: [msg("user", "q"), msg("assistant", "a")] }),
		);
		expect(t).not.toContain("=== 前置上下文 ===");
	});

	it("truncates a very long user message at 800 chars", () => {
		const t = buildSummaryPrompt(
			input({ messages: [msg("user", "x".repeat(2000))] }),
		);
		const line = t.split("\n").find((l) => l.startsWith("[用户问题]:"))!;
		expect(line.length).toBeLessThanOrEqual("[用户问题]: ".length + 800);
	});

	it("falls back to the captured round when the DOM has no assistant reply", () => {
		const t = buildSummaryPrompt(
			input({
				messages: [msg("user", "问题")],
				captured: [cap()],
				resolveModelName: (id) => (id === "m-a" ? "GPT-4o" : ""),
			}),
		);
		expect(t).toContain("[GPT-4o 回答]: captured A");
	});

	it("defaults the model labels when no name can be resolved", () => {
		const t = buildSummaryPrompt(
			input({ messages: [msg("user", "问题")], captured: [cap()] }),
		);
		expect(t).toContain("[助手 A 回答]: captured A");
	});

	it("includes model B when the captured request has one", () => {
		const c = cap();
		c.request.modelBId = "m-b";
		c.response.bText = "captured B";
		const t = buildSummaryPrompt(
			input({
				messages: [msg("user", "问题")],
				captured: [c],
				resolveModelName: () => "",
			}),
		);
		expect(t).toContain("[助手 B 回答]: captured B");
	});

	it("prefers the DOM assistant reply over the captured round", () => {
		const t = buildSummaryPrompt(
			input({
				messages: [msg("user", "问题"), msg("assistant", "dom answer")],
				captured: [cap()],
			}),
		);
		expect(t).toContain("[回答 1]: dom answer");
		expect(t).not.toContain("captured A");
	});
});

describe("indexCapturedByUser", () => {
	it("keys rounds by the first 200 chars of the request content", () => {
		const idx = indexCapturedByUser([cap()]);
		expect(idx.get("问题")).toBeDefined();
	});

	it("skips rounds whose request has no content", () => {
		const c = cap();
		c.request.content = "";
		expect(indexCapturedByUser([c]).size).toBe(0);
	});
});

describe("buildExportRounds", () => {
	it("pairs each user turn with the assistants that follow it", () => {
		const rounds = buildExportRounds(
			input({
				messages: [
					msg("user", "q1"),
					msg("assistant", "a1"),
					msg("assistant", "a1b"),
					msg("user", "q2"),
					msg("assistant", "a2"),
				],
			}),
		);
		expect(rounds).toHaveLength(2);
		expect(rounds[0].user).toBe("q1");
		expect(rounds[0].responses.map((r) => r.text)).toEqual(["a1", "a1b"]);
		expect(rounds[1].user).toBe("q2");
		expect(rounds[1].responses.map((r) => r.text)).toEqual(["a2"]);
	});

	it("numbers rounds from 1", () => {
		const rounds = buildExportRounds(
			input({ messages: [msg("user", "q1"), msg("user", "q2")] }),
		);
		expect(rounds.map((r) => r.round)).toEqual([1, 2]);
	});

	it("uses the captured response when the DOM has no assistant", () => {
		const rounds = buildExportRounds(
			input({
				messages: [msg("user", "问题")],
				captured: [cap()],
				resolveModelName: (id) => (id === "m-a" ? "GPT-4o" : ""),
			}),
		);
		expect(rounds[0].responses).toHaveLength(1);
		expect(rounds[0].responses[0].text).toBe("captured A");
		expect(rounds[0].responses[0].name).toBe("GPT-4o");
		expect(rounds[0].responses[0].model).toBe("A");
	});

	it("emits both models when the captured request has a B side", () => {
		const c = cap();
		c.request.modelBId = "m-b";
		const rounds = buildExportRounds(
			input({ messages: [msg("user", "问题")], captured: [c] }),
		);
		expect(rounds[0].responses.map((r) => r.model)).toEqual(["A", "B"]);
	});

	it("carries the captured sessionId and userMessageId", () => {
		const rounds = buildExportRounds(
			input({ messages: [msg("user", "问题")], captured: [cap()] }),
		);
		expect(rounds[0].sessionId).toBe("sess-1");
		expect(rounds[0].userMessageId).toBe("um-1");
	});
});

describe("buildJson / buildMarkdown", () => {
	it("buildJson carries session metadata", () => {
		const j = buildJson(
			input({ messages: [msg("user", "q"), msg("assistant", "a")] }),
		);
		expect(j.sessionId).toBe("sess-1");
		expect(j.url).toBe("https://arena.ai/c/sess-1");
		expect(j.exportedAt).toBe("2026-01-01T00:00:00.000Z");
		expect(j.rounds).toHaveLength(1);
	});

	it("buildMarkdown renders round headings and speaker labels", () => {
		const md = buildMarkdown(
			input({
				messages: [msg("user", "q1"), msg("assistant", "a1")],
				captured: [cap()],
				resolveModelName: () => "GPT-4o",
			}),
		);
		expect(md).toContain("## Round 1");
		expect(md).toContain("**User**: q1");
	});

	it("buildMarkdown falls back to a positional label without a model name", () => {
		const md = buildMarkdown(
			input({ messages: [msg("user", "问题")], captured: [cap()] }),
		);
		expect(md).toContain("**Response 1**");
	});

	it("separates rounds with a horizontal rule", () => {
		const md = buildMarkdown(
			input({
				messages: [
					msg("user", "q1"),
					msg("assistant", "a1"),
					msg("user", "q2"),
					msg("assistant", "a2"),
				],
			}),
		);
		expect(md).toContain("\n---\n");
	});

	it("is JSON-serialisable", () => {
		const j = buildJson(input({ messages: [msg("user", "q")] }));
		expect(() => JSON.stringify(j)).not.toThrow();
	});
});
