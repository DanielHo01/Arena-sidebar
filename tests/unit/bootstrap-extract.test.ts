// Real-source test: features/bootstrapExtract.ts — parses Arena's __NEXT_DATA__
// transcript and inline script payloads.
//
// Split out of conversationStore.ts in Phase 5. It is a pure parser over the
// page's own markup, so every case here is a fixture built into jsdom — no
// chrome.* and no singletons.

import { afterEach, describe, it, expect } from "vitest";
import { extractBootstrapMessages } from "../../src/features/bootstrapExtract";
import { fingerprint } from "../../src/core/fingerprint";

function setNextData(payload: unknown): void {
	const el = document.createElement("script");
	el.id = "__NEXT_DATA__";
	el.type = "application/json";
	el.textContent =
		typeof payload === "string" ? payload : JSON.stringify(payload);
	document.body.appendChild(el);
}

/**
 * Same payload, but in a non-script element.
 *
 * extractBootstrapMessages has a second, independent recovery path that regexes
 * the text of every <script> tag — including __NEXT_DATA__ itself. Cases that
 * assert what the JSON walker accepted must use this holder so the script scan
 * contributes nothing and the assertion stays about findMessagesInObject alone.
 */
function setNextDataOnly(payload: unknown): void {
	const el = document.createElement("div");
	el.id = "__NEXT_DATA__";
	el.textContent = JSON.stringify(payload);
	document.body.appendChild(el);
}

function addInlineScript(text: string): void {
	const el = document.createElement("script");
	el.textContent = text;
	document.body.appendChild(el);
}

afterEach(() => {
	document.body.innerHTML = "";
});

describe("extractBootstrapMessages — __NEXT_DATA__", () => {
	it("returns nothing when the page carries no bootstrap data", () => {
		expect(extractBootstrapMessages()).toEqual([]);
	});

	it("finds messages nested inside the Next.js payload", () => {
		setNextData({
			props: {
				pageProps: {
					conversation: [
						{ role: "user", content: "hello there friend" },
						{ role: "assistant", content: "hi, how can I help you" },
					],
				},
			},
		});
		const msgs = extractBootstrapMessages();
		expect(msgs).toHaveLength(2);
		expect(msgs[0].role).toBe("user");
		expect(msgs[1].role).toBe("assistant");
		expect(msgs.every((m) => m.origin === "bootstrap")).toBe(true);
	});

	it("stamps every parsed message with a fingerprint", () => {
		setNextData({
			messages: [{ role: "user", content: "a question long enough" }],
		});
		const [m] = extractBootstrapMessages();
		expect(m.fingerprint).toBe(fingerprint("a question long enough"));
	});

	it("ignores objects that are not messages", () => {
		setNextDataOnly({
			props: {
				// No role → not a message, however long the content.
				meta: { content: "some page metadata that is not a message" },
				// Role but no content.
				other: { role: "user" },
				// Content too short.
				tiny: { role: "user", content: "hi" },
			},
		});
		expect(extractBootstrapMessages()).toEqual([]);
	});

	it("ignores an unknown role rather than guessing", () => {
		setNextDataOnly({
			messages: [{ role: "system", content: "a system prompt here" }],
		});
		expect(extractBootstrapMessages()).toEqual([]);
	});

	it("survives malformed JSON instead of throwing", () => {
		setNextData("{ this is not json ]");
		expect(extractBootstrapMessages()).toEqual([]);
	});

	it("caps absurdly long content at 10 000 characters", () => {
		setNextData({ messages: [{ role: "user", content: "x".repeat(12000) }] });
		expect(extractBootstrapMessages()[0].content).toHaveLength(10000);
	});

	it("stops descending past the depth limit", () => {
		// Nine levels of nesting — the guard is depth > 8.
		let deep: Record<string, unknown> = {
			role: "user",
			content: "buried far too deep to find",
		};
		for (let i = 0; i < 9; i++) deep = { next: deep };
		setNextDataOnly({ root: deep });
		expect(extractBootstrapMessages()).toEqual([]);
	});

	it("assigns each message a distinct id derived from its path", () => {
		setNextDataOnly({
			a: { messages: [{ role: "user", content: "first message here" }] },
			b: { messages: [{ role: "user", content: "second message here" }] },
		});
		const ids = extractBootstrapMessages().map((m) => m.id);
		expect(new Set(ids).size).toBe(ids.length);
	});
});

describe("extractBootstrapMessages — inline scripts", () => {
	it("recovers content from a script tag when there is no __NEXT_DATA__", () => {
		addInlineScript(
			'window.state = {"content": "a payload embedded in a script tag"};',
		);
		const msgs = extractBootstrapMessages();
		expect(msgs).toHaveLength(1);
		expect(msgs[0].content).toBe("a payload embedded in a script tag");
		expect(msgs[0].origin).toBe("bootstrap");
	});

	it("deduplicates repeated content by fingerprint", () => {
		const line = '"content": "the same text appears twice in the payload"';
		addInlineScript(`x = { ${line}, ${line} };`);
		expect(extractBootstrapMessages()).toHaveLength(1);
	});

	it("does not re-add content __NEXT_DATA__ already produced", () => {
		setNextData({
			messages: [
				{ role: "user", content: "duplicated across both sources here" },
			],
		});
		addInlineScript('"content": "duplicated across both sources here"');
		expect(extractBootstrapMessages()).toHaveLength(1);
	});

	it("skips content too short to be a real message", () => {
		addInlineScript('"content": "tiny"');
		expect(extractBootstrapMessages()).toEqual([]);
	});

	it("unescapes quotes and newlines in the captured content", () => {
		addInlineScript('"content": "line one\\nwith a \\"quoted\\" phrase"');
		expect(extractBootstrapMessages()[0].content).toBe(
			'line one\nwith a "quoted" phrase',
		);
	});

	it("ignores an empty script tag", () => {
		addInlineScript("");
		expect(extractBootstrapMessages()).toEqual([]);
	});
});

describe("detectRole heuristic (observed through the script path)", () => {
	it("reads short content as a user turn", () => {
		addInlineScript('"content": "please explain recursion briefly"');
		expect(extractBootstrapMessages()[0].role).toBe("user");
	});

	it("reads a long question as a user turn", () => {
		addInlineScript(
			'"content": "' +
				"Is this correct? Does it hold? What about the edge case? And what happens here?".padEnd(
					260,
					" filler text to push it past the length threshold.",
				) +
				'"',
		);
		expect(extractBootstrapMessages()[0].role).toBe("user");
	});

	it("reads a long declarative passage as an assistant turn", () => {
		addInlineScript(
			'"content": "' +
				"Here is the explanation you asked for, laid out step by step so it is easy to follow.".padEnd(
					300,
					" Each sentence states a fact rather than asking anything.",
				) +
				'"',
		);
		expect(extractBootstrapMessages()[0].role).toBe("assistant");
	});
});
