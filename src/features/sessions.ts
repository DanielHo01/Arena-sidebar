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
import {
	storageAvailable,
	storageGet,
	storageGetAll,
	storageRemove,
	storageSet,
} from "../platform/storage";

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
	},
};

// ─── Storage key ────────────────────────────────────────────────────────────────────

export const FOLDERS_KEY = "edge-ai-sidebar:folders";

function saveToStorage() {
	void storageSet(FOLDERS_KEY, {
		folders: foldersState.folders,
		sessions: Array.from(foldersState.sessions.entries()),
	});
}

async function loadFromStorage(): Promise<void> {
	const data = (await storageGet(FOLDERS_KEY)) as
		{ folders: SessionFolder[]; sessions: [string, SessionMeta][] } | undefined;
	if (data?.folders?.length) foldersState.folders = data.folders;
	if (data?.sessions?.length) foldersState.sessions = new Map(data.sessions);
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
	saveToStorage();
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
	saveToStorage();
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
 * Set the user's custom title for a session — the single write path for all user
 * rename operations (double-click and context-menu rename). Preserves all other
 * metadata fields including the existing customTitle value.
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
	saveToStorage();
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
	saveToStorage();
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
			setSessionCustomTitle(sid, value.trim());
			keysToRemove.push(key);
		}
	}
	if (keysToRemove.length === 0) return;
	if (await storageRemove(keysToRemove)) {
		console.log(
			`[AI Sidebar] migrateHistoryTitles: migrated ${keysToRemove.length} key(s)`,
		);
	} else {
		console.warn(
			"[AI Sidebar] migrateHistoryTitles: failed to remove old keys",
		);
	}
}
