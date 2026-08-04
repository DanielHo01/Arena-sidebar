// conversationStore — canonical message store with multi-source merge.
// Architecture: bootstrap > capture > dom (priority order).
//
// Bootstrap: reads page initialization data from __NEXT_DATA__ or script tags.
// Capture:   accumulates messages from inject-hook.js intercepted API requests.
// DOM:      extracts visible messages AND binds DOM elements as anchors.
//
// The store maintains canonical messages + computed rounds.
// DOM binding runs as a separate pass: fingerprint → domId.

import type { SidebarMessage, SidebarRound, MessageOrigin } from "./types";
import { cachedElements, contextValid, invalidateContext } from "./state";
import { upsertSessionMetaFromStore } from "./folders";

// ─── Stable fingerprint for content matching ────────────────────────────────────────

function fingerprint(text: string): string {
	// Normalize: trim, collapse whitespace, lowercase.
	// Use first 200 chars as stable key.
	const normalized = text
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.slice(0, 200);
	return "fp-" + normalized.length + "-" + normalized.slice(0, 80);
}

// ─── Conversation store ─────────────────────────────────────────────────────────────

export const conversationStore = {
	/** Canonical messages in chronological order (user/assistant interleaved). */
	messages: [] as SidebarMessage[],

	/** Canonical rounds derived from messages. */
	rounds: [] as SidebarRound[],

	/** Last origin that contributed messages. */
	lastOrigin: null as MessageOrigin | null,

	/** Current session ID (set on bootstrap from URL path). */
	sessionId: "" as string,

	/** Reset the store (call on new page load). */
	reset() {
		this.messages = [];
		this.rounds = [];
		this.lastOrigin = null;
	},

	/** Save current messages + rounds to chrome.storage.local (keyed by sessionId). */
	saveToStorage(): void {
		if (!contextValid) return;
		if (!this.sessionId || this.messages.length === 0) return;
		if (typeof chrome === "undefined" || !chrome.storage) return;
		const key = `edge-ai-sidebar:session:${this.sessionId}`;
		const payload = {
			messages: this.messages,
			rounds: this.rounds,
			lastSavedAt: Date.now(),
			sessionId: this.sessionId,
		};
		try {
			chrome.storage.local.set({ [key]: payload }, () => {
				if (chrome.runtime.lastError) {
					invalidateContext();
					return;
				}
				// Sprint 9: keep sessionMeta in sync (outside callback - fire and forget)
				// Use page title (character/persona name) as session title
				const rawTitle = document.title || "";
				const pageTitle = rawTitle.replace(/\s*[-_] Arena.*$/i, "").trim();
				const sessionTitle =
					(pageTitle && pageTitle.length > 1
						? pageTitle
						: this.rounds[0]?.title) || "未命名会话";
				try {
					upsertSessionMetaFromStore(
						this.sessionId,
						sessionTitle,
						this.rounds.length,
						this.messages.length,
						location.href,
					);
				} catch {
					/* folders storage may fail silently */
				}
			});
		} catch {
			/* intentionally empty — extension context invalidated */
		}
	},

	/**
	 * Load cached messages + rounds from chrome.storage.local for the given sessionId.
	 * Rejects if no cached data found or sessionId mismatch.
	 * Resolves with restored count on success.
	 */
	loadFromStorage(
		sessionId: string,
	): Promise<{ msgs: number; rounds: number } | null> {
		if (!contextValid) return Promise.resolve(null);
		if (!sessionId) return Promise.resolve(null);
		if (typeof chrome === "undefined" || !chrome.storage)
			return Promise.resolve(null);
		const key = `edge-ai-sidebar:session:${sessionId}`;
		return new Promise((resolve) => {
			try {
				chrome.storage.local.get(key, (result) => {
					if (chrome.runtime.lastError) {
						invalidateContext();
						resolve(null);
						return;
					}
					// eslint-disable-next-line @typescript-eslint/no-explicit-any
					const raw = result[key] as any;
					if (
						!raw ||
						!raw.messages ||
						raw.messages.length === 0 ||
						raw.sessionId !== sessionId
					) {
						resolve(null);
						return;
					}
					// Sprint 7: migrate persisted 'source' field → 'origin'
					this.messages = (raw.messages as SidebarMessage[]).map((m) => {
						const old = m as SidebarMessage & { source?: MessageOrigin };
						return { ...m, origin: old.source ?? "dom" } as SidebarMessage;
					});
					this.rounds = (raw.rounds ?? []) as SidebarRound[];
					this.lastOrigin = "bootstrap";
					bindDomAnchors();
					console.log(
						`[AI Sidebar] persistence: restored ${this.messages.length} msgs, ${this.rounds.length} rounds`,
					);
					resolve({ msgs: this.messages.length, rounds: this.rounds.length });
				});
			} catch {
				/* intentionally empty — extension context invalidated */
				resolve(null);
			}
		});
	},
};

