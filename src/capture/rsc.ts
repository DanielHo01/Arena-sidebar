// capture/rsc.ts — passive listener for Arena's RSC stream responses.
//
// Discovery scaffolding: it logs the shape of what Arena sends but does not
// parse or store anything yet. Kept separate because it shares no state with the
// chat capture path.

import type { Disposer } from "../types";

// ─── Sprint 2.5: RSC stream capture (tee 旁路样本) ─────────────────────────────────
// Listens to __aiSidebarRsc events from inject-hook.js.
// Goal: confirm whether agent?_rsc= response contains complete message data.
// Does NOT parse or store anything yet — only logs for structure discovery.

let _rscHandler: ((ev: Event) => void) | null = null;
let _lastRscTs = 0; // 防重入

/** Clear the re-entry guard on a route change. */
export function resetRscState(): void {
	_lastRscTs = 0;
}

/**
 * Setup CustomEvent listener for Arena's RSC stream responses.
 * Call once from content.ts setup().
 */
export function setupRscCapture(): Disposer {
	if (_rscHandler) return () => {};
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
	const handler = _rscHandler;
	document.documentElement.addEventListener("__aiSidebarRsc", handler);
	console.log("[AI Sidebar] RSC capture: listening for __aiSidebarRsc");
	return () => {
		document.documentElement.removeEventListener("__aiSidebarRsc", handler);
		if (_rscHandler === handler) _rscHandler = null;
	};
}
