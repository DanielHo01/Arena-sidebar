// Content script — extracts arena.ai messages and injects floating UI via Shadow DOM
// Architecture: single content script, no sidepanel, no message passing

interface ExtractedMessage {
	id: string;
	role: "user" | "assistant" | "system";
	content: string;
}

// ─── Module-level state ─────────────────────────────────────────────────────────────────
// P0 #1 — EXTRACT_COOLDOWN_MS prevents expensive full-DOM scans on every MutationObserver trigger.
const EXTRACT_COOLDOWN_MS = 500;

const cachedElements: Map<string, Element> = new Map();
let observer: MutationObserver | null = null;
let shadowRoot: ShadowRoot | null = null;

// P1 #3 — module-level timer refs replace the unsafe window.__aiSidebarDebounce / __aiSidebarInterval.
// Guard pattern: checked !== null to prevent double-start on repeated ensureUI() calls.
let debounceTimer: ReturnType<typeof setTimeout> | null = null;
let pollIntervalId: ReturnType<typeof setInterval> | null = null;
let refreshIntervalId: ReturnType<typeof setInterval> | null = null;

let currentMessages: ExtractedMessage[] = [];
let prevRoundIds: string[] = [];
let reverseOrder = true;
let prevIsOpen = false;
let searchQuery = "";
let currentRoundIdx = 0;
let fabPosition: { x: number; y: number } | null = null;
let prevSearchActive = false;
let highlightInitialized = false;
let isDragging = false;
let isOpen = false;
let isSummarizing = false;
let apiConfig: {
	url: string;
	headers: Record<string, string>;
	bodySample: any;
} | null = null;
let roundSummaries = new Map<string, { title: string; summary: string }>();
const hiddenRoundIds = new Set<string>();

// Capture state
let lastExtractTs = 0; // P0 #1 — tracks when extractMessages last ran
let lastWsTs = 0;
const wsEvents: any[] = [];

// ─── Capture polling (runs on its own interval, decoupled from UI rendering) ──────────
function pollCaptures() {
	checkApiCapture();
	checkWsCapture();
	checkChatCapture();
}

function checkApiCapture() {
	if (apiConfig) return;
	const raw = document.documentElement.dataset.aiSideApi;
	if (!raw) return;
	try {
		const d = JSON.parse(raw);
		if (d?.url && d?.bodySample?.messages?.length) {
			apiConfig = {
				url: d.url,
				headers: d.headers || {},
				bodySample: d.bodySample,
			};
			const btn = shadowRoot?.querySelector(
				".summary-btn",
			) as HTMLButtonElement | null;
			if (btn) btn.disabled = false;
		}
	} catch (_e) {
		/* intentionally empty — JSON parse / dataset read; no-op when stale */
	}
}

function checkWsCapture() {
	const raw = document.documentElement.dataset.aiSideWs;
	if (!raw) return;
	try {
		const ev = JSON.parse(raw);
		if (ev.ts && ev.ts !== lastWsTs) {
			lastWsTs = ev.ts;
			wsEvents.push(ev);
			if (wsEvents.length > 100) wsEvents.splice(0, wsEvents.length - 100);
			document.documentElement.dataset.aiSideWs = "";
		}
	} catch (_e) {
		/* intentionally empty — JSON parse / dataset read; no-op when stale */
	}
}

interface ChatRequest {
	kind: "chat-request";
	url: string;
	sessionId: string;
	mode: string;
	modality: string;
	modelAId: string;
	modelBId: string;
	userMessageId: string;
	content: string;
	attachmentCount: number;
	ts: number;
}
interface ChatResponse {
	kind: "chat-response";
	aText: string;
	aReasoning: string;
	aFinished: boolean;
	aError: string;
	bText: string;
	bReasoning: string;
	bFinished: boolean;
	bError: string;
	ts: number;
}
interface CapturedRound {
	sessionId: string;
	request: ChatRequest;
	response: ChatResponse;
	completed: boolean;
}

const chatRounds = new Map<string, CapturedRound>();
const pendingRequests = new Map<string, ChatRequest>();
const modelNameById = new Map<string, string>();
let lastRequestTs = 0;
let lastResponseTs = 0;

function harvestModelNames(): number {
	const w = window as unknown as {
		__NEXT_DATA__?: any;
		__initialModels?: any[];
		__NEXT_DATA__raw?: any;
		__next_f?: any[];
		__self?: any;
	};
	const candidates: any[] = [];
	const tryPaths = [
		() => w.__NEXT_DATA__?.props?.pageProps?.initialModels,
		() =>
			w.__NEXT_DATA__?.props?.pageProps?.initialModelAId
				? w.__NEXT_DATA__.props.pageProps
				: null,
		() => w.__initialModels,
	];
	for (const fn of tryPaths) {
		try {
			const v = fn();
			if (Array.isArray(v)) candidates.push(v);
			else if (v && typeof v === "object" && Array.isArray(v.initialModels))
				candidates.push(v.initialModels);
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
		for (const m of arr) {
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

function lookupModelName(id: string): string {
	if (!id) return "";
	if (modelNameById.has(id)) return modelNameById.get(id)!;
	harvestModelNames();
	return modelNameById.get(id) || "";
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
				const isTwoModel = !!resp.bText || !!resp.bError;
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
					if (done) pendingRequests.delete(sid);
				}
			}
		} catch (_e) {
			/* intentionally empty — JSON parse of response dataset; no-op when stale */
		}
	}
}

const USER_MESSAGE_SELECTOR =
	'main [class*="bg-surface-raised"][class*="rounded-lg"]:not([class*="w-4"]):not([class*="inline-flex"])';
const ASSISTANT_MESSAGE_SELECTOR =
	'main [class*="bg-surface-primary"][class*="flex-col"][class*="overflow-hidden"]';

