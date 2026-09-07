// capture/chatCapture.ts — pairs arena.ai chat requests with their responses.
//
// public/inject-hook.js runs in the MAIN world and writes what it intercepted
// into document.documentElement.dataset; this module polls that dataset, matches
// a response to the request that preceded it, and flushes completed pairs into
// the conversation store as canonical messages.
//
// Split out of the 324-line capture.ts in Phase 5; capture.ts now only
// re-exports, so importers are unchanged.

import type { ChatRequest, ChatResponse, CapturedRound } from "../types";
import { addCapturedMessage } from "../conversationStore";

// ─── DOM dataset keys (written by inject-hook.js in main world) ──────────────────────
//   document.documentElement.dataset.aiSideRequest   — chat requests
//   document.documentElement.dataset.aiSideResponse  — chat responses

// ─── Internal capture state ─────────────────────────────────────────────────────────

export const chatRounds = new Map<string, CapturedRound>();
const pendingRequests = new Map<string, ChatRequest>();
let lastRequestTs = 0;
let lastResponseTs = 0;

/**
 * Clear per-session capture state on a route change.
 *
 * This was one of the 8 residual states: nothing cleared it, so switching
 * sessions left `pendingRequests` holding the PREVIOUS session's unfinished
 * request. When the new session's response arrived it paired against that stale
 * request, cross-binding two conversations.
 *
 * The RSC listener has its own resetRscState() in capture/rsc.ts, and
 * capture/models.ts owns modelNameById, which is deliberately NOT cleared here:
 * model names are page-scoped, not session-scoped, and re-harvesting them costs
 * a full script-text scan.
 */
export function resetCaptureState(): void {
	lastRequestTs = 0;
	lastResponseTs = 0;
	pendingRequests.clear();
	chatRounds.clear();
}

// ─── Chat capture ──────────────────────────────────────────────────────────────────

export function pollCaptures() {
	checkChatCapture();
}

/** Add a captured round's user + assistant messages to conversationStore. */
function flushCapturedRound(sid: string, req: ChatRequest, resp: ChatResponse) {
	// User message.
	if (req.content?.trim()) {
		addCapturedMessage({
			id: sid,
			role: "user",
			content: req.content.trim(),
			origin: "capture",
			capturedAt: resp.ts,
			sessionId: sid,
		});
	}
	// Assistant message — primary model A, also model B for side-by-side.
	const isTwoModel = !!(resp.bText || resp.bError);
	if (resp.aText?.trim()) {
		addCapturedMessage({
			id: sid + "-A",
			role: "assistant",
			content: resp.aText.trim(),
			origin: "capture",
			capturedAt: resp.ts,
			sessionId: sid,
		});
	}
	if (isTwoModel && resp.bText?.trim()) {
		addCapturedMessage({
			id: sid + "-B",
			role: "assistant",
			content: resp.bText.trim(),
			origin: "capture",
			capturedAt: resp.ts,
			sessionId: sid,
		});
	}
}

function checkChatCapture() {
	const reqRaw = document.documentElement.dataset.aiSideRequest;
	if (reqRaw) {
		try {
			const r: ChatRequest = JSON.parse(reqRaw);
			if (r.ts && r.ts !== lastRequestTs) {
				lastRequestTs = r.ts;
				pendingRequests.set(r.sessionId, r);
			}
		} catch {
			/* intentionally empty — JSON parse of request dataset; no-op when stale */
		}
	}

	const respRaw = document.documentElement.dataset.aiSideResponse;
	if (respRaw) {
		try {
			const resp: ChatResponse = JSON.parse(respRaw);
			if (resp.ts && resp.ts !== lastResponseTs) {
				lastResponseTs = resp.ts;
				const isTwoModel = !!(resp.bText || resp.bError);
				for (const [sid, req] of pendingRequests) {
					if (chatRounds.has(sid) && chatRounds.get(sid)!.completed) continue;
					const done =
						!!resp.aError ||
						!!resp.bError ||
						(isTwoModel ? resp.aFinished && resp.bFinished : resp.aFinished);
					chatRounds.set(sid, {
						sessionId: sid,
						request: req,
						response: resp,
						completed: done,
					});
					if (done) {
						flushCapturedRound(sid, req, resp);
						pendingRequests.delete(sid);
					}
				}
			}
		} catch {
			/* intentionally empty — JSON parse of response dataset; no-op when stale */
		}
	}
}
