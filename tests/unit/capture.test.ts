// Real-source tests for network capture.
//
// capture.ts had 0% coverage: it reads what public/inject-hook.js writes into
// document.documentElement.dataset from the MAIN world, then turns completed
// request/response pairs into canonical messages. None of that was verified.
//
// NOTE: lastRequestTs / lastResponseTs are module-level and not resettable --
// one of the 8 residual states folded into Phase 4. Until then every test here
// uses a fresh increasing timestamp, because a repeated ts is treated as "same
// event, already seen" and skipped. That workaround is itself the evidence for
// why Phase 4 needs AppStore.reset().
import { beforeEach, describe, expect, it } from "vitest";
import {
	chatRounds,
	harvestModelNames,
	lookupModelName,
	modelNameById,
	pollCaptures,
} from "../../src/capture";
import { conversationStore } from "../../src/conversationStore";
import type { ChatRequest, ChatResponse } from "../../src/types";

let clock = 1_000;
function nextTs(): number {
	return ++clock;
}

function request(over: Partial<ChatRequest> = {}): ChatRequest {
	return {
		kind: "chat-request",
		url: "https://arena.ai/api/chat",
		sessionId: "sess-1",
		mode: "direct",
		modality: "text",
		modelAId: "model-a",
		modelBId: "",
		userMessageId: "umsg-1",
		content: "What is a transformer?",
		attachmentCount: 0,
		ts: nextTs(),
		...over,
	};
}

function response(over: Partial<ChatResponse> = {}): ChatResponse {
	return {
		kind: "chat-response",
		aText: "A transformer is a neural network architecture.",
		aReasoning: "",
		aFinished: true,
		aError: "",
		bText: "",
		bReasoning: "",
		bFinished: false,
		bError: "",
		ts: nextTs(),
		...over,
	};
}

function setDatasets(req?: ChatRequest, resp?: ChatResponse) {
	const d = document.documentElement.dataset;
	if (req) d.aiSideRequest = JSON.stringify(req);
	else delete d.aiSideRequest;
	if (resp) d.aiSideResponse = JSON.stringify(resp);
	else delete d.aiSideResponse;
}

beforeEach(() => {
	conversationStore.reset();
	chatRounds.clear();
	modelNameById.clear();
	setDatasets();
});

describe("pollCaptures: request/response pairing", () => {
	it("records a completed round and flushes it into the store", () => {
		const req = request();
		setDatasets(req);
		pollCaptures();

		setDatasets(req, response({ aFinished: true }));
		pollCaptures();

		const round = chatRounds.get("sess-1");
		expect(round).toBeDefined();
		expect(round!.completed).toBe(true);

		const roles = conversationStore.messages.map((m) => m.role);
		expect(roles).toEqual(["user", "assistant"]);
		expect(conversationStore.messages[0].origin).toBe("capture");
		expect(conversationStore.messages[0].content).toBe(
			"What is a transformer?",
		);
	});

	it("does not flush while the response is still streaming", () => {
		const req = request({ sessionId: "sess-stream" });
		setDatasets(req);
		pollCaptures();

		setDatasets(req, response({ aFinished: false }));
		pollCaptures();

		expect(chatRounds.get("sess-stream")!.completed).toBe(false);
		expect(conversationStore.messages).toHaveLength(0);
	});

	it("treats an error as terminal", () => {
		const req = request({ sessionId: "sess-err" });
		setDatasets(req);
		pollCaptures();

		setDatasets(req, response({ aFinished: false, aError: "rate limited" }));
		pollCaptures();

		expect(chatRounds.get("sess-err")!.completed).toBe(true);
	});

	it("captures both models when the response has a B side", () => {
		const req = request({ sessionId: "sess-2", modelBId: "model-b" });
		setDatasets(req);
		pollCaptures();

		setDatasets(
			req,
			response({
				aFinished: true,
				bFinished: true,
				bText: "Model B's competing answer.",
			}),
		);
		pollCaptures();

		const assistants = conversationStore.messages.filter(
			(m) => m.role === "assistant",
		);
		expect(assistants).toHaveLength(2);
	});

	it("ignores malformed dataset JSON instead of throwing", () => {
		document.documentElement.dataset.aiSideRequest = "{not json";
		document.documentElement.dataset.aiSideResponse = "{not json";
		expect(() => pollCaptures()).not.toThrow();
		expect(chatRounds.size).toBe(0);
	});

	it("ignores a response with no pending request", () => {
		setDatasets(undefined, response());
		pollCaptures();
		expect(chatRounds.size).toBe(0);
		expect(conversationStore.messages).toHaveLength(0);
	});
});

describe("model name harvesting", () => {
	it("reads publicName/id pairs out of inline script text", () => {
		document.body.innerHTML = `<script>
			var x = {"publicName":"GPT-4o","id":"m-gpt4o","other":1};
		</script>`;
		harvestModelNames();
		// Assert on the map, not the return value: harvestModelNames() only counts
		// names found via the initialModels path, not the publicName/id regex
		// path, so it under-reports. Nothing consumes the return value, so this
		// is a misleading API rather than a live bug -- but do not "fix" a test
		// by asserting on it.
		expect(modelNameById.get("m-gpt4o")).toBe("GPT-4o");
	});

	it("lookupModelName returns the harvested name", () => {
		modelNameById.set("m-1", "Claude");
		expect(lookupModelName("m-1")).toBe("Claude");
	});

	it("lookupModelName returns empty for an unknown or empty id", () => {
		expect(lookupModelName("")).toBe("");
		expect(lookupModelName("never-seen")).toBe("");
	});

	it("repeated harvesting does not duplicate or overwrite entries", () => {
		document.body.innerHTML = `<script>{"publicName":"X","id":"m-x"}</script>`;
		harvestModelNames();
		expect(modelNameById.get("m-x")).toBe("X");
		harvestModelNames();
		expect(modelNameById.size).toBe(1);
		expect(modelNameById.get("m-x")).toBe("X");
	});
});
