// features/sessions.ts — the session folder/session index: state, CRUD,
// persistence, and the subscription that keeps the index in step with the
// conversation store.
//
// No DOM in here beyond reading document.title in setupSessionMetaSync (the
// subscriber side of the seam added in Phase 3). Everything that injects into
// Arena's own sidebar lives in ui/arenaSidebar.ts; the history-link context menu
// lives in ui/contextMenu.ts. Split out of the 759-line folders.ts in Phase 5.

import type { Disposer, SessionFolder, SessionMeta } from "../types";
import { onStoreChange } from "../conversationStore";
import { storageAvailable, storageGetAll } from "../platform/storage";
import { storageRemove, storageSetDetailed } from "../platform/storageWrites";

// ─── Default folders ─────────────────────────────────────────────────────────────────

export const INBOX_ID = "inbox";
// Not exported: no external consumer. Folder deletion has no UI since phase10a,
// so nothing outside this module needs to special-case the archive folder.
const ARCHIVE_ID = "archive";

const DEFAULT_FOLDERS: SessionFolder[] = [
	{ id: INBOX_ID, name: "Inbox", createdAt: 0, updatedAt: 0 },
	{ id: ARCHIVE_ID, name: "Archive", createdAt: 0, updatedAt: 0 },
];

// ─── Module state ────────────────────────────────────────────────────────────────────

export const foldersState = {
	folders: [...DEFAULT_FOLDERS] as SessionFolder[],
	sessions: new Map<string, SessionMeta>(),
	activeFolderId: INBOX_ID,
	visible: false, // Sprint 9: toggle folder panel visibility

	/** Reset all folders (call on extension reload). */
	reset() {
		this.folders = [...DEFAULT_FOLDERS];
		this.sessions.clear();
		this.activeFolderId = INBOX_ID;
		this.visible = false;
		// Drop any queued folder-index write so a reloaded/test-reset context
		// does not chain its first write behind a stale, unrelated snapshot.
		foldersWriteChain = Promise.resolve();
	},
};

// ─── Storage keys ────────────────────────────────────────────────────────────────────

/** The folder list lives under this one key. */
export const FOLDERS_KEY = "edge-ai-sidebar:folders";

/**
 * Prefix for per-session metadata keys. Each session's metadata lives under
 * its OWN key (prefix + sessionId) instead of inside one combined index.
 *
 * The combined design had a lost-update bug: the whole `{ folders, sessions }`
 * index was rewritten as one value, so two tabs renaming DIFFERENT sessions at
 * the same time clobbered each other (the last whole-index write won, dropping
 * the other tab's rename). Per-session keys make concurrent renames of
 * different sessions independent — they write different keys, so nothing is
 * lost. Same-session writes stay ordered by the write chain below.
 *
 * The prefix must NOT collide with SESSION_SNAPSHOT_PREFIX
 * ("edge-ai-sidebar:session:"), because quota eviction deletes every key that
 * starts with the snapshot prefix — renames are irreplaceable and must never
 * be evicted. "session-meta" does not match that prefix.
 */
export const SESSION_META_PREFIX = "edge-ai-sidebar:session-meta:";

/** The storage key holding one session's metadata. */
export function sessionMetaKey(sessionId: string): string {
	return SESSION_META_PREFIX + sessionId;
}

// Folder/session writes are serialized through this chain, and the state is
// re-read when the write actually runs rather than when it is scheduled. That
// ordering matters for the SAME session: a rename (setSessionCustomTitle) and
// a store upsert (upsertSessionMetaFromStore) can both fire within the same
// tick, and each used to snapshot the value synchronously before firing an
// un-ordered async write. A pre-rename snapshot could then resolve after the
// rename's write and land stale. Chaining the writes and reading at write time
// makes that unrepresentable: the last write always carries the newest state.
let foldersWriteChain: Promise<unknown> = Promise.resolve();

/** Persist the folder list (the one shared collection). */
function saveFolders(): void {
	foldersWriteChain = foldersWriteChain.then(async () => {
		// #22: folders are small but irreplaceable — when the area is full,
		// evict old session snapshots (re-derivable) instead of dropping them.
		await storageSetDetailed(FOLDERS_KEY, foldersState.folders, {
			evictOnQuota: true,
		});
	});
}

/** Persist one session's metadata to its own key. */
function saveSessionMeta(sessionId: string): void {
	foldersWriteChain = foldersWriteChain.then(async () => {
		const meta = foldersState.sessions.get(sessionId);
		if (!meta) return;
		await storageSetDetailed(sessionMetaKey(sessionId), meta, {
			evictOnQuota: true,
		});
	});
}

async function loadFromStorage(): Promise<void> {
	const all = await storageGetAll();

	// One-time migration from the combined `{ folders, sessions }` format the
	// index used to live in, under this same FOLDERS_KEY. Split it into the
	// folder list plus per-session meta keys. Idempotent: once migrated the
	// folders value is an array, so this branch is skipped on later loads.
	const legacy = all[FOLDERS_KEY] as
		| SessionFolder[]
		| { folders?: SessionFolder[]; sessions?: [string, SessionMeta][] }
		| undefined;
	if (legacy && !Array.isArray(legacy) && typeof legacy === "object") {
		if (legacy.folders?.length) foldersState.folders = legacy.folders;
		for (const [sid, meta] of legacy.sessions ?? []) {
			if (!sid) continue;
			foldersState.sessions.set(sid, meta);
			void storageSetDetailed(sessionMetaKey(sid), meta, {
				evictOnQuota: true,
			});
		}
		void storageSetDetailed(FOLDERS_KEY, foldersState.folders, {
			evictOnQuota: true,
		});
	} else if (Array.isArray(legacy) && legacy.length) {
		foldersState.folders = legacy;
	}

	// Load every per-session meta key. Merge (set) rather than replace, so a
	// session upserted into memory while storageGetAll was in flight is not
	// dropped by the load.
	for (const [key, value] of Object.entries(all)) {
		if (!key.startsWith(SESSION_META_PREFIX)) continue;
		const sid = key.slice(SESSION_META_PREFIX.length);
		if (sid && value && typeof value === "object") {
			foldersState.sessions.set(sid, value as SessionMeta);
		}
	}
}