// ─── Round computation ───────────────────────────────────────────────────────────────

export function computeRounds(msgs: SidebarMessage[]): SidebarRound[] {
	const rounds: SidebarRound[] = [];
	let current: SidebarRound | null = null;
	let pendingLead: SidebarMessage | null = null;
	let roundIdx = 0;
	// Sprint 8: preview tracking
	let currentFirstUser: SidebarMessage | null = null;
	let currentFirstAssistant: SidebarMessage | null = null;
	let currentAssistantCount = 0;

	const pushRound = (r: SidebarRound) => {
		// Sprint 8: fill preview fields before pushing — but never clobber values the
		// caller already set explicitly. The lead-assistant round sets assistantPreview
		// and assistantCount by hand; currentFirst*/currentAssistantCount are still
		// null/0 at that point, so plain assignment used to wipe them back.
		r.userPreview ??= currentFirstUser?.content.slice(0, 60) || undefined;
		r.assistantPreview ??=
			currentFirstAssistant?.content.slice(0, 100) || undefined;
		r.assistantCount ??= currentAssistantCount;
		rounds.push(r);
	};

	for (const msg of msgs) {
		if (msg.role === "assistant" && current === null) {
			// lead assistant (before first user)
			pendingLead = msg;
			continue;
		}
		if (msg.role === "user") {
			// Push previous round
			if (current !== null) {
				pushRound(current);
				roundIdx++;
			} else if (pendingLead) {
				// Lead assistant round — no user, use assistant as preview
				const leadRound: SidebarRound = {
					id: pendingLead.id,
					title: pendingLead.content.slice(0, 80) || "(开场助手消息)",
					messageCount: 1,
					index: roundIdx,
					hasAnchor: !!pendingLead.domId,
					// Sprint 8: lead assistant shows as both user and assistant preview
					userPreview: undefined,
					assistantPreview: pendingLead.content.slice(0, 100),
					assistantCount: 1,
				};
				pushRound(leadRound);
				roundIdx++;
			}
			// Start new round with user
			currentFirstUser = msg;
			currentFirstAssistant = null;
			currentAssistantCount = 0;
			current = {
				id: msg.id,
				title: msg.content.slice(0, 80),
				messageCount: 0,
				index: roundIdx,
				hasAnchor: false,
				userPreview: undefined,
				assistantPreview: undefined,
			};
			pendingLead = null;
		}
		if (current !== null) {
			current.messageCount++;
			if (msg.domId) current.hasAnchor = true;
			if (msg.role === "assistant") {
				currentAssistantCount++;
				if (currentFirstAssistant === null) currentFirstAssistant = msg;
			}
		}
	}

	if (current) {
		pushRound(current);
		roundIdx++;
	} else if (pendingLead && rounds.length === 0) {
		// Lead assistant only — no rounds at all
		const leadRound: SidebarRound = {
			id: pendingLead.id,
			title: pendingLead.content.slice(0, 80) || "(开场助手消息)",
			messageCount: 1,
			index: 0,
			hasAnchor: !!pendingLead.domId,
			userPreview: undefined,
			assistantPreview: pendingLead.content.slice(0, 100),
			assistantCount: 1,
		};
		pushRound(leadRound);
	}

	return rounds;
}

// ─── Merge helpers ─────────────────────────────────────────────────────────────────

/** Add a message to the store if not already present (by fingerprint or id). */
function upsertMessage(msg: SidebarMessage): boolean {
	const fp = msg.fingerprint || fingerprint(msg.content);
	const fpKey = fp;

	// Check by fingerprint first (robust across re-extraction).
	const existing = conversationStore.messages.find(
		(m) => (m.fingerprint || fingerprint(m.content)) === fpKey,
	);
	if (existing) {
		// Merge: preserve existing domId even if new source doesn't have it.
		if (!existing.domId && msg.domId) existing.domId = msg.domId;
		// Prefer capture origin over dom origin.
		if (msg.origin === "capture" && existing.origin !== "capture") {
			existing.content = msg.content;
			existing.capturedAt = msg.capturedAt;
			existing.origin = "capture";
		}
		return false; // not new
	}

	conversationStore.messages.push(msg);
	return true; // was new
}

// ─── Bootstrap: extract initial messages from page markup ───────────────────────────

