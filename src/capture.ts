// Network capture — reads arena.ai chat request/response data written by inject-hook.js
// (main world) via shared DOM dataset. Runs on its own 2-second polling interval.
//
// Public exports:
//   pollCaptures    — () => void  (called every 2s by content.ts)
//   chatRounds      — Map<sessionId, CapturedRound>  (raw capture data)
//   modelNameById   — Map<modelId, modelName>

import type { ChatRequest, ChatResponse, CapturedRound } from "./types";
import { addCapturedMessage } from "./conversationStore";

// ─── DOM dataset keys (written by inject-hook.js in main world) ──────────────────────
//   document.documentElement.dataset.aiSideRequest   — chat requests
//   document.documentElement.dataset.aiSideResponse  — chat responses

// ─── Internal capture state ─────────────────────────────────────────────────────────

export const chatRounds = new Map<string, CapturedRound>();
const pendingRequests = new Map<string, ChatRequest>();
export const modelNameById = new Map<string, string>();
let lastRequestTs = 0;
let lastResponseTs = 0;

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
			roundIndex: -1,
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
			roundIndex: -1,
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
			roundIndex: -1,
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
		} catch (_e) {
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
		} catch (_e) {
			/* intentionally empty — JSON parse of response dataset; no-op when stale */
		}
	}
}

// ─── Sprint 2.5: RSC stream capture (tee 旁路样本) ─────────────────────────────────
// Listens to __aiSidebarRsc events from inject-hook.js.
// Goal: confirm whether agent?_rsc= response contains complete message data.
// Does NOT parse or store anything yet — only logs for structure discovery.

let _rscHandler: ((ev: Event) => void) | null = null;
let _lastRscTs = 0; // 防重入

/**
 * Setup CustomEvent listener for Arena's RSC stream responses.
 * Call once from content.ts setup().
 */
export function setupRscCapture(): void {
	if (_rscHandler) return;
	_rscHandler = (ev: Event) => {
		const raw = (ev as CustomEvent<string>).detail;
		if (!raw) return;
		let payload: {
			url?: string;
			status?: number;
			ts?: number;
			body?: string;
			error?: string;
		};
		try {
			payload = JSON.parse(raw);
		} catch {
			return;
		}
		const { url = "", status = 0, ts = 0, body = "", error } = payload;

		// 防重入
		if (ts <= _lastRscTs) return;
		_lastRscTs = ts;

		if (error) {
			console.warn("[AI Sidebar] RSC error:", error, "url=", url);
			return;
		}

		// Sprint 2.5 验收日志
		console.log(
			"[AI Sidebar] RSC captured: status=" +
				status +
				" len=" +
				body.length +
				" url=" +
				url,
		);

		if (body.length > 100) {
			// 结构探测（调试用）
			const preview = body.slice(0, 2000);
			console.log("[AI Sidebar] RSC preview (first 2000 chars):", preview);
			// 检查是否有消息结构字段
			const hasRoleToken = /"role"|"user"|"assistant"/.test(body);
			const hasMsgField = /"content"|"message"|"text"/.test(body);
			const hasUuidId = /"id":\s*"[a-f0-9-]{30,}"/.test(body);
			console.log(
				"[AI Sidebar] RSC structure: role-token=" +
					hasRoleToken +
					" content-field=" +
					hasMsgField +
					" uuid-id=" +
					hasUuidId,
			);
		}

		// Sprint 2.6: 如果 RSC 包含消息数据，在这里 parse → canonical messages → store
	};
	document.documentElement.addEventListener("__aiSidebarRsc", _rscHandler);
	console.log("[AI Sidebar] RSC capture: listening for __aiSidebarRsc");
}

// ─── Model name harvesting ────────────────────────────────────────────────────────

export function harvestModelNames(): number {
	const w = window as unknown as {
		__NEXT_DATA__?: unknown;
		__initialModels?: unknown[];
	};
	const candidates: unknown[] = [];
	const tryPaths = [
		() =>
			(
				w.__NEXT_DATA__ as
					{ props?: { pageProps?: { initialModels?: unknown[] } } } | undefined
			)?.props?.pageProps?.initialModels,
		() =>
			(
				w.__NEXT_DATA__ as
					{ props?: { pageProps?: { initialModelAId?: string } } } | undefined
			)?.props?.pageProps?.initialModelAId
				? (w.__NEXT_DATA__ as { props?: { pageProps?: unknown } } | undefined)
						?.props?.pageProps
				: null,
		() => w.__initialModels,
	];
	for (const fn of tryPaths) {
		try {
			const v = fn();
			if (Array.isArray(v)) candidates.push(v);
			else if (
				v &&
				typeof v === "object" &&
				Array.isArray((v as { initialModels?: unknown[] }).initialModels)
			)
				candidates.push((v as { initialModels: unknown[] }).initialModels);
		} catch (_e) {
			/* intentionally empty — __NEXT_DATA__ path may not exist on all pages */
		}
	}
	try {
		const nextDataEl = document.querySelector("#__NEXT_DATA__");
		if (nextDataEl) {
			const txt = nextDataEl.textContent || "";
			const m = txt.match(
				/"initialModels"\s*:\s*\[([\s\S]{20,50000}?)\](?=[\s,}])/,
			);
			if (m) {
				try {
					candidates.push(JSON.parse("[" + m[1] + "]"));
				} catch (_e) {
					/* intentionally empty — JSON parse of extracted snippet may fail */
				}
			}
		}
	} catch (_e) {
		/* intentionally empty — __NEXT_DATA__ element may not exist */
	}
	try {
		const scripts = document.querySelectorAll("script");
		scripts.forEach((s) => {
			const txt = s.textContent || "";
			const m = txt.match(
				/"initialModels"\s*:\s*\[([\s\S]{20,50000}?)\](?=[\s,}])/,
			);
			if (m) {
				try {
					candidates.push(JSON.parse("[" + m[1] + "]"));
				} catch (_e) {
					/* intentionally empty — JSON parse of extracted snippet may fail */
				}
			}
		});
	} catch (_e) {
		/* intentionally empty — script iteration may throw */
	}
	try {
		const allTexts = Array.from(document.querySelectorAll("script"))
			.map((s) => s.textContent || "")
			.join("\n");
		const ms = allTexts.matchAll(
			/"publicName"\s*:\s*"([^"]+)"[^}]{0,200}"id"\s*:\s*"([^"]+)"/g,
		);
		for (const m of ms) {
			const name = m[1],
				id = m[2];
			if (name && id && !modelNameById.has(id)) modelNameById.set(id, name);
		}
	} catch (_e) {
		/* intentionally empty — matchAll on large script text may throw */
	}
	let n = 0;
	for (const arr of candidates) {
		if (!Array.isArray(arr)) continue;
		for (const m of arr as Array<{ id?: string; publicName?: string }>) {
			if (m && typeof m === "object" && m.id && m.publicName) {
				if (!modelNameById.has(m.id)) {
					modelNameById.set(m.id, m.publicName);
					n++;
				}
			}
		}
	}
	return n;
}

export function lookupModelName(id: string): string {
	if (!id) return "";
	if (modelNameById.has(id)) return modelNameById.get(id)!;
	harvestModelNames();
	return modelNameById.get(id) || "";
}