function generateStableId(el: Element, idx: number): string {
	if (el.id) return "el-" + el.id;
	const existing = el.getAttribute("data-ai-sidebar-id");
	if (existing) return existing;
	const id = "msg-" + idx + "-" + Math.random().toString(36).slice(2, 8);
	el.setAttribute("data-ai-sidebar-id", id);
	return id;
}

// P0 #4 — TreeWalker avoids the expensive cloneNode(true) on potentially large message subtrees.
function extractText(el: Element): string {
	const parts: string[] = [];
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			if (
				parent.closest('button, [role="button"], nav, [aria-hidden="true"]')
			) {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	while (walker.nextNode()) {
		const t = walker.currentNode.textContent?.replace(/\s+/g, " ").trim();
		if (t) parts.push(t);
	}
	return parts.join(" ");
}

function compareDocOrder(a: Element, b: Element): number {
	const pos = a.compareDocumentPosition(b);
	if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
	if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
	return 0;
}

function dedupeByRoot(elements: Element[]): Element[] {
	const seen = new Set<Element>();
	const out: Element[] = [];
	for (const el of elements) {
		if (seen.has(el)) continue;
		let dup = false;
		for (const other of seen) {
			if (other.contains(el) || el.contains(other)) {
				dup = true;
				break;
			}
		}
		if (!dup) {
			seen.add(el);
			out.push(el);
		}
	}
	return out;
}

function collectAllElements(): Array<{
	el: Element;
	role: "user" | "assistant";
}> {
	const all: Array<{ el: Element; role: "user" | "assistant" }> = [];
	const MIN_USER_LEN = 3;
	const MIN_ASSISTANT_LEN = 50;

	// P0 #9 — cheap checks BEFORE getBoundingClientRect (which forces reflow).
	const isLikelyRealMessage = (
		el: Element,
		role: "user" | "assistant",
	): boolean => {
		const tag = el.tagName.toLowerCase();
		if (["script", "style", "noscript", "template"].includes(tag)) return false;
		if (el.getAttribute("aria-hidden") === "true") return false;
		const text = (el.textContent || "").trim();
		const minLen = role === "user" ? MIN_USER_LEN : MIN_ASSISTANT_LEN;
		if (text.length < minLen) return false;
		if (role === "user") {
			const lines = text
				.split(/[。！？.!?\n]/)
				.filter((s) => s.trim().length > 0);
			if (lines.length > 30) return false;
		}
		// P0 #9 — getBoundingClientRect is last; it forces layout so keep it after cheap filters.
		const rect = (el as HTMLElement).getBoundingClientRect?.();
		if (rect && rect.width < 200) return false;
		if (rect && role === "user" && rect.width > 1000) return false;
		return true;
	};

	const visit = (root: Element | Document) => {
		try {
			root.querySelectorAll(USER_MESSAGE_SELECTOR).forEach((el) => {
				if (!isLikelyRealMessage(el, "user")) return;
				all.push({ el, role: "user" });
			});
		} catch (_e) {
			/* intentionally empty — selector may throw on detached nodes */
		}
		try {
			root.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR).forEach((el) => {
				if (!isLikelyRealMessage(el, "assistant")) return;
				all.push({ el, role: "assistant" });
			});
		} catch (_e) {
			/* intentionally empty — selector may throw on detached nodes */
		}
		const anyRoot = root as Element & { shadowRoot?: ShadowRoot | null };
		if (anyRoot.shadowRoot) visit(anyRoot.shadowRoot as unknown as Element);
		root.querySelectorAll("*").forEach((el) => {
			const sr = (el as Element & { shadowRoot?: ShadowRoot | null })
				.shadowRoot;
			if (sr) visit(sr as unknown as Element);
		});
	};
	visit(document);
	const dedupedEls = dedupeByRoot(all.map((x) => x.el));
	const roleByEl = new Map<Element, "user" | "assistant">();
	for (const { el, role } of all) {
		if (!roleByEl.has(el)) roleByEl.set(el, role);
	}
	return dedupedEls.map((el) => ({
		el,
		role: roleByEl.get(el) || "assistant",
	}));
}

function extractMessages(): ExtractedMessage[] {
	const all = collectAllElements();
	cachedElements.clear();
	const messages: ExtractedMessage[] = [];
	all
		.sort((a, b) => compareDocOrder(a.el, b.el))
		.forEach(({ el, role }, idx) => {
			const content = extractText(el);
			if (!content || content.length < 1) return;
			const id = generateStableId(el, idx);
			el.setAttribute("data-ai-sidebar-id", id);
			cachedElements.set(id, el);
			messages.push({ id, role, content });
		});
	return messages;
}

function groupIntoRounds(messages: ExtractedMessage[]) {
	const rounds: Array<{ id: string; title: string; messageCount: number }> = [];
	let current: { id: string; title: string; messageCount: number } | null =
		null;
	let pendingLeadAssistant: ExtractedMessage | null = null;
	for (const msg of messages) {
		if (msg.role === "assistant" && current === null) {
			pendingLeadAssistant = msg;
			continue;
		}
		if (msg.role === "user") {
			if (current !== null) {
				rounds.push(current);
			} else if (pendingLeadAssistant) {
				rounds.push({
					id: pendingLeadAssistant.id,
					title: "(开场助手消息)",
					messageCount: 1,
				});
			}
			current = {
				id: msg.id,
				title: msg.content.slice(0, 80),
				messageCount: 0,
			};
			pendingLeadAssistant = null;
		}
		if (current !== null) {
			current.messageCount++;
		}
	}
	if (current) rounds.push(current);
	else if (pendingLeadAssistant && rounds.length === 0) {
		rounds.push({
			id: pendingLeadAssistant.id,
			title: "(开场助手消息)",
			messageCount: 1,
		});
	}
	return rounds;
}

