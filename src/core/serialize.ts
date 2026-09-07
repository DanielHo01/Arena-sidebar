// core/serialize.ts — export and summary text builders.
//
// These were closures inside exportConversation() in ui/modals.ts, interleaved
// with DOM dialog code, which made them impossible to test. They are now pure:
// no DOM, no storage, no capture singleton, no clock.
//
// Two things had to become parameters to achieve that:
//   - `chatRounds` (the capture singleton)  -> input.captured
//   - `lookupModelName` / `new Date()`      -> input.resolveModelName / input.exportedAt
// The caller (ui/modals.ts) supplies them; nothing here reaches outward.

import type { CapturedRound, SidebarMessage } from "../types";
import { computeRounds } from "./rounds";

export interface SerializeInput {
	sessionId: string;
	url: string;
	/** Injected so the output is deterministic. Callers pass new Date().toISOString(). */
	exportedAt: string;
	messages: SidebarMessage[];
	/** Captured rounds, in arrival order (chatRounds.values()). */
	captured: CapturedRound[];
	/** Model id -> display name. Return "" when unknown. */
	resolveModelName: (id: string) => string;
}

export interface ExportResponse {
	model?: string;
	id?: string;
	name?: string;
	text?: string;
	reasoning?: string;
}

export interface ExportRound {
	round: number;
	sessionId: string;
	user: string;
	userMessageId: string;
	responses: ExportResponse[];
}

export interface ExportPayload {
	sessionId: string;
	url: string;
	exportedAt: string;
	rounds: ExportRound[];
}

/** Key captured rounds by the first 200 chars of the request content. */
export function indexCapturedByUser(
	captured: CapturedRound[],
): Map<string, CapturedRound> {
	const idx = new Map<string, CapturedRound>();
	for (const r of captured) {
		if (r.request.content) idx.set(r.request.content.slice(0, 200), r);
	}
	return idx;
}

function userIndexes(messages: SidebarMessage[]): number[] {
	const list: number[] = [];
	messages.forEach((m, idx) => {
		if (m.role === "user") list.push(idx);
	});
	return list;
}

/** Assistants between a user turn and the next one. */
function assistantsAfter(
	messages: SidebarMessage[],
	userIdx: number,
	userIdxList: number[],
): SidebarMessage[] {
	const nextUserIdx =
		userIdxList[userIdxList.indexOf(userIdx) + 1] ?? messages.length;
	return messages
		.slice(userIdx + 1, nextUserIdx)
		.filter((m) => m.role === "assistant");
}

// ─── Summary prompt ─────────────────────────────────────────────────────────────────

export function buildSummaryPrompt(input: SerializeInput): string {
	const { messages, captured, resolveModelName } = input;
	const userIdxList = userIndexes(messages);
	if (userIdxList.length === 0) return "";

	const capturedByUser = indexCapturedByUser(captured);
	const aLabel =
		captured.map((r) => resolveModelName(r.request.modelAId)).find(Boolean) ||
		"助手 A";
	const bLabel =
		captured.map((r) => resolveModelName(r.request.modelBId)).find(Boolean) ||
		"助手 B";

	let text =
		'请用中文为以下对话的每一轮生成一个 JSON 总结。每个 round 一个对象，包含 title (≤40 字要点)、summary (≤100 字简述)。\n输出格式：{"rounds":[{"id":"...","title":"...","summary":"..."}]}\n\n';

	// Assistant messages that precede the first user turn (system/persona preambles).
	// userIdxList is non-empty here (guarded above), but the element type is still
	// `number | undefined` under noUncheckedIndexedAccess.
	const firstUserIdx = userIdxList[0] ?? 0;
	let leadContext = "";
	for (let i = 0; i < firstUserIdx; i++) {
		const m = messages[i];
		if (m && m.role === "assistant") {
			leadContext += `[前置助手消息]: ${m.content.slice(0, 800)}\n`;
		}
	}
	if (leadContext) text += `\n=== 前置上下文 ===\n${leadContext}\n`;

	userIdxList.forEach((userIdx, i) => {
		const userMsg = messages[userIdx];
		if (!userMsg) return;
		const userContent = userMsg.content;
		const cap = capturedByUser.get(userContent.slice(0, 200));
		const assistants = assistantsAfter(messages, userIdx, userIdxList);
		text += `\n=== Round ${i + 1} ===\n`;
		text += `[用户问题]: ${userContent.slice(0, 800)}\n`;
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

// ─── Export payload ─────────────────────────────────────────────────────────────────

export function buildExportRounds(input: SerializeInput): ExportRound[] {
	const { messages, sessionId, resolveModelName } = input;
	const rounds = computeRounds(messages);
	const capturedByUser = indexCapturedByUser(input.captured);
	const userIdxList = userIndexes(messages);

	return rounds.map((round, i) => {
		const userIdx = messages.findIndex(
			(m) => m.id === round.id && m.role === "user",
		);
		const userMsg = userIdx >= 0 ? messages[userIdx] : undefined;
		const userContent = userMsg?.content ?? round.title;
		const cap = capturedByUser.get(userContent.slice(0, 200));
		const assistants =
			userIdx >= 0 ? assistantsAfter(messages, userIdx, userIdxList) : [];

		let responses: ExportResponse[];
		if (assistants.length > 0) {
			responses = assistants.map((a) => ({ text: a.content }));
		} else if (cap) {
			responses = [
				{
					model: "A",
					id: cap.request.modelAId,
					name: resolveModelName(cap.request.modelAId),
					text: cap.response.aText,
					reasoning: cap.response.aReasoning,
				},
				...(cap.request.modelBId
					? [
							{
								model: "B",
								id: cap.request.modelBId,
								name: resolveModelName(cap.request.modelBId),
								text: cap.response.bText,
								reasoning: cap.response.bReasoning,
							},
						]
					: []),
			];
		} else {
			responses = [];
		}

		return {
			round: i + 1,
			sessionId: cap ? cap.sessionId : sessionId,
			user: userContent,
			userMessageId: cap ? cap.request.userMessageId : "",
			responses,
		};
	});
}

export function buildJson(input: SerializeInput): ExportPayload {
	return {
		sessionId: input.sessionId,
		url: input.url,
		exportedAt: input.exportedAt,
		rounds: buildExportRounds(input),
	};
}

export function buildMarkdown(input: SerializeInput): string {
	return buildExportRounds(input)
		.map((r) => {
			const parts = [`## Round ${r.round}`, "", `**User**: ${r.user}`, ""];
			r.responses.forEach((resp, idx) => {
				const label = resp.name || "Response " + (idx + 1);
				parts.push(`**${label}**: ${resp.text || ""}`, "");
			});
			return parts.join("\n");
		})
		.join("\n---\n\n");
}