// ─── Public API ─────────────────────────────────────────────────────────────────────

export function addSessionToFolder(
	sessionId: string,
	title: string,
	folderId: string,
): void {
	const existing = foldersState.sessions.get(sessionId);
	const now = Date.now();
	foldersState.sessions.set(sessionId, {
		sessionId: sessionId,
		title: title || "Untitled",
		customTitle: existing?.customTitle,
		folderId: folderId ?? INBOX_ID,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
	});
	saveSessionMeta(sessionId);
}

export function createFolder(name: string): SessionFolder | null {
	const trimmed = name.trim();
	if (!trimmed) return null;
	const folder: SessionFolder = {
		id: "folder-" + Date.now() + "-" + Math.random().toString(36).slice(2, 7),
		name: trimmed.slice(0, 40),
		createdAt: Date.now(),
		updatedAt: Date.now(),
	};
	foldersState.folders.push(folder);
	saveFolders();
	return folder;
}

export function getSessionsInFolder(folderId: string): SessionMeta[] {
	return Array.from(foldersState.sessions.values()).filter(
		(s) => s.folderId === folderId,
	);
}

/** Read session metadata from the in-memory index (populated by initFolders). */
export function getSessionMeta(sessionId: string): SessionMeta | undefined {
	return foldersState.sessions.get(sessionId);
}

/**
 * Set the user's custom title for a session — the single write path for user
 * rename (the right-click context menu; #17 removed double-click rename).
 * Preserves every other metadata field.
 */
export function setSessionCustomTitle(
	sessionId: string,
	customTitle: string,
): void {
	const existing = foldersState.sessions.get(sessionId);
	const now = Date.now();
	const trimmed = customTitle.trim();
	foldersState.sessions.set(sessionId, {
		sessionId,
		title: existing?.title ?? "未命名会话",
		customTitle: trimmed || undefined,
		folderId: existing?.folderId ?? INBOX_ID,
		roundCount: existing?.roundCount,
		messageCount: existing?.messageCount,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		url: existing?.url,
	});
	saveSessionMeta(sessionId);
}

/** Call once from content.ts bootstrap to load persisted folders from storage. */
export function initFolders(): Promise<void> {
	return loadFromStorage();
}

/**
 * Called by conversationStore.saveToStorage() to keep sessionMeta in sync.
 * Upserts session metadata from the current conversation store state.
 */
export function upsertSessionMetaFromStore(
	sessionId: string,
	title: string,
	roundCount: number,
	messageCount: number,
	url: string,
): void {
	const existing = foldersState.sessions.get(sessionId);
	const now = Date.now();
	foldersState.sessions.set(sessionId, {
		sessionId,
		title: title || "未命名会话",
		customTitle: existing?.customTitle,
		folderId: existing?.folderId ?? INBOX_ID,
		roundCount,
		messageCount,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		url,
	});
	// Per-session key: writing before initFolders() has finished is safe — this
	// only touches one session's key, so it cannot erase the other sessions the
	// load is about to read back.
	saveSessionMeta(sessionId);
}

/**
 * Keep the session index in step with the conversation store.
 *
 * This is the subscriber half of the seam that replaced
 * conversationStore -> folders (a data layer importing the UI injection layer).
 * The store emits a snapshot after each successful save; we derive the display
 * title here, because reading document.title is DOM knowledge that does not
 * belong in the data layer either.
 *
 * Call once from content.ts bootstrap.
 */
export function setupSessionMetaSync(): Disposer {
	return onStoreChange((snap) => {
		const rawTitle = document.title || "";
		const pageTitle = rawTitle.replace(/\s*[-_] Arena.*$/i, "").trim();
		const sessionTitle =
			(pageTitle && pageTitle.length > 1 ? pageTitle : snap.firstRoundTitle) ||
			"未命名会话";
		upsertSessionMetaFromStore(
			snap.sessionId,
			sessionTitle,
			snap.roundCount,
			snap.messageCount,
			location.href,
		);
	});
}

/**
 * One-time migration: scan chrome.storage.local for legacy historyTitle_* keys and
 * migrate their values into foldersState.sessions as customTitle. Called once on
 * bootstrap after initFolders() so that the sessions index is already populated.
 *
 * After migration the old keys are deleted so that future startup does not re-migrate.
 */
export async function migrateHistoryTitles(): Promise<void> {
	if (!storageAvailable()) return;
	const all = await storageGetAll();
	const keysToRemove: string[] = [];
	for (const [key, value] of Object.entries(all)) {
		const match = /^historyTitle_(.+)$/.exec(key);
		if (match && typeof value === "string" && value.trim()) {
			const sid = match[1];
			if (!sid) continue;
			setSessionCustomTitle(sid, value.trim());
			keysToRemove.push(key);
		}
	}
	if (keysToRemove.length === 0) return;
	if (!(await storageRemove(keysToRemove))) {
		console.warn(
			"[AI Sidebar] migrateHistoryTitles: failed to remove old keys",
		);
	}
}