function scrollToMessage(id: string) {
	const el =
		cachedElements.get(id) ??
		document.querySelector('[data-ai-sidebar-id="' + CSS.escape(id) + '"]');
	if (!el) return;
	el.scrollIntoView({ behavior: "smooth", block: "start" });
	el.classList.add("ai-sidebar-flash");
	window.setTimeout(() => el?.classList.remove("ai-sidebar-flash"), 1500);
}

const UI_STYLES = `
  :host { all: initial; }
  * { box-sizing: border-box; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif; }
  .fab {
    position: fixed;
    right: 16px;
    top: 50%;
    transform: translateY(-50%);
    width: 44px;
    height: 44px;
    border-radius: 50%;
    background: #ffffff;
    border: 1px solid hsl(0, 0%, 92%);
    box-shadow: 0 4px 12px rgba(0, 0, 0, 0.1);
    cursor: pointer;
    display: flex;
    align-items: center;
    justify-content: center;
    transition: transform 0.15s ease, background 0.15s ease;
    z-index: 2147483647;
    padding: 0;
  }
  .fab:hover { transform: translateY(-50%) scale(1.06); background: hsl(0, 0%, 98%); }
  .fab:active { transform: translateY(-50%) scale(0.96); }
  .fab svg { width: 20px; height: 20px; color: hsl(222, 89%, 55%); }
  .panel {
    position: fixed;
    right: 16px;
    top: 80px;
    bottom: 80px;
    width: 320px;
    background: #ffffff;
    border: 1px solid hsl(0, 0%, 92%);
    border-radius: 12px;
    box-shadow: 0 8px 24px rgba(0, 0, 0, 0.12);
    display: flex;
    flex-direction: column;
    z-index: 2147483647;
    overflow: hidden;
  }
  .header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 12px 16px;
    border-bottom: 1px solid hsl(0, 0%, 92%);
    flex-shrink: 0;
  }
  .title {
    font-size: 13px;
    font-weight: 500;
    color: hsl(0, 0%, 9%);
  }
  .close-btn {
    background: none;
    border: none;
    cursor: pointer;
    padding: 4px;
    color: hsl(0, 0%, 45%);
    display: flex;
    border-radius: 4px;
  }
  .close-btn:hover { background: hsl(0, 0%, 96%); color: hsl(0, 0%, 9%); }
  .close-btn svg { width: 14px; height: 14px; }
  .list { flex: 1; overflow-y: auto; padding: 8px; }
  .item {
    display: flex;
    width: 100%;
    align-items: flex-start;
    gap: 10px;
    padding: 10px;
    border: none;
    border-radius: 8px;
    background: transparent;
    text-align: left;
    cursor: pointer;
    margin-bottom: 4px;
    transition: background 0.1s ease;
    font: inherit;
    color: inherit;
  }
  .item:hover { background: hsl(0, 0%, 98%); }
  .item:active { background: hsl(0, 0%, 95%); }
  .badge {
    flex-shrink: 0;
    width: 24px;
    height: 24px;
    border-radius: 50%;
    background: hsl(0, 0%, 98%);
    border: 1px solid hsl(0, 0%, 92%);
    display: flex;
    align-items: center;
    justify-content: center;
    font-size: 10px;
    color: hsl(0, 0%, 45%);
    font-weight: 500;
  }
  .item-content { flex: 1; min-width: 0; }
  .item-meta {
    display: block;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.05em;
    color: hsl(0, 0%, 60%);
    margin-bottom: 2px;
  }
  .item-title {
    display: block;
    font-size: 12px;
    color: hsl(0, 0%, 9%);
    word-wrap: break-word;
    line-height: 1.4;
  }
  .item-title-row { display: flex; align-items: flex-start; gap: 6px; }
  .item-title-row .item-title { flex: 1; }
  .item-actions { display: none; flex-shrink: 0; gap: 2px; }
  .item:hover .item-actions { display: inline-flex; }
  .item-action {
    background: none; border: none; cursor: pointer; padding: 0 2px; font-size: 11px; line-height: 1; border-radius: 3px;
    opacity: 0.55;
  }
  .item-action:hover { background: hsl(0, 0%, 92%); opacity: 1; }
  .item-summary {
    display: block;
    font-size: 10px;
    color: hsl(0, 0%, 45%);
    margin-top: 2px;
    line-height: 1.4;
    overflow: hidden;
    text-overflow: ellipsis;
    display: -webkit-box;
    -webkit-line-clamp: 2;
    -webkit-box-orient: vertical;
  }
  .item.current { background: hsl(217, 91%, 95%); border-left: 3px solid hsl(222, 89%, 55%); border-radius: 8px 4px 4px 8px; }
  .search-input {
    width: 100%;
    padding: 8px 12px;
    border: none;
    border-bottom: 1px solid hsl(0, 0%, 92%);
    font-size: 12px;
    outline: none;
    flex-shrink: 0;
  }
  .search-input:focus { border-bottom-color: hsl(222, 89%, 55%); }
  .summary-btn {
    background: none; border: none; cursor: pointer; padding: 4px; font-size: 14px; display: flex; border-radius: 4px;
  }
  .summary-btn:hover { background: hsl(0, 0%, 96%); }
  .summary-btn:disabled { opacity: 0.4; cursor: not-allowed; }
  .summary-modal {
    position: fixed; inset: 0; background: rgba(0,0,0,0.55); display: flex; align-items: center; justify-content: center; z-index: 2147483647;
  }
  .summary-box {
    background: hsl(0, 0%, 100%); border-radius: 10px; padding: 18px; width: 92vw; height: 88vh; max-width: 1100px; display: flex; flex-direction: column; gap: 12px; box-shadow: 0 8px 32px rgba(0,0,0,0.25);
  }
  .summary-title { font-size: 14px; font-weight: 600; color: hsl(0, 0%, 20%); }
  .summary-actions { display: flex; gap: 8px; flex-wrap: wrap; }
  .summary-actions button { padding: 6px 12px; border: 1px solid hsl(0, 0%, 85%); background: hsl(0, 0%, 98%); border-radius: 4px; cursor: pointer; font-size: 12px; }
  .summary-actions button:hover { background: hsl(0, 0%, 92%); }
  .summary-actions button.primary { background: hsl(222, 89%, 55%); color: white; border-color: hsl(222, 89%, 55%); }
  .summary-actions button.primary:hover { background: hsl(222, 89%, 48%); }
  .summary-text {
    flex: 1 1 auto; min-height: 0; padding: 10px; font-family: ui-monospace, monospace; font-size: 11px; line-height: 1.5; border: 1px solid hsl(0, 0%, 85%); border-radius: 4px; resize: none; overflow: auto; white-space: pre-wrap;
  }
  .empty {
    padding: 24px 16px;
    text-align: center;
    color: hsl(0, 0%, 60%);
    font-size: 12px;
  }
`;

