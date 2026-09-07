// Modal dialogs — export, summary, and download.
//
// This file is DOM only. Every piece of text it shows is produced by
// core/serialize.ts, which takes the captured rounds and the model-name
// resolver as parameters instead of reaching for the singletons.
// Public exports:
//   exportConversation — triggers the export modal
//   summarizeRounds    — async entry point for the summary modal

import type { SidebarMessage } from "../types";
import {
	buildJson,
	buildMarkdown,
	buildSummaryPrompt,
	type SerializeInput,
} from "../core/serialize";
import { chatRounds, lookupModelName } from "../capture";
import { capture } from "../state";
import { getSessionId } from "../platform/route";

/** Assemble the pure serialize inputs from the live singletons. */
function serializeInput(sessionId: string): SerializeInput {
	return {
		sessionId,
		url: location.href,
		exportedAt: new Date().toISOString(),
		messages: [],
		captured: Array.from(chatRounds.values()),
		resolveModelName: lookupModelName,
	};
}

// ─── Download helper ─────────────────────────────────────────────────────────────────

function downloadBlob(filename: string, mime: string, content: string) {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

// ─── Export modal ─────────────────────────────────────────────────────────────────────

export function showExportModal(
	shadowRoot: ShadowRoot,
	json: string,
	md: string,
	sid: string,
) {
	let modal = shadowRoot.querySelector(".summary-modal") as HTMLElement | null;
	if (modal) modal.remove();
	modal = document.createElement("div");
	modal.className = "summary-modal";
	const box = document.createElement("div");
	box.className = "summary-box";
	const title = document.createElement("div");
	title.className = "summary-title";
	title.textContent =
		"📤 Export conversation — " + (sid ? sid.slice(0, 8) + "…" : "no session");
	const actions = document.createElement("div");
	actions.className = "summary-actions";
	const makeBtn = (label: string, onclick: () => void) => {
		const btn = document.createElement("button");
		btn.textContent = label;
		btn.onclick = onclick;
		return btn;
	};
	actions.appendChild(
		makeBtn("📋 Copy JSON", () =>
			navigator.clipboard.writeText(json).then(() => {}),
		),
	);
	actions.appendChild(
		makeBtn("📋 Copy Markdown", () =>
			navigator.clipboard.writeText(md).then(() => {}),
		),
	);
	actions.appendChild(
		makeBtn("🔗 Copy link", () =>
			navigator.clipboard.writeText(location.href).then(() => {}),
		),
	);
	actions.appendChild(
		makeBtn("💾 Download JSON", () =>
			downloadBlob(
				"arena-" + (sid || "chat") + ".json",
				"application/json;charset=utf-8",
				json,
			),
		),
	);
	actions.appendChild(
		makeBtn("💾 Download .md", () =>
			downloadBlob(
				"arena-" + (sid || "chat") + ".md",
				"text/markdown;charset=utf-8",
				md,
			),
		),
	);
	const closeBtn = document.createElement("button");
	closeBtn.textContent = "✕ Close";
	closeBtn.onclick = () => {
		modal!.remove();
	};
	actions.appendChild(closeBtn);
	const ta = document.createElement("textarea");
	ta.className = "summary-text";
	ta.readOnly = true;
	ta.value = json;
	box.appendChild(title);
	box.appendChild(actions);
	box.appendChild(ta);
	modal.appendChild(box);
	modal.onclick = (e) => {
		if (e.target === modal) modal.remove();
	};
	shadowRoot.appendChild(modal);
}

// ─── Summary modal ──────────────────────────────────────────────────────────────────────

export function showSummaryModal(shadowRoot: ShadowRoot, promptText: string) {
	let modal = shadowRoot.querySelector(".summary-modal") as HTMLElement | null;
	if (modal) modal.remove();
	modal = document.createElement("div");
	modal.className = "summary-modal";
	const box = document.createElement("div");
	box.className = "summary-box";
	const title = document.createElement("div");
	title.className = "summary-title";
	const roundCount = (promptText.match(/=== Round \d+ ===/g) || []).length;
	title.textContent =
		"✨ Summary prompt — " +
		roundCount +
		" rounds · " +
		promptText.length +
		" chars";
	const actions = document.createElement("div");
	actions.className = "summary-actions";

	const makeBtn = (label: string, className: string, onclick: () => void) => {
		const btn = document.createElement("button");
		btn.textContent = label;
		if (className) btn.className = className;
		btn.onclick = onclick;
		return btn;
	};

	actions.appendChild(
		makeBtn("📋 Copy to clipboard", "", () =>
			navigator.clipboard.writeText(promptText).then(() => {}),
		),
	);

	actions.appendChild(
		makeBtn("📥 Paste into current chat", "", () => {
			const ta = document.querySelector(
				'textarea[name="message"], textarea[placeholder*="followup" i], textarea[placeholder*="Ask" i]',
			) as HTMLTextAreaElement | null;
			if (ta) {
				ta.focus();
				const setter = Object.getOwnPropertyDescriptor(
					window.HTMLTextAreaElement.prototype,
					"value",
				)!.set!;
				setter.call(ta, promptText);
				ta.dispatchEvent(new Event("input", { bubbles: true }));
			}
		}),
	);

	// New tab: domain is hardcoded; prompt is encodeURIComponent-wrapped — no injection possible.
	// Origin validated via URL() constructor.
	actions.appendChild(
		makeBtn("🚀 Open new arena.ai chat", "primary", () => {
			const raw =
				"https://arena.ai/?mode=direct&prompt=" +
				encodeURIComponent(promptText.slice(0, 4000));
			try {
				const u = new URL(raw);
				if (u.origin === "https://arena.ai") {
					// pi-lens-ignore: ast-grep:no-open-redirect
					window.open(u.href, "_blank");
				}
			} catch {
				/* malformed URL — silently ignore */
			}
		}),
	);

	actions.appendChild(
		makeBtn("💾 Download as .md", "", () =>
			downloadBlob(
				"arena-summary-prompt.md",
				"text/markdown;charset=utf-8",
				promptText,
			),
		),
	);

	const closeBtn = document.createElement("button");
	closeBtn.textContent = "✕ Close";
	closeBtn.onclick = () => {
		modal!.remove();
	};
	actions.appendChild(closeBtn);

	const ta = document.createElement("textarea");
	ta.className = "summary-text";
	ta.readOnly = true;
	ta.value = promptText;
	ta.scrollTop = 0;

	box.appendChild(title);
	box.appendChild(actions);
	box.appendChild(ta);
	modal.appendChild(box);
	modal.onclick = (e) => {
		if (e.target === modal) modal.remove();
	};
	shadowRoot.appendChild(modal);
	requestAnimationFrame(() => {
		ta.scrollTop = 0;
	});
}

// ─── Export conversation ───────────────────────────────────────────────────────────────

export function exportConversation(
	messages: SidebarMessage[],
	shadowRoot: ShadowRoot,
) {
	const sid = getSessionId(location.pathname);
	const input: SerializeInput = {
		...serializeInput(sid),
		messages,
	};
	const json = JSON.stringify(buildJson(input), null, 2);
	const md = buildMarkdown(input);
	showExportModal(shadowRoot, json, md, sid);
}

// ─── Summarize rounds ─────────────────────────────────────────────────────────────────

export function summarizeRounds(
	messages: SidebarMessage[],
	shadowRoot: ShadowRoot,
) {
	if (capture.isSummarizing) return;
	capture.isSummarizing = true;
	try {
		const prompt = buildSummaryPrompt({
			...serializeInput(getSessionId(location.pathname)),
			messages,
		});
		if (!prompt) {
			showSummaryModal(
				shadowRoot,
				"(no rounds detected yet — wait for arena.ai to load the conversation)",
			);
			return;
		}
		showSummaryModal(shadowRoot, prompt);
	} finally {
		capture.isSummarizing = false;
	}
}
