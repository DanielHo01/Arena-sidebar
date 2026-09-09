// The export and summary modals.
//
// ui/modals.ts was at 0% coverage. It is the only place the extension produces
// user-visible text, and three of its behaviours are invisible until they break:
// the download helper hands a Blob to a synthesized anchor click, pasteIntoChat
// has to drive Arena's React-controlled textarea through the prototype setter
// (a plain .value assignment is ignored), and openInNewChat re-checks the origin
// before calling window.open.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
	exportConversation,
	showExportModal,
	showSummaryModal,
	summarizeRounds,
} from "../../src/ui/modals";
import { chatRounds } from "../../src/capture";
import { setClipboardBackend } from "../../src/platform/clipboard";
import type { CapturedRound, SidebarMessage } from "../../src/types";

// jsdom implements none of these three; the code under test calls all of them.
let objectUrls: string[];
let revokedUrls: string[];
let rafCallbacks: Array<() => void>;

function stubBrowserApis(): void {
	objectUrls = [];
	revokedUrls = [];
	rafCallbacks = [];
	URL.createObjectURL = (() => {
		const u = "blob:fake-" + objectUrls.length;
		objectUrls.push(u);
		return u;
	}) as typeof URL.createObjectURL;
	URL.revokeObjectURL = ((u: string) => {
		revokedUrls.push(u);
	}) as typeof URL.revokeObjectURL;
	globalThis.requestAnimationFrame = ((cb: () => void) => {
		rafCallbacks.push(cb);
		return rafCallbacks.length;
	}) as typeof requestAnimationFrame;
}

function makeShadow(): ShadowRoot {
	const host = document.createElement("div");
	document.body.appendChild(host);
	return host.attachShadow({ mode: "open" });
}

function msg(
	id: string,
	role: "user" | "assistant",
	content: string,
): SidebarMessage {
	return { id, role, content };
}

/** A captured round whose request content matches `content`, so the indexer pairs it. */
function captured(content: string): CapturedRound {
	return {
		sessionId: "sid-1",
		completed: true,
		request: {
			kind: "chat-request",
			url: "https://arena.ai/api/chat",
			sessionId: "sid-1",
			mode: "direct",
			modality: "text",
			modelAId: "model-a",
			modelBId: "model-b",
			userMessageId: "u1",
			content,
			attachmentCount: 0,
		} as CapturedRound["request"],
		response: {
			kind: "chat-response",
			aText: "answer A",
			aReasoning: "",
			aFinished: true,
			aError: "",
			bText: "answer B",
			bReasoning: "",
			bFinished: true,
			bError: "",
			ts: 1,
		} as CapturedRound["response"],
	};
}

function buttons(shadow: ShadowRoot): HTMLButtonElement[] {
	return [
		...shadow.querySelectorAll<HTMLButtonElement>(".summary-actions button"),
	];
}

function byLabel(shadow: ShadowRoot, label: string): HTMLButtonElement {
	const found = buttons(shadow).find((b) => b.textContent === label);
	if (!found) throw new Error("no button labelled " + label);
	return found;
}

