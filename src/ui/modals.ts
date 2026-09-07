// Modal dialogs — export, summary, and download.
// Public exports:
//   buildSummaryPrompt  — builds the AI summary prompt text
//   exportConversation — triggers the export modal
//   summarizeRounds    — async entry point for the summary modal

import type { SidebarMessage, CapturedRound } from "../types";
import { chatRounds, lookupModelName } from "../capture";
import { computeRounds } from "../conversationStore";
import { capture } from "../state";
import { getSessionId } from "../platform/route";

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

// ─── Summary prompt builder ──────────────────────────────────────────────────────────────

export function buildSummaryPrompt(messages: SidebarMessage[]): string {
	const userIdxList: number[] = [];
	messages.forEach((m, idx) => {
		if (m.role === "user") userIdxList.push(idx);
	});
	if (userIdxList.length === 0) return "";
	const capturedByUser = new Map<string, CapturedRound>();
	for (const r of chatRounds.values()) {
		if (r.request.content)
			capturedByUser.set(r.request.content.slice(0, 200), r);
	}
	const aResolved = Array.from(chatRounds.values())
		.map((r) => lookupModelName(r.request.modelAId))
		.filter(Boolean);
	const bResolved = Array.from(chatRounds.values())
		.map((r) => lookupModelName(r.request.modelBId))
		.filter(Boolean);
	const aLabel = aResolved[0] || "助手 A";
	const bLabel = bResolved[0] || "助手 B";
	let text =
		'请用中文为以下对话的每一轮生成一个 JSON 总结。每个 round 一个对象，包含 title (≤40 字要点)、summary (≤100 字简述)。\n输出格式：{"rounds":[{"id":"...","title":"...","summary":"..."}]}\n\n';
	let leadContext = "";
	for (let i = 0; i < userIdxList[0]; i++) {
		if (messages[i].role === "assistant") {
			leadContext += `[前置助手消息]: ${messages[i].content.slice(0, 800)}\n`;
		}
	}
	if (leadContext) text += `\n=== 前置上下文 ===\n${leadContext}\n`;
	userIdxList.forEach((userIdx, i) => {
		const userContent = messages[userIdx].content;
		const cap = capturedByUser.get(userContent.slice(0, 200));
		const nextUserIdx = userIdxList[i + 1] ?? messages.length;
		const assistants = messages
			.slice(userIdx + 1, nextUserIdx)
			.filter((m) => m.role === "assistant");
		const userTxt = userContent.slice(0, 800);
		text += `\n=== Round ${i + 1} ===\n`;
		text += `[用户问题]: ${userTxt}\n`;
		if (assistants.length > 0) {
			assistants.forEach((a, idx) => {
				text += `[回答 ${idx + 1}]: ${a.content.slice(0, 1500)}\n`;
			});
		} else if (cap) {
			text += `[${aLabel} 回答]: ${cap.response.aText.slice(0, 1500)}\n`;
			if (cap.request.modelBId)
				text += `[${bLabel} 回答]: ${cap.response.bText.slice(0, 1500)}\n`;
		}
	});
	return text;
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
	const rounds = computeRounds(messages);
	const capturedByUser = new Map<string, CapturedRound>();
	for (const r of chatRounds.values()) {
		if (r.request.content)
			capturedByUser.set(r.request.content.slice(0, 200), r);
	}
	const userIdxList: number[] = [];
	messages.forEach((m, idx) => {
		if (m.role === "user") userIdxList.push(idx);
	});

	const buildJson = () => ({
		sessionId: sid,
		url: location.href,
		exportedAt: new Date().toISOString(),
		rounds: rounds.map((round, i) => {
			const userIdx = messages.findIndex(
				(m) => m.id === round.id && m.role === "user",
			);
			const userContent =
				userIdx >= 0 ? messages[userIdx].content : round.title;
			const cap = capturedByUser.get(userContent.slice(0, 200));
			let assistants: SidebarMessage[] = [];
			if (userIdx >= 0) {
				const nextUserIdx =
					userIdxList[userIdxList.indexOf(userIdx) + 1] ?? messages.length;
				assistants = messages
					.slice(userIdx + 1, nextUserIdx)
					.filter((m) => m.role === "assistant");
			}
			return {
				round: i + 1,
				sessionId: cap ? cap.sessionId : sid,
				user: userContent,
				userMessageId: cap ? cap.request.userMessageId : "",
				responses:
					assistants.length > 0
						? assistants.map((a) => ({ text: a.content }))
						: cap
							? [
									{
										model: "A",
										id: cap.request.modelAId,
										name: lookupModelName(cap.request.modelAId),
										text: cap.response.aText,
										reasoning: cap.response.aReasoning,
									},
									...(cap.request.modelBId
										? [
												{
													model: "B",
													id: cap.request.modelBId,
													name: lookupModelName(cap.request.modelBId),
													text: cap.response.bText,
													reasoning: cap.response.bReasoning,
												},
											]
										: []),
								]
							: [],
			};
		}),
	});

	const json = JSON.stringify(buildJson(), null, 2);
	const md = buildJson()
		.rounds.map((r) => {
			const parts = [`## Round ${r.round}`, "", `**User**: ${r.user}`, ""];
			r.responses.forEach(
				(resp: { name?: string; text?: string }, idx: number) => {
					const label = resp.name || "Response " + (idx + 1);
					parts.push(`**${label}**: ${resp.text || ""}`, "");
				},
			);
			return parts.join("\n");
		})
		.join("\n---\n\n");

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
		const prompt = buildSummaryPrompt(messages);
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
