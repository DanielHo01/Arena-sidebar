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

/**
 * A user turn paired with its position in the message list.
 *
 * Returning the message alongside the index is deliberate. Under
 * noUncheckedIndexedAccess, `messages[idx]` is typed `SidebarMessage | undefined`
 * even when `idx` provably came from this very array, which pushes every caller
 * into a guard that can never fire -- and an unreachable guard is worse than no
 * guard, because it reads as a real edge case and silently drops branch
 * coverage. Carrying the message means callers never index at all.
 */
type UserTurn = { idx: number; msg: SidebarMessage };

function userTurns(messages: SidebarMessage[]): UserTurn[] {
	const list: UserTurn[] = [];
	messages.forEach((msg, idx) => {
		if (msg.role === "user") list.push({ idx, msg });
	});
	return list;
}

/**
 * Assistant messages between one user turn and the next boundary.
 *
 * Takes explicit boundaries rather than looking the next turn up by index, so
 * there is no `list[i + 1]` for the compiler to widen and no guard to write.
 */
function assistantsBetween(
	messages: SidebarMessage[],
	startIdx: number,
	endIdx: number,
): SidebarMessage[] {
	return messages
		.slice(startIdx + 1, endIdx)
		.filter((m) => m.role === "assistant");
}

// ─── Summary prompt ─────────────────────────────────────────────────────────────────

export function buildSummaryPrompt(input: SerializeInput): string {
	const { messages, captured, resolveModelName } = input;
	const turns = userTurns(messages);
	// Destructuring rather than `turns.length === 0`: same guard, but the
	// narrowed `firstTurn` below needs no second check, so no branch here is
	// unreachable.
	const [firstTurn] = turns;
	if (!firstTurn) return "";

	const capturedByUser = indexCapturedByUser(captured);
	const aLabel =
		captured.map((r) => resolveModelName(r.request.modelAId)).find(Boolean) ||
		"助手 A";
	const bLabel =
		captured.map((r) => resolveModelName(r.request.modelBId)).find(Boolean) ||
		"助手 B";

	let text =
		'请用中文为以下对话的每一轮生成一个 JSON 总结。每个 round 一个对象，包含 title (≤40 字要点)、summary (≤100 字简述)。\n输出格式：{"rounds":[{"id":"...","title":"...","summary":"..."}]}\n\n';

	// Assistant messages that precede the first user turn (system/persona
	// preambles). Iterating a slice rather than indexing `messages[i]`: iteration
	// yields `SidebarMessage`, not `SidebarMessage | undefined`, so there is no
	// guard to write and therefore no unreachable branch to leave uncovered.
	let leadContext = "";
	for (const m of messages.slice(0, firstTurn.idx)) {
		if (m.role === "assistant") {
			leadContext += `[前置助手消息]: ${m.content.slice(0, 800)}\n`;
		}
	}
	if (leadContext) text += `\n=== 前置上下文 ===\n${leadContext}\n`;

	turns.forEach(({ idx, msg }, i) => {
		const userContent = msg.content;
		const cap = capturedByUser.get(userContent.slice(0, 200));
		const nextTurn = turns[i + 1];
		const assistants = assistantsBetween(
			messages,
			idx,
			nextTurn ? nextTurn.idx : messages.length,
		);
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
	const turns = userTurns(messages);

	return rounds.map((round, i) => {
		// `.find`-style lookup through `turns` rather than `findIndex` +
		// `messages[idx]`. Indexing `turns` directly is what makes this terse:
		// `turns[-1]` is already `undefined` and already typed as such, so there is
		// no `pos >= 0 ? ... : undefined` ternary adding branches that only restate
		// what the index already does.
		const turnPos = turns.findIndex((t) => t.msg.id === round.id);
		const turn = turns[turnPos];
		const userContent = turn?.msg.content ?? round.title;
		const cap = capturedByUser.get(userContent.slice(0, 200));
		const nextTurn = turns[turnPos + 1];
		const assistants = turn
			? assistantsBetween(
					messages,
					turn.idx,
					nextTurn ? nextTurn.idx : messages.length,
				)
			: [];

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