export function extractBootstrapMessages(): SidebarMessage[] {
	const results: SidebarMessage[] = [];

	// Try __NEXT_DATA__ JSON embedded in page.
	try {
		const nextDataEl = document.getElementById("__NEXT_DATA__");
		if (nextDataEl && nextDataEl.textContent) {
			const nd = JSON.parse(nextDataEl.textContent);
			const msgs = findMessagesInObject(nd, [], 0);
			for (const m of msgs) {
				results.push({ ...m, origin: "bootstrap" });
			}
		}
	} catch (_e) {
		/* intentionally empty — __NEXT_DATA__ may not exist on all pages */
	}

	// Also scan inline script tags for Arena message structures.
	try {
		const scripts = document.querySelectorAll("script");
		for (const s of Array.from(scripts)) {
			const txt = s.textContent || "";
			const matches = txt.matchAll(
				/"(content|text|userMessage|assistantMessage)"\s*:\s*"((?:[^"\\]|\\.){10,5000})"/g,
			);
			for (const m of matches) {
				const content = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n");
				if (content.length > 5) {
					const fp = fingerprint(content);
					if (
						!results.find(
							(r) => (r.fingerprint || fingerprint(r.content)) === fp,
						)
					) {
						results.push({
							id: "boot-" + results.length,
							role: detectRole(content),
							content,
							roundIndex: -1,
							origin: "bootstrap",
							fingerprint: fp,
						});
					}
				}
			}
		}
	} catch (_e) {
		/* intentionally empty — script scanning may throw */
	}

	return results;
}

function findMessagesInObject(
	obj: unknown,
	path: string[],
	depth: number,
): SidebarMessage[] {
	if (depth > 8 || !obj || typeof obj !== "object") return [];
	const results: SidebarMessage[] = [];

	// Terminal check: does this object look like a message?
	const o = obj as Record<string, unknown>;
	if (
		typeof o.content === "string" &&
		o.content.length > 5 &&
		(o.role === "user" || o.role === "assistant")
	) {
		results.push({
			id: "boot-" + path.join("-") + "-" + results.length,
			role: o.role as "user" | "assistant",
			content: String(o.content).slice(0, 10000),
			roundIndex: -1,
			origin: "bootstrap",
			fingerprint: fingerprint(String(o.content)),
		});
	}

	for (const [k, v] of Object.entries(obj)) {
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) {
				results.push(
					...findMessagesInObject(v[i], [...path, k, String(i)], depth + 1),
				);
			}
		} else if (v && typeof v === "object") {
			results.push(...findMessagesInObject(v, [...path, k], depth + 1));
		}
	}

	return results;
}

function detectRole(content: string): "user" | "assistant" {
	// Heuristic: short, question-like → user; long, complete sentences → assistant.
	if (content.length < 200) return "user";
	const questionMarks = (content.match(/[?？]/g) || []).length;
	if (questionMarks > 2) return "user";
	return "assistant";
}

// ─── Capture: add captured messages to store ───────────────────────────────────────

export function addCapturedMessage(msg: SidebarMessage): boolean {
	msg.origin = "capture";
	return upsertMessage(msg);
}

// ─── DOM: add extracted messages to store (no anchor binding here) ──────────────────

export function addDomMessages(
	domMessages: SidebarMessage[],
): SidebarMessage[] {
	const added: SidebarMessage[] = [];
	for (const m of domMessages) {
		const fp = fingerprint(m.content);
		const added_msg: SidebarMessage = {
			id: m.id,
			role: m.role === "system" ? "assistant" : m.role,
			content: m.content,
			roundIndex: -1,
			origin: "dom",
			fingerprint: fp,
		};
		if (upsertMessage(added_msg)) added.push(added_msg);
	}
	return added;
}

// ─── Anchor binding: bind DOM elements to canonical messages by fingerprint ─────────

/** After DOM extraction, bind DOM element ids to canonical messages.
 *  This runs after extractMessages() sets data-ai-sidebar-id on elements. */
export function bindDomAnchors() {
	// 1) 清理已失效的 msg.domId（元素已从 DOM 回收）
	for (const msg of conversationStore.messages) {
		if (msg.domId) {
			const el = cachedElements.get(msg.domId);
			if (!el || !el.isConnected) {
				msg.domId = undefined;
			}
		}
	}
	// 2) 清理已回收的 cachedElements 条目
	for (const [id, el] of cachedElements) {
		if (!el.isConnected) cachedElements.delete(id);
	}
	// 3) 重新绑定当前 DOM 元素
	cachedElements.forEach((el, domId) => {
		const text = el.textContent?.trim().replace(/\s+/g, " ") || "";
		if (text.length < 5) return;
		const fp = fingerprint(text);
		// Find matching canonical message by fingerprint (first match only).
		for (const msg of conversationStore.messages) {
			if (!msg.domId && (msg.fingerprint || fingerprint(msg.content)) === fp) {
				msg.domId = domId;
				break; // 避免一条消息绑多个 anchor
			}
		}
	});
}

