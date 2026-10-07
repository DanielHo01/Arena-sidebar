// conversationStore — canonical message store: data + persistence.
//
// The store object below owns the canonical messages/rounds, snapshot
// persistence (save/load), the change pub/sub, and the maintenance ops
// loadFromStorage needs (bindDomAnchors, rebuildRounds,
// dropTombstonedMessages — they stay so the dependency runs one way).
// Everything that merges external data in or mutates messages
// (refreshStore, addCapturedMessage, editMessageContent, the upsert
// primitive) lives in ./conversationSync.ts.
//
// DOM binding runs as a separate pass: fingerprint → domId.

import type {
	Disposer,
	MessageOrigin,
	SidebarMessage,
	SidebarRound,
} from "./types";
import { cachedElements } from "./state";
import { storageGet } from "./platform/storage";
import {
	SESSION_SNAPSHOT_PREFIX,
	evictOldestSnapshots,
	storageSetDetailed,
} from "./platform/storageWrites";
import { baseKey, fingerprint } from "./core/fingerprint";
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

/** Narrows unknown storage payloads to the snapshot shape saveToStorage writes. */
function isSessionSnapshot(value: unknown): value is {
	messages: SidebarMessage[];
	rounds?: SidebarRound[];
	sessionId: string;
} {
	if (typeof value !== "object" || value === null) return false;
	const v = value as { messages?: unknown; sessionId?: unknown };
	return Array.isArray(v.messages) && typeof v.sessionId === "string";
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
		const key = SESSION_SNAPSHOT_PREFIX + this.sessionId;
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
		const key = SESSION_SNAPSHOT_PREFIX + sessionId;
		const raw = await storageGet(key);
		if (
			!isSessionSnapshot(raw) ||
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
		return { msgs: this.messages.length, rounds: this.rounds.length };
	},
};

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
