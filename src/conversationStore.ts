// conversationStore — canonical message store with multi-source merge.
// Architecture: bootstrap > capture > dom (priority order).
//
// Bootstrap: reads page initialization data from __NEXT_DATA__ or script tags.
// Capture:   accumulates messages from inject-hook.js intercepted API requests.
// DOM:      extracts visible messages AND binds DOM elements as anchors.
//
// The store maintains canonical messages + computed rounds.
// DOM binding runs as a separate pass: fingerprint → domId.

import type {
	Disposer,
	MessageOrigin,
	SidebarMessage,
	SidebarRound,
} from "./types";
import { cachedElements } from "./state";
import { storageGet, storageSet } from "./platform/storage";
import { baseKey, fingerprint, withOccurrences } from "./core/fingerprint";
import { computeRounds } from "./core/rounds";

// ─── Change subscription ──────────────────────────────────────────────────────────────
//
// This is the seam that keeps the data layer from importing the UI layer.
// conversationStore used to call folders.upsertSessionMetaFromStore() directly
// after each successful write, which made the data layer depend on 760 lines of
// CRUD + Arena DOM injection + context menu + inline CSS. It now emits a
// snapshot and folders.ts subscribes (setupSessionMetaSync).

/** What a subscriber needs to update the session index. No DOM, no storage. */
export interface StoreSnapshot {
	sessionId: string;
	messageCount: number;
	roundCount: number;
	/** First round's title, for callers that need a fallback name. */
	firstRoundTitle: string;
}

type StoreListener = (snapshot: StoreSnapshot) => void;
const storeListeners = new Set<StoreListener>();

/** Subscribe to successful saves. Returns a Disposer. */
export function onStoreChange(listener: StoreListener): Disposer {
	storeListeners.add(listener);
	return () => {
		storeListeners.delete(listener);
	};
}

/**
 * Notify subscribers. A listener that throws is logged and skipped: one broken
 * subscriber must not abort the save or starve the others.
 */
function emitStoreChange(): void {
	const snapshot: StoreSnapshot = {
		sessionId: conversationStore.sessionId,
		messageCount: conversationStore.messages.length,
		roundCount: conversationStore.rounds.length,
		firstRoundTitle: conversationStore.rounds[0]?.title ?? "",
	};
	for (const listener of storeListeners) {
		try {
			listener(snapshot);
		} catch (error) {
			console.warn("[AI Sidebar] store listener threw:", error);
		}
	}
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
	async saveToStorage(): Promise<void> {
		if (!this.sessionId || this.messages.length === 0) return;
		const key = `edge-ai-sidebar:session:${this.sessionId}`;
		const payload = {
			messages: this.messages,
			rounds: this.rounds,
			lastSavedAt: Date.now(),
			sessionId: this.sessionId,
		};
		if (!(await storageSet(key, payload))) return;
		// Subscribers (folders' session index) are notified only after the write
		// actually landed, preserving the old ordering guarantee.
		emitStoreChange();
	},

	/**
	 * Load cached messages + rounds from chrome.storage.local for the given sessionId.
	 * Rejects if no cached data found or sessionId mismatch.
	 * Resolves with restored count on success.
	 */
	async loadFromStorage(
		sessionId: string,
	): Promise<{ msgs: number; rounds: number } | null> {
		if (!sessionId) return null;
		const key = `edge-ai-sidebar:session:${sessionId}`;
		// eslint-disable-next-line @typescript-eslint/no-explicit-any
		const raw = (await storageGet(key)) as any;
		if (
			!raw ||
			!raw.messages ||
			raw.messages.length === 0 ||
			raw.sessionId !== sessionId
		) {
			return null;
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
		return { msgs: this.messages.length, rounds: this.rounds.length };
	},
};

// ─── Merge helpers ─────────────────────────────────────────────────────────────────

/** Add a message to the store if not already present (by content + occurrence). */
function upsertMessage(msg: SidebarMessage): boolean {
	const base = baseKey(msg);
	const occ = msg.occurrence ?? 0;
	msg.fingerprint = base;
	msg.occurrence = occ;

	const existing = conversationStore.messages.find(
		(m) => baseKey(m) === base && (m.occurrence ?? 0) === occ,
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
	} catch {
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
							origin: "bootstrap",
							fingerprint: fp,
						});
					}
				}
			}
		}
	} catch {
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
	// Capture arrives one message at a time, so its occurrence index is the
	// number of already-merged capture messages with the same content. That
	// lines up with the DOM's own numbering for the normal case; if the hook
	// installed late and missed earlier repeats, the worst case is that this
	// message merges into the wrong occurrence and keeps DOM text instead of
	// capture text — no message or round is lost.
	const base = fingerprint(msg.content);
	let n = 0;
	for (const m of conversationStore.messages) {
		if (m.origin === "capture" && baseKey(m) === base) n++;
	}
	msg.fingerprint = base;
	msg.occurrence = n;
	return upsertMessage(msg);
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

	// Priority merge: bootstrap → capture → dom. Each source is numbered
	// independently, so repeats inside one source survive while the same message
	// seen by two sources still merges.
	for (const m of withOccurrences(bootstrap)) {
		upsertMessage({ ...m, origin: "bootstrap" });
	}
	for (const m of withOccurrences(capture)) {
		upsertMessage({ ...m, origin: "capture" });
	}
	for (const m of withOccurrences(dom)) {
		upsertMessage({
			...m,
			role: m.role === "system" ? "assistant" : m.role,
			origin: "dom",
		});
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