// ─── Rebuild rounds from canonical messages ─────────────────────────────────────────

export function rebuildRounds() {
	// Assign roundIndex to each message.
	let currentRound = -1;
	for (const msg of conversationStore.messages) {
		if (msg.role === "assistant" && currentRound === -1) {
			// lead assistant, stays in same round
		} else if (msg.role === "user") {
			currentRound++;
		}
		msg.roundIndex = currentRound === -1 ? 0 : currentRound;
	}
	conversationStore.rounds = computeRounds(conversationStore.messages);
}

// ─── Full refresh: merge all sources and rebuild ───────────────────────────────────

export function refreshStore(opts: {
	bootstrap?: SidebarMessage[];
	capture?: SidebarMessage[];
	dom?: SidebarMessage[];
	bindAnchors?: boolean;
}) {
	const { bootstrap = [], capture = [], dom = [], bindAnchors = true } = opts;
	const hadDom = dom.length > 0;

	// P3 fix: skip if nothing new to add (avoids O(n) rebuildRounds on every call).
	if (bootstrap.length === 0 && capture.length === 0 && dom.length === 0) {
		return;
	}

	// Priority merge: bootstrap → capture → dom.
	for (const m of bootstrap) {
		upsertMessage({ ...m, origin: "bootstrap" });
	}
	for (const m of capture) {
		upsertMessage({ ...m, origin: "capture" });
	}
	for (const m of dom) {
		const fp = fingerprint(m.content);
		const existing = conversationStore.messages.find(
			(r) => (r.fingerprint || fingerprint(r.content)) === fp,
		);
		if (!existing) {
			upsertMessage({
				id: m.id,
				role: m.role === "system" ? "assistant" : m.role,
				content: m.content,
				roundIndex: -1,
				origin: "dom",
				fingerprint: fp,
			});
		}
	}

	// Sprint 3.2: always bind anchors to keep DOM ↔ store in sync (even if no new messages).
	if (bindAnchors) bindDomAnchors();

	// Compute rounds only when DOM content changed (P3).
	if (bootstrap.length > 0 || capture.length > 0 || hadDom) {
		rebuildRounds();
	}

	// Set lastOrigin to the highest-priority origin that contributed.
	if (capture.length > 0) conversationStore.lastOrigin = "capture";
	else if (bootstrap.length > 0) conversationStore.lastOrigin = "bootstrap";
	else if (dom.length > 0) conversationStore.lastOrigin = "dom";
}

// ─── Scroll to round: navigate to the round's DOM anchor ─────────────────────────

export function scrollToRound(roundId: string): boolean {
	const msg = conversationStore.messages.find((m) => m.id === roundId);
	if (!msg) return false;

	// Try direct DOM id first.
	if (msg.domId) {
		const el = cachedElements.get(msg.domId);
		if (el) {
			el.scrollIntoView({ behavior: "smooth", block: "start" });
			(el as HTMLElement).classList.add("ai-sidebar-flash");
			setTimeout(
				() => (el as HTMLElement).classList.remove("ai-sidebar-flash"),
				1500,
			);
			return true;
		}
	}

	// Try page-level query.
	const el = document.querySelector(
		'[data-ai-sidebar-id="' + CSS.escape(msg.domId || msg.id) + '"]',
	);
	if (el) {
		el.scrollIntoView({ behavior: "smooth", block: "start" });
		(el as HTMLElement).classList.add("ai-sidebar-flash");
		setTimeout(
			() => (el as HTMLElement).classList.remove("ai-sidebar-flash"),
			1500,
		);
		return true;
	}

	return false;
}

/**
 * Return all messages belonging to the given roundId.
 * Reads from conversationStore.rounds to find the round boundaries,
 * then slices conversationStore.messages accordingly.
 */
export function getMessagesForRound(roundId: string): SidebarMessage[] {
	const rounds = conversationStore.rounds;
	const idx = rounds.findIndex((r) => r.id === roundId);
	if (idx < 0) return [];
	const startMsgIdx = conversationStore.messages.findIndex(
		(m) => m.id === rounds[idx].id,
	);
	if (startMsgIdx < 0) return [];
	const endIdx =
		idx + 1 < rounds.length
			? conversationStore.messages.findIndex((m) => m.id === rounds[idx + 1].id)
			: conversationStore.messages.length;
	return conversationStore.messages.slice(
		startMsgIdx,
		endIdx > startMsgIdx ? endIdx : conversationStore.messages.length,
	);
}
