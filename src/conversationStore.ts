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
import { cachedElements, panel } from "./state";
import {
	evictOldestSnapshots,
	storageGet,
	storageSetDetailed,
} from "./platform/storage";
import { baseKey, fingerprint, withOccurrences } from "./core/fingerprint";
import { computeRounds } from "./core/rounds";
import { deletedMessageKeys, tombstoneKey } from "./rounds";

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

// ─── Proactive snapshot trim ─────────────────────────────────────────────────────────
//
// saveToStorage runs on every settled mutation batch, so the count-cap scan
// (a full get(null)) is throttled: at most one trim per minute per page load.

let lastTrimAt = 0;
const TRIM_THROTTLE_MS = 60_000;

function scheduleSnapshotTrim(): void {
	const now = Date.now();
	if (now - lastTrimAt < TRIM_THROTTLE_MS) return;
	lastTrimAt = now;
	void evictOldestSnapshots();
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

	/**
	 * Save current messages + rounds to chrome.storage.local (keyed by
	 * sessionId). Resolves true when the write landed.
	 *
	 * Storage hygiene (#22/#23): the write retries once past a quota error
	 * after evicting the oldest snapshots, and each success schedules a
	 * throttled trim (newest 50 snapshots within a 6MB byte budget — a
	 * 100-round session snapshots at ~1MB, so bytes are the real guard).
	 * Persisted messages
	 * drop `domId`: anchor ids are per-page-load (cachedElements is
	 * in-memory), so a stored domId can never rebind after a restart —
	 * loadFromStorage calls bindDomAnchors() to rebuild them from the live
	 * DOM instead. Full `content` IS kept: restore-after-restart must render
	 * even when the DOM is gone, which an id/fingerprint-only payload could
	 * not do.
	 */
	async saveToStorage(): Promise<boolean> {
		if (!this.sessionId || this.messages.length === 0) return false;
		const key = `edge-ai-sidebar:session:${this.sessionId}`;
		const payload = {
			messages: this.messages.map(({ domId: _domId, ...rest }) => rest),
			rounds: this.rounds,
			lastSavedAt: Date.now(),
			sessionId: this.sessionId,
			// feeds the byte-budget half of evictOldestSnapshots without a
			// re-measure pass; approximate (self-size excluded) by ~10 chars.
			bytes: 0,
		};
		payload.bytes = JSON.stringify(payload).length;
		const result = await storageSetDetailed(key, payload, {
			evictOnQuota: true,
		});
		if (!result.ok) return false;
		// Subscribers (folders' session index) are notified only after the write
		// actually landed, preserving the old ordering guarantee.
		emitStoreChange();
		scheduleSnapshotTrim();
		return true;
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
		// #15: a tombstone may have landed after this payload was written — drop
		// the ghosts and recompute the rounds that referenced them. The caller
		// loads tombstones first (content.ts rebuildForCurrentRoute), so the live
		// set is complete by the time this runs.
		dropTombstonedMessages();
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

	// #15: tombstoned messages never come back, however often the DOM
	// re-extracts them.
	if (deletedMessageKeys.has(tombstoneKey(base, occ))) return false;

	const existing = conversationStore.messages.find(
		(m) => baseKey(m) === base && (m.occurrence ?? 0) === occ,
	);
	if (existing) {
		// Merge: preserve existing domId even if new source doesn't have it.
		if (!existing.domId && msg.domId) existing.domId = msg.domId;
		// #15: a user edit wins over every re-extract — the overlay is keyed
		// by the ORIGINAL fingerprint, which is exactly what the DOM returns.
		if (existing.edited) return false;
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

// ─── Local message edit (#15) ──────────────────────────────────────────────────

/**
 * Replace one message's content with the user's correction. The fingerprint
 * deliberately still keys the DOM original, so re-extracts merge into this
 * message (and lose to the overlay via upsertMessage) instead of duplicating
 * it, and DOM anchors keep binding. Returns false when the id is unknown or
 * the text is empty/unchanged.
 *
 * Extension-visible only — arena.ai itself is never touched (it exposes no
 * message edit API; help.arena.ai documents session delete only).
 */
export function editMessageContent(
	messageId: string,
	newContent: string,
): boolean {
	const msg = conversationStore.messages.find((m) => m.id === messageId);
	const trimmed = newContent.trim();
	if (!msg || !trimmed || trimmed === msg.content) return false;
	if (!msg.edited) msg.editedFrom = msg.content;
	msg.content = trimmed;
	msg.edited = true;
	msg.editedAt = Date.now();
	rebuildRounds();
	void conversationStore.saveToStorage();
	// renderKey compares round ids, which an edit does not move — without this
	// the fast path would swallow the re-render and the row would show stale
	// text until something else changed.
	panel.lastRenderKey = "";
	return true;
}

/**
 * Drop live messages whose tombstones arrived after they did — the cross-tab
 * delete path (another tab's 🗑️) and the stale-payload path share it.
 * Returns true when anything was dropped (callers re-render on true).
 */
export function dropTombstonedMessages(): boolean {
	const before = conversationStore.messages.length;
	conversationStore.messages = conversationStore.messages.filter(
		(m) => !deletedMessageKeys.has(tombstoneKey(baseKey(m), m.occurrence ?? 0)),
	);
	if (conversationStore.messages.length === before) return false;
	rebuildRounds();
	void conversationStore.saveToStorage();
	return true;
}