const ICON_MESSAGE_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

const ICON_X_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

let fabDragX = 0;
let fabDragY = 0;

function loadFabPosition() {
	if (typeof chrome !== "undefined" && chrome.storage) {
		chrome.storage.local.get(
			"fabPosition",
			(r: { fabPosition?: { x: number; y: number } }) => {
				if (r.fabPosition && fabPosition === null) fabPosition = r.fabPosition;
			},
		);
	}
}

function saveFabPosition(x: number, y: number) {
	fabPosition = { x, y };
	if (typeof chrome !== "undefined" && chrome.storage) {
		chrome.storage.local.set({ fabPosition });
	}
}

function buildSummaryPrompt(): string {
	const userIdxList: number[] = [];
	currentMessages.forEach((m, idx) => {
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
		if (currentMessages[i].role === "assistant") {
			leadContext += `[前置助手消息]: ${currentMessages[i].content.slice(0, 800)}\n`;
		}
	}
	if (leadContext) text += `\n=== 前置上下文 ===\n${leadContext}\n`;
	userIdxList.forEach((userIdx, i) => {
		const userContent = currentMessages[userIdx].content;
		const cap = capturedByUser.get(userContent.slice(0, 200));
		const nextUserIdx = userIdxList[i + 1] ?? currentMessages.length;
		const assistants = currentMessages
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

function exportConversation() {
	const sid = location.pathname.match(/\/c\/([^/?]+)/)?.[1] || "";
	const rounds = groupIntoRounds(currentMessages);
	const capturedByUser = new Map<string, CapturedRound>();
	for (const r of chatRounds.values()) {
		if (r.request.content)
			capturedByUser.set(r.request.content.slice(0, 200), r);
	}
	const userIdxList: number[] = [];
	currentMessages.forEach((m, idx) => {
		if (m.role === "user") userIdxList.push(idx);
	});
	const buildJson = () => ({
		sessionId: sid,
		url: location.href,
		exportedAt: new Date().toISOString(),
		rounds: rounds.map((round, i) => {
			const userIdx = currentMessages.findIndex(
				(m) => m.id === round.id && m.role === "user",
			);
			const userContent =
				userIdx >= 0 ? currentMessages[userIdx].content : round.title;
			const cap = capturedByUser.get(userContent.slice(0, 200));
			let assistants: ExtractedMessage[] = [];
			if (userIdx >= 0) {
				const nextUserIdx =
					userIdxList[userIdxList.indexOf(userIdx) + 1] ??
					currentMessages.length;
				assistants = currentMessages
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
						? assistants.map((a) => ({
								text: a.content,
							}))
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
			r.responses.forEach((resp: any, idx: number) => {
				const label = resp.name || "Response " + (idx + 1);
				parts.push(`**${label}**: ${resp.text || ""}`, "");
			});
			return parts.join("\n");
		})
		.join("\n---\n\n");
	showExportModal(json, md, sid);
}

function showExportModal(json: string, md: string, sid: string) {
	if (!shadowRoot) return;
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
	const copyJsonBtn = document.createElement("button");
	copyJsonBtn.textContent = "📋 Copy JSON";
	copyJsonBtn.onclick = () =>
		navigator.clipboard.writeText(json).then(() => {
			copyJsonBtn.textContent = "✅ JSON copied";
			setTimeout(() => {
				copyJsonBtn.textContent = "📋 Copy JSON";
			}, 1500);
		});
	const copyMdBtn = document.createElement("button");
	copyMdBtn.textContent = "📋 Copy Markdown";
	copyMdBtn.onclick = () =>
		navigator.clipboard.writeText(md).then(() => {
			copyMdBtn.textContent = "✅ MD copied";
			setTimeout(() => {
				copyMdBtn.textContent = "📋 Copy Markdown";
			}, 1500);
		});
	const copyLinkBtn = document.createElement("button");
	copyLinkBtn.textContent = "🔗 Copy link";
	copyLinkBtn.onclick = () =>
		navigator.clipboard.writeText(location.href).then(() => {
			copyLinkBtn.textContent = "✅ Link copied";
			setTimeout(() => {
				copyLinkBtn.textContent = "🔗 Copy link";
			}, 1500);
		});
	const dlJsonBtn = document.createElement("button");
	dlJsonBtn.textContent = "💾 Download JSON";
	dlJsonBtn.onclick = () =>
		downloadBlob(
			"arena-" + (sid || "chat") + ".json",
			"application/json;charset=utf-8",
			json,
		);
	const dlMdBtn = document.createElement("button");
	dlMdBtn.textContent = "💾 Download .md";
	dlMdBtn.onclick = () =>
		downloadBlob(
			"arena-" + (sid || "chat") + ".md",
			"text/markdown;charset=utf-8",
			md,
		);
	const closeBtn = document.createElement("button");
	closeBtn.textContent = "✕ Close";
	closeBtn.onclick = () => {
		modal!.remove();
	};
	actions.appendChild(copyJsonBtn);
	actions.appendChild(copyMdBtn);
	actions.appendChild(copyLinkBtn);
	actions.appendChild(dlJsonBtn);
	actions.appendChild(dlMdBtn);
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

function downloadBlob(filename: string, mime: string, content: string) {
	const blob = new Blob([content], { type: mime });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = filename;
	a.click();
	URL.revokeObjectURL(url);
}

function showSummaryModal(promptText: string) {
	if (!shadowRoot) return;
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
	const copyBtn = document.createElement("button");
	copyBtn.textContent = "📋 Copy to clipboard";
	copyBtn.onclick = () => {
		navigator.clipboard.writeText(promptText).then(() => {
			copyBtn.textContent = "✅ Copied";
			setTimeout(() => {
				copyBtn.textContent = "📋 Copy to clipboard";
			}, 1500);
		});
	};
	const newTabBtn = document.createElement("button");
	newTabBtn.className = "primary";
	newTabBtn.textContent = "🚀 Open new arena.ai chat";
	newTabBtn.onclick = () => {
		// Domain is hardcoded; prompt is encodeURIComponent-wrapped — no injection possible.
		// Origin validation via URL() constructor provides defence-in-depth against open-redirect.
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
	};
	const pasteHereBtn = document.createElement("button");
	pasteHereBtn.textContent = "📥 Paste into current chat";
	pasteHereBtn.onclick = () => {
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
			pasteHereBtn.textContent = "✅ Pasted into chat box";
			setTimeout(() => {
				pasteHereBtn.textContent = "📥 Paste into current chat";
			}, 1500);
		} else {
			pasteHereBtn.textContent = "❌ No chat input found";
			setTimeout(() => {
				pasteHereBtn.textContent = "📥 Paste into current chat";
			}, 1500);
		}
	};
	const downloadBtn = document.createElement("button");
	downloadBtn.textContent = "💾 Download as .md";
	downloadBtn.onclick = () => {
		const blob = new Blob([promptText], {
			type: "text/markdown;charset=utf-8",
		});
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "arena-summary-prompt.md";
		a.click();
		URL.revokeObjectURL(url);
	};
	const closeBtn = document.createElement("button");
	closeBtn.textContent = "✕ Close";
	closeBtn.onclick = () => {
		modal!.remove();
	};
	actions.appendChild(copyBtn);
	actions.appendChild(pasteHereBtn);
	actions.appendChild(newTabBtn);
	actions.appendChild(downloadBtn);
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

async function summarizeRounds() {
	if (isSummarizing) return;
	isSummarizing = true;
	try {
		const prompt = buildSummaryPrompt();
		if (!prompt) {
			showSummaryModal(
				"(no rounds detected yet — wait for arena.ai to load the conversation)",
			);
			return;
		}
		showSummaryModal(prompt);
	} finally {
		isSummarizing = false;
	}
}

function buildFab(): HTMLElement {
	const btn = document.createElement("button");
	btn.className = "fab";
	if (fabPosition) {
		btn.style.right = "auto";
		btn.style.left = fabPosition.x + "px";
		btn.style.top = fabPosition.y + "px";
		btn.style.transform = "none";
	}
	btn.setAttribute(
		"aria-label",
		"Open message navigator (" + currentMessages.length + " messages)",
	);
	btn.title = currentMessages.length + " messages";
	// Parse SVG string via DOMParser to avoid innerHTML on a live element.
	const iconParser = new DOMParser();
	const iconDoc = iconParser.parseFromString(ICON_MESSAGE_SVG, "image/svg+xml");
	// parseFromString returns HTMLElement; SVG namespace document yields SVG element — cast through unknown.
	const svgEl = iconDoc.documentElement as unknown as SVGElement;
	if (svgEl) btn.appendChild(svgEl);
	btn.onclick = () => {
		isOpen = true;
		refreshUI();
	};
	btn.addEventListener("mousedown", (e) => {
		if ((e.target as HTMLElement).closest(".fab") !== btn) return;
		e.preventDefault();
		isDragging = true;
		fabDragX = e.clientX;
		fabDragY = e.clientY;
		const move = (me: MouseEvent) => {
			const dx = me.clientX - fabDragX;
			const dy = me.clientY - fabDragY;
			fabDragX = me.clientX;
			fabDragY = me.clientY;
			const r = btn.getBoundingClientRect();
			btn.style.left = r.left + dx + "px";
			btn.style.top = r.top + dy + "px";
			btn.style.right = "auto";
			btn.style.transform = "none";
		};
		const up = () => {
			document.removeEventListener("mousemove", move);
			document.removeEventListener("mouseup", up);
			isDragging = false;
			if (!btn.isConnected) return;
			const r = btn.getBoundingClientRect();
			saveFabPosition(r.left, r.top);
		};
		document.addEventListener("mousemove", move);
		document.addEventListener("mouseup", up);
	});
	return btn;
}

function lookupRoundSummary(roundId: string): string {
	for (const r of chatRounds.values()) {
		if (
			r.request.content &&
			(r.sessionId === roundId ||
				(cachedElements.has(roundId) && cachedElements.get(roundId) === null))
		) {
			return (r.response.aText || r.response.bText || "").slice(0, 120);
		}
	}
	return "";
}

function createRoundEl(
	round: { id: string; title: string; messageCount: number },
	idx: number,
): HTMLElement {
	const item = document.createElement("div");
	item.className = "item";
	item.dataset.roundId = round.id;
	item.dataset.roundIdx = String(idx);
	const badge = document.createElement("span");
	badge.className = "badge";
	badge.textContent = String(idx + 1);
	const content = document.createElement("span");
	content.className = "item-content";
	const meta = document.createElement("span");
	meta.className = "item-meta";
	meta.textContent =
		round.messageCount + " message" + (round.messageCount === 1 ? "" : "s");
	const titleRow = document.createElement("span");
	titleRow.className = "item-title-row";
	const title = document.createElement("span");
	title.className = "item-title";
	const s = roundSummaries.get(round.id);
	const currentTitle = s ? s.title : round.title;
	title.textContent = currentTitle;
	title.title = currentTitle;
	titleRow.appendChild(title);
	const actions = document.createElement("span");
	actions.className = "item-actions";
	const editBtn = document.createElement("button");
	editBtn.className = "item-action";
	editBtn.textContent = "✏️";
	editBtn.title = "Edit title";
	editBtn.onclick = (e) => {
		e.stopPropagation();
		const newTitle = prompt("Edit round title:", currentTitle);
		if (newTitle !== null && newTitle.trim()) {
			roundSummaries.set(round.id, {
				title: newTitle.trim().slice(0, 80),
				summary: "",
			});
			refreshUI();
		}
	};
	const copyBtn = document.createElement("button");
	copyBtn.className = "item-action";
	copyBtn.textContent = "📋";
	copyBtn.title = "Copy round content";
	// P1 #7 — use groupIntoRounds index range instead of unreliable DOM containment checks.
	copyBtn.onclick = (e) => {
		e.stopPropagation();
		const allRounds = groupIntoRounds(currentMessages);
		const rIdx = allRounds.findIndex((r) => r.id === round.id);
		if (rIdx < 0) return;
		const startIdx = currentMessages.findIndex((m) => m.id === round.id);
		const nextRound = allRounds[rIdx + 1];
		const endIdx = nextRound
			? currentMessages.findIndex((m) => m.id === nextRound.id)
			: currentMessages.length;
		const roundMsgs = currentMessages.slice(startIdx, endIdx);
		const txt = roundMsgs.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
		if (txt)
			navigator.clipboard.writeText(txt).then(() => {
				copyBtn.textContent = "✅";
				setTimeout(() => {
					copyBtn.textContent = "📋";
				}, 1200);
			});
	};
	const delBtn = document.createElement("button");
	delBtn.className = "item-action";
	delBtn.textContent = "🗑";
	delBtn.title = "Hide this round from sidebar";
	delBtn.onclick = (e) => {
		e.stopPropagation();
		hiddenRoundIds.add(round.id);
		refreshUI();
	};
	actions.appendChild(editBtn);
	actions.appendChild(copyBtn);
	actions.appendChild(delBtn);
	titleRow.appendChild(actions);
	content.appendChild(meta);
	content.appendChild(titleRow);
	const summary = document.createElement("span");
	summary.className = "item-summary";
	const sumText = s ? s.summary : lookupRoundSummary(round.id);
	summary.textContent = sumText;
	summary.title = sumText;
	if (sumText) content.appendChild(summary);
	item.appendChild(badge);
	item.appendChild(content);
	item.onclick = () => {
		scrollToMessage(round.id);
		currentRoundIdx = idx;
		isOpen = false;
		refreshUI();
	};
	return item;
}

function updateRoundEl(
	el: HTMLElement,
	round: { id: string; title: string; messageCount: number },
	idx: number,
) {
	const badge = el.querySelector(".badge");
	if (badge) badge.textContent = String(idx + 1);
	const meta = el.querySelector(".item-meta");
	if (meta)
		meta.textContent =
			round.messageCount + " message" + (round.messageCount === 1 ? "" : "s");
	const title = el.querySelector(".item-title") as HTMLElement | null;
	const summary = el.querySelector(".item-summary") as HTMLElement | null;
	if (title) {
		const s = roundSummaries.get(round.id);
		const currentTitle = s ? s.title : round.title;
		title.textContent = currentTitle;
		title.title = currentTitle;
	}
	if (summary) {
		const s = roundSummaries.get(round.id);
		const sumText = s ? s.summary : lookupRoundSummary(round.id);
		summary.textContent = sumText;
		summary.title = sumText;
		summary.style.display = sumText ? "" : "none";
	}
	el.dataset.roundIdx = String(idx);
}

function reconcileList(
	list: HTMLElement,
	rounds: Array<{ id: string; title: string; messageCount: number }>,
) {
	const byId = new Map<string, HTMLElement>();
	for (const child of [...list.children] as HTMLElement[]) {
		if (child.dataset.roundId) byId.set(child.dataset.roundId, child);
	}

	const q = searchQuery.toLowerCase().trim();
	const filtered = rounds
		.filter((r) => !hiddenRoundIds.has(r.id))
		.filter((r) => !q || r.title.toLowerCase().includes(q));

	if (filtered.length === 0) {
		for (const [, el] of byId) el.remove();
		const msg =
			list.querySelector(".empty") ||
			(() => {
				const e = document.createElement("div");
				e.className = "empty";
				list.appendChild(e);
				return e;
			})();
		msg.textContent = q
			? 'No matches for "' + searchQuery + '"'
			: "No messages detected";
		return;
	}
	const emptyEl = list.querySelector(".empty");
	if (emptyEl) emptyEl.remove();

	const newIds = new Set(filtered.map((r) => r.id));
	for (const [id, el] of byId) {
		if (!newIds.has(id)) {
			el.remove();
			byId.delete(id);
		}
	}

	filtered.forEach((round, idx) => {
		let el = byId.get(round.id);
		if (!el) {
			el = createRoundEl(round, idx);
		} else {
			updateRoundEl(el, round, idx);
		}
		if (list.children[idx] !== el) {
			list.insertBefore(el, list.children[idx] ?? null);
		}
	});
}

function refreshCurrentHighlight() {
	const list = shadowRoot?.querySelector(".list");
	if (!list) return;
	for (const item of list.querySelectorAll(".item")) {
		(item as HTMLElement).classList.toggle(
			"current",
			parseInt((item as HTMLElement).dataset.roundIdx || "-1") ===
				currentRoundIdx,
		);
	}
}

function setupScrollHighlight() {
	const list = shadowRoot?.querySelector(".list");
	if (!list) return;
	let ticking = false;
	list.addEventListener("scroll", () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			// Walk items to find which is most visible in the scroll viewport
			const items = list.querySelectorAll(".item");
			let bestIdx = currentRoundIdx;
			let bestArea = 0;
			const lr = list.getBoundingClientRect();
			items.forEach((item) => {
				const ir = item.getBoundingClientRect();
				const overlap =
					Math.min(ir.bottom, lr.bottom) - Math.max(ir.top, lr.top);
				if (overlap > bestArea) {
					bestArea = overlap;
					bestIdx = parseInt((item as HTMLElement).dataset.roundIdx || "0");
				}
			});
			if (bestIdx !== currentRoundIdx) {
				currentRoundIdx = bestIdx;
				refreshCurrentHighlight();
			}
			ticking = false;
		});
	});
}

function ensurePanelSkeleton(
	roundsCount: number,
	messagesCount: number,
): [HTMLElement, HTMLElement] {
	let panel = shadowRoot!.querySelector(".panel") as HTMLElement | null;
	if (panel) {
		const titleEl = panel.querySelector(".title");
		if (titleEl)
			titleEl.textContent =
				roundsCount + " rounds · " + messagesCount + " messages";
		const sumBtn = panel.querySelector(
			".summary-btn",
		) as HTMLButtonElement | null;
		if (sumBtn) sumBtn.disabled = false;
		return [panel, panel.querySelector(".list") as HTMLElement];
	}
	panel = document.createElement("div");
	panel.className = "panel";
	const header = document.createElement("div");
	header.className = "header";
	const title = document.createElement("span");
	title.className = "title";
	title.textContent = roundsCount + " rounds · " + messagesCount + " messages";
	header.appendChild(title);
	const orderBtn = document.createElement("button");
	orderBtn.className = "summary-btn";
	orderBtn.textContent = reverseOrder ? "🔃" : "🔄";
	orderBtn.title = reverseOrder
		? "Newest first (click to reverse)"
		: "Oldest first (click to reverse)";
	orderBtn.onclick = () => {
		reverseOrder = !reverseOrder;
		refreshUI();
	};
	header.appendChild(orderBtn);
	const exportBtn = document.createElement("button");
	exportBtn.className = "summary-btn";
	exportBtn.textContent = "📤";
	exportBtn.title = "Export current conversation (JSON / Markdown / link)";
	exportBtn.onclick = exportConversation;
	header.appendChild(exportBtn);
	const sumBtn = document.createElement("button");
	sumBtn.className = "summary-btn";
	sumBtn.textContent = "✨";
	sumBtn.title = "AI summarize rounds";
	sumBtn.onclick = summarizeRounds;
	header.appendChild(sumBtn);
	const closeBtn = document.createElement("button");
	closeBtn.className = "close-btn";
	closeBtn.setAttribute("aria-label", "Close");
	// Parse SVG string via DOMParser to avoid innerHTML on a live element.
	const xParser = new DOMParser();
	const xDoc = xParser.parseFromString(ICON_X_SVG, "image/svg+xml");
	const xSvg = xDoc.documentElement as unknown as SVGElement;
	if (xSvg) closeBtn.appendChild(xSvg);
	closeBtn.onclick = () => {
		isOpen = false;
		refreshUI();
	};
	header.appendChild(closeBtn);
	panel.appendChild(header);
	const searchInput = document.createElement("input");
	searchInput.className = "search-input";
	searchInput.type = "text";
	searchInput.placeholder = "Search rounds...";
	searchInput.oninput = () => {
		searchQuery = searchInput.value.toLowerCase().trim();
		refreshUI();
	};
	panel.appendChild(searchInput);
	const list = document.createElement("div");
	list.className = "list";
	panel.appendChild(list);
	shadowRoot!.appendChild(panel);
	return [panel, list];
}

// P0 #1 — extractMessages only runs when the cooldown has elapsed, preventing full-DOM scans
// on every MutationObserver trigger (which fires on ANY DOM change in arena.ai).
function refreshUI() {
	if (!shadowRoot) return;

	// P0 #1 — only re-extract when EXTRACT_COOLDOWN_MS has passed since last call.
	const now = Date.now();
	if (now - lastExtractTs > EXTRACT_COOLDOWN_MS) {
		currentMessages = extractMessages();
		lastExtractTs = now;
	}

	const newMessages = currentMessages; // may be stale during cooldown; that is intentional
	const rounds = reverseOrder
		? groupIntoRounds(newMessages).reverse()
		: groupIntoRounds(newMessages);
	const newIds = rounds.map((r) => r.id);

	// Fast-path: nothing structurally changed AND same UI mode AND no search active
	if (
		!searchQuery &&
		!prevSearchActive &&
		newIds.length === prevRoundIds.length &&
		newIds[newIds.length - 1] === prevRoundIds[prevRoundIds.length - 1] &&
		isOpen === prevIsOpen &&
		shadowRoot.querySelector(".panel")
	) {
		const titleEl = shadowRoot.querySelector(".title");
		if (titleEl)
			titleEl.textContent =
				rounds.length + " rounds · " + newMessages.length + " messages";
		prevRoundIds = newIds;
		return;
	}
	prevRoundIds = newIds;
	prevIsOpen = isOpen;
	prevSearchActive = !!searchQuery;

	// Ensure styles
	if (!shadowRoot.querySelector("style")) {
		shadowRoot.replaceChildren(); // clear all children without triggering innerHTML setter
		const s = document.createElement("style");
		s.textContent = UI_STYLES;
		shadowRoot.appendChild(s);
	}

	if (newMessages.length === 0) return;

	if (!isOpen) {
		// FAB: clean old content, keep styles
		const existing = shadowRoot.querySelector(".fab, .panel");
		if (existing) existing.remove();
		shadowRoot.appendChild(buildFab());
		return;
	}

	// Panel: remove FAB, preserve skeleton, reconcile items
	const oldFab = shadowRoot.querySelector(".fab");
	if (oldFab) oldFab.remove();
	const savedScroll = shadowRoot.querySelector(".list")?.scrollTop ?? 0;
	const [, list] = ensurePanelSkeleton(rounds.length, newMessages.length);
	reconcileList(list, rounds);
	if (savedScroll > 0) list.scrollTop = savedScroll;
	if (!highlightInitialized && !searchQuery) {
		currentRoundIdx = 0;
		highlightInitialized = true;
		setupScrollHighlight();
	}
	refreshCurrentHighlight();
}

function ensureUI() {
	if (shadowRoot) return;
	const host = document.createElement("div");
	host.id = "__edge_ai_sidebar_host";
	host.style.cssText =
		"all: initial; position: fixed; top: 0; left: 0; width: 0; height: 0; z-index: 2147483647;";
	const target = document.body || document.documentElement;
	target.appendChild(host);
	shadowRoot = host.attachShadow({ mode: "closed" });
	refreshUI();
	loadFabPosition();
}

// P1 #3 — module-level timer ref avoids polluting the global window object.
function setupObserver() {
	if (observer) observer.disconnect();
	observer = new MutationObserver(() => {
		if (isDragging) return;
		if (debounceTimer !== null) clearTimeout(debounceTimer);
		debounceTimer = setTimeout(() => {
			if (!isDragging) {
				refreshUI();
				setupHistoryTitleEditing();
			}
		}, 250);
	});
	if (document.body) {
		observer.observe(document.body, {
			childList: true,
			subtree: true,
			characterData: true,
		});
	}
	setupHistoryTitleEditing();
}

function setupHistoryTitleEditing() {
	const items = document.querySelectorAll('a[href*="/c/"]');
	items.forEach((item) => {
		const itemEl = item as HTMLElement;
		const href = item.getAttribute("href") || "";
		const sid = href.match(/\/c\/([^/?]+)/)?.[1];
		if (!sid) return;
		if (itemEl.dataset.aiSidebarEditable === "1") return;
		itemEl.dataset.aiSidebarEditable = "1";
		itemEl.title = (itemEl.title || "") + " | Double-click to rename";
		const storageKey = "historyTitle_" + sid;
		try {
			chrome.storage.local.get(storageKey, (r) => {
				const custom = (r as Record<string, string>)[storageKey];
				if (custom && item.textContent && item.textContent.trim() !== custom) {
					applyCustomTitle(item, custom);
				}
			});
		} catch (_e) {
			/* intentionally empty — chrome.storage.local.get may fail due to quota or permissions */
		}
		itemEl.addEventListener(
			"dblclick",
			(e) => {
				e.preventDefault();
				e.stopPropagation();
				const target =
					(e.target as HTMLElement).closest("span, div, p") || itemEl;
				const oldText = (target.textContent || "").trim();
				const input = document.createElement("input");
				input.type = "text";
				input.value = oldText;
				input.style.cssText =
					"width: 100%; min-width: 0; font: inherit; background: white; border: 1px solid #3b82f6; padding: 2px 4px; border-radius: 3px; color: black;";
				target.textContent = "";
				target.appendChild(input);
				input.focus();
				input.select();
				let saved = false;
				const save = () => {
					if (saved) return;
					saved = true;
					const newText = (input.value || "").trim() || oldText;
					try {
						chrome.storage.local.set({ [storageKey]: newText });
					} catch (_e) {
						/* intentionally empty — chrome.storage.local.set may fail; title is still shown in-memory */
					}
					target.textContent = newText;
				};
				const cancel = () => {
					if (saved) return;
					saved = true;
					target.textContent = oldText;
				};
				input.addEventListener("blur", save);
				input.addEventListener("keydown", (ev) => {
					ev.stopPropagation();
					if (ev.key === "Enter") {
						ev.preventDefault();
						input.blur();
					}
					if (ev.key === "Escape") {
						input.removeEventListener("blur", save);
						cancel();
					}
				});
			},
			true,
		);
	});
}

function applyCustomTitle(anchor: Element, customTitle: string) {
	const candidates = anchor.querySelectorAll("span, div, p");
	let best: HTMLElement | null = null;
	let bestLen = 0;
	candidates.forEach((el) => {
		const t = (el.textContent || "").trim();
		if (t.length > bestLen) {
			best = el as HTMLElement;
			bestLen = t.length;
		}
	});
	if (best && bestLen > 0) (best as HTMLElement).textContent = customTitle;
	else (anchor as HTMLElement).textContent = customTitle;
}

// P1 #2 + P1 #3 — two separate timers: capture polling (2 s) and UI refresh (3 s).
// Both use module-level IDs so they can be cleared without touching window.
function setupPeriodicPush() {
	if (pollIntervalId !== null || refreshIntervalId !== null) return; // guard: idempotent, no double-start
	pollIntervalId = setInterval(() => {
		if (!isDragging) pollCaptures();
	}, 2000);
	refreshIntervalId = setInterval(() => {
		if (!isDragging) refreshUI();
	}, 3000);
}

if (document.body) {
	ensureUI();
	setupObserver();
	setupPeriodicPush();
} else {
	document.addEventListener("DOMContentLoaded", () => {
		ensureUI();
		setupObserver();
		setupPeriodicPush();
	});
}