describe("modals", () => {
	let shadow: ShadowRoot;
	let copied: string[];

	beforeEach(() => {
		document.body.innerHTML = "";
		chatRounds.clear();
		copied = [];
		// ClipboardBackend.writeText resolves void; copyText is what turns a
		// successful write into a boolean.
		setClipboardBackend({
			writeText: async (t: string) => {
				copied.push(t);
			},
		});
		stubBrowserApis();
		shadow = makeShadow();
	});

	afterEach(() => {
		setClipboardBackend(null);
		chatRounds.clear();
	});

	describe("showExportModal", () => {
		it("builds a modal titled with the short session id", () => {
			showExportModal(shadow, '{"a":1}', "# md", "abcdefgh12345678");

			expect(shadow.querySelector(".summary-title")!.textContent).toBe(
				"📤 Export conversation — abcdefgh…",
			);
		});

		it("says so when there is no session", () => {
			showExportModal(shadow, "{}", "", "");

			expect(shadow.querySelector(".summary-title")!.textContent).toBe(
				"📤 Export conversation — no session",
			);
		});

		it("puts the JSON in a read-only textarea", () => {
			showExportModal(shadow, '{"a":1}', "# md", "sid");

			const ta = shadow.querySelector<HTMLTextAreaElement>(".summary-text")!;
			expect(ta.value).toBe('{"a":1}');
			expect(ta.readOnly).toBe(true);
		});

		it("replaces an existing modal instead of stacking", () => {
			showExportModal(shadow, "{}", "", "sid");
			showExportModal(shadow, "{}", "", "sid");

			expect(shadow.querySelectorAll(".summary-modal")).toHaveLength(1);
		});

		it("offers six actions", () => {
			showExportModal(shadow, "{}", "", "sid");

			expect(buttons(shadow).map((b) => b.textContent)).toEqual([
				"📋 Copy JSON",
				"📋 Copy Markdown",
				"🔗 Copy link",
				"💾 Download JSON",
				"💾 Download .md",
				"✕ Close",
			]);
		});

		it("copies the JSON and the Markdown separately", () => {
			showExportModal(shadow, '{"a":1}', "# md", "sid");

			byLabel(shadow, "📋 Copy JSON").click();
			byLabel(shadow, "📋 Copy Markdown").click();

			expect(copied).toEqual(['{"a":1}', "# md"]);
		});

		it("copies the current link", () => {
			showExportModal(shadow, "{}", "", "sid");

			byLabel(shadow, "🔗 Copy link").click();

			expect(copied).toEqual([location.href]);
		});

		it("downloads the JSON under a session-scoped filename", () => {
			const click = vi
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(() => {});
			showExportModal(shadow, '{"a":1}', "# md", "mysession");

			byLabel(shadow, "💾 Download JSON").click();

			const anchor = click.mock.instances[0] as HTMLAnchorElement;
			expect(anchor.download).toBe("arena-mysession.json");
			expect(anchor.href).toContain("blob:fake-0");
			// The object URL is released, or the blob leaks for the page's lifetime.
			expect(revokedUrls).toEqual(["blob:fake-0"]);
			click.mockRestore();
		});

		it("falls back to a generic filename with no session", () => {
			const click = vi
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(() => {});
			showExportModal(shadow, "{}", "# md", "");

			byLabel(shadow, "💾 Download .md").click();

			expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
				"arena-chat.md",
			);
			click.mockRestore();
		});

		it("closes on the Close button", () => {
			showExportModal(shadow, "{}", "", "sid");

			byLabel(shadow, "✕ Close").click();

			expect(shadow.querySelector(".summary-modal")).toBeNull();
		});

		it("closes on a backdrop click but not on a click inside the box", () => {
			showExportModal(shadow, "{}", "", "sid");
			const modal = shadow.querySelector<HTMLElement>(".summary-modal")!;

			modal.querySelector<HTMLElement>(".summary-box")!.click();
			expect(shadow.querySelector(".summary-modal")).not.toBeNull();

			modal.click();
			expect(shadow.querySelector(".summary-modal")).toBeNull();
		});
	});

	describe("showSummaryModal", () => {
		it("counts rounds and characters in the title", () => {
			const prompt = "=== Round 1 ===\nhi\n=== Round 2 ===\nbye";

			showSummaryModal(shadow, prompt);

			expect(shadow.querySelector(".summary-title")!.textContent).toBe(
				"✨ Summary prompt — 2 rounds · " + prompt.length + " chars",
			);
		});

		it("reports zero rounds for a prompt with no round markers", () => {
			showSummaryModal(shadow, "no markers here");

			expect(shadow.querySelector(".summary-title")!.textContent).toContain(
				"0 rounds",
			);
		});

		it("replaces an existing modal instead of stacking", () => {
			showSummaryModal(shadow, "one");
			showSummaryModal(shadow, "two");

			expect(shadow.querySelectorAll(".summary-modal")).toHaveLength(1);
			expect(
				shadow.querySelector<HTMLTextAreaElement>(".summary-text")!.value,
			).toBe("two");
		});

		it("resets the textarea scroll on the next frame", () => {
			showSummaryModal(shadow, "text");
			const ta = shadow.querySelector<HTMLTextAreaElement>(".summary-text")!;
			ta.scrollTop = 400;

			expect(rafCallbacks).toHaveLength(1);
			rafCallbacks[0]!();

			expect(ta.scrollTop).toBe(0);
		});

		it("closes on a backdrop click", () => {
			showSummaryModal(shadow, "text");

			shadow.querySelector<HTMLElement>(".summary-modal")!.click();

			expect(shadow.querySelector(".summary-modal")).toBeNull();
		});

		it("copies the prompt to the clipboard", () => {
			showSummaryModal(shadow, "the prompt");

			byLabel(shadow, "📋 Copy to clipboard").click();

			expect(copied).toEqual(["the prompt"]);
		});

		it("downloads the prompt as markdown", () => {
			const click = vi
				.spyOn(HTMLAnchorElement.prototype, "click")
				.mockImplementation(() => {});
			showSummaryModal(shadow, "the prompt");

			byLabel(shadow, "💾 Download as .md").click();

			expect((click.mock.instances[0] as HTMLAnchorElement).download).toBe(
				"arena-summary-prompt.md",
			);
			click.mockRestore();
		});

		describe("paste into the current chat", () => {
			it("drives Arena's controlled textarea through the prototype setter", () => {
				// A plain `.value =` assignment is ignored by React, which tracks the
				// value through its own setter. The input event is what makes the
				// change visible to the framework.
				const ta = document.createElement("textarea");
				ta.name = "message";
				document.body.appendChild(ta);
				const input = vi.fn();
				ta.addEventListener("input", input);
				showSummaryModal(shadow, "the prompt");

				byLabel(shadow, "📥 Paste into current chat").click();

				expect(ta.value).toBe("the prompt");
				expect(input).toHaveBeenCalledTimes(1);
				expect(document.activeElement).toBe(ta);
			});

			it("is a no-op when Arena has no composer", () => {
				showSummaryModal(shadow, "the prompt");

				expect(() =>
					byLabel(shadow, "📥 Paste into current chat").click(),
				).not.toThrow();
			});
		});

		describe("open in a new chat", () => {
			it("opens arena.ai with the prompt encoded", () => {
				const open = vi.spyOn(window, "open").mockImplementation(() => null);
				showSummaryModal(shadow, "a b&c");

				byLabel(shadow, "🚀 Open new arena.ai chat").click();

				const url = open.mock.calls[0]![0] as string;
				expect(url.startsWith("https://arena.ai/?mode=direct&prompt=")).toBe(
					true,
				);
				expect(url).toContain(encodeURIComponent("a b&c"));
				expect(open.mock.calls[0]![1]).toBe("_blank");
				open.mockRestore();
			});

			it("caps the prompt at 4000 characters", () => {
				const open = vi.spyOn(window, "open").mockImplementation(() => null);
				showSummaryModal(shadow, "x".repeat(5000));

				byLabel(shadow, "🚀 Open new arena.ai chat").click();

				const url = new URL(open.mock.calls[0]![0] as string);
				expect(url.searchParams.get("prompt")).toHaveLength(4000);
				open.mockRestore();
			});
		});
	});

	describe("exportConversation", () => {
		it("serializes the messages into the modal", () => {
			const original = location.pathname;
			try {
				history.pushState({}, "", "/c/sess-export-1");

				exportConversation(
					[msg("m1", "user", "hello"), msg("m2", "assistant", "hi there")],
					shadow,
				);

				const ta = shadow.querySelector<HTMLTextAreaElement>(".summary-text")!;
				const parsed = JSON.parse(ta.value) as { sessionId: string };
				expect(parsed.sessionId).toBe("sess-export-1");
				expect(ta.value).toContain("hello");
			} finally {
				history.pushState({}, "", original);
			}
		});

		it("includes captured rounds in the export", () => {
			chatRounds.set("sid-1", captured("hello"));

			exportConversation([msg("m1", "user", "hello")], shadow);

			const ta = shadow.querySelector<HTMLTextAreaElement>(".summary-text")!;
			expect(ta.value).toContain("answer A");
		});
	});

	describe("summarizeRounds", () => {
		it("builds a prompt from the user turns", () => {
			summarizeRounds(
				[msg("m1", "user", "hello"), msg("m2", "assistant", "hi there")],
				shadow,
			);

			const ta = shadow.querySelector<HTMLTextAreaElement>(".summary-text")!;
			expect(ta.value).toContain("hello");
			expect(ta.value).not.toContain("no rounds detected");
		});

		it("says so when there is nothing to summarize yet", () => {
			// buildSummaryPrompt returns "" with no user turns, and an empty
			// textarea would look like a broken button rather than an empty chat.
			summarizeRounds([msg("m1", "assistant", "hi")], shadow);

			expect(
				shadow.querySelector<HTMLTextAreaElement>(".summary-text")!.value,
			).toBe(
				"(no rounds detected yet — wait for arena.ai to load the conversation)",
			);
		});

		it("replaces rather than stacks when invoked twice", () => {
			const messages = [msg("m1", "user", "hello")];

			summarizeRounds(messages, shadow);
			summarizeRounds(messages, shadow);

			expect(shadow.querySelectorAll(".summary-modal")).toHaveLength(1);
		});
	});
});
