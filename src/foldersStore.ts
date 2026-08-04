// foldersStore — pure data layer for session folder management.
// All state and storage I/O lives here. UI code imports from here or from ./folders.
//
// Public exports:
//   foldersState    — shared mutable session/folder index
//   initFolders     — load persisted data from chrome.storage
//   addSessionToFolder      — assign/move session to folder
//   setSessionCustomTitle   — user rename (single write path)
//   upsertSessionMetaFromStore — keep sessionMeta in sync with conversationStore
//   migrateHistoryTitles     — one-time legacy migration
//   getSessionsInFolder     — read sessions in a folder
//   getSessionMeta           — read single session metadata

import type { SessionFolder, SessionMeta } from "./types";
import { contextValid } from "./state";

// ─── Constants ─────────────────────────────────────────────────────────────────────

export const INBOX_ID = "inbox";
export const ARCHIVE_ID = "archive";

export const FOLDERS_KEY = "edge-ai-sidebar:folders";

const DEFAULT_FOLDERS: SessionFolder[] = [
	{ id: INBOX_ID, name: "Inbox", createdAt: 0, updatedAt: 0 },
	{ id: ARCHIVE_ID, name: "Archive", createdAt: 0, updatedAt: 0 },
];

// ─── Module state ─────────────────────────────────────────────────────────────────

export const foldersState = {
	folders: [...DEFAULT_FOLDERS] as SessionFolder[],
	sessions: new Map<string, SessionMeta>(),
	activeFolderId: INBOX_ID,
	visible: false,

	/** Reset to defaults. Call on extension reload. */
	reset() {
		this.folders = [...DEFAULT_FOLDERS];
		this.sessions.clear();
		this.activeFolderId = INBOX_ID;
		this.visible = false;
	},
};

// ─── Storage I/O ─────────────────────────────────────────────────────────────────

function saveToStorage(): void {
	if (!contextValid) return;
	if (typeof chrome === "undefined" || !chrome.storage) return;
	try {
		chrome.storage.local.set(
			{
				[FOLDERS_KEY]: {
					folders: foldersState.folders,
					sessions: Array.from(foldersState.sessions.entries()),
				},
			},
			() => {
				if (chrome.runtime.lastError) {
					// Mark context invalid so future calls bail early
				}
			},
		);
	} catch {
		/* storage write may fail if context is invalidated */
	}
}

function loadFromStorage(): Promise<void> {
	if (typeof chrome === "undefined" || !chrome.storage)
		return Promise.resolve();
	return new Promise((resolve) => {
		try {
			chrome.storage.local.get(FOLDERS_KEY, (r) => {
				try {
					const data = (r as Record<string, unknown>)[FOLDERS_KEY] as
						| {
								folders: SessionFolder[];
								sessions: [string, SessionMeta][];
						  }
						| undefined;
					if (data?.folders?.length) {
						foldersState.folders = data.folders;
					}
					if (data?.sessions?.length) {
						foldersState.sessions = new Map(data.sessions);
					}
				} catch {
					/* ignore parse errors */
				}
				resolve();
			});
		} catch {
			resolve();
		}
	});
}

// ─── Pub/sub for cross-module state-change notifications ───────────────────────────────

type ChangeListener = () => void;
const changeListeners = new Set<ChangeListener>();

export function subscribeFoldersChange(listener: ChangeListener): () => void {
	changeListeners.add(listener);
	return () => changeListeners.delete(listener);
}

function notifyChange(): void {
	for (const l of changeListeners) {
		try { l(); } catch { /* ignore listener errors */ }
	}
}

/**
 * Listen to chrome.storage changes so cross-tab or cross-session updates to
 * folders/sessions are reflected in the current tab's in-memory state.
 * Calls notifyChange() to trigger re-renders in UI modules.
 */
export function setupFoldersStorageSync(): void {
	if (typeof chrome === "undefined" || !chrome.storage) return;
	if (!contextValid) return;
	chrome.storage.onChanged.addListener((changes) => {
		if (!(FOLDERS_KEY in changes)) return;
		const { newValue } = changes[FOLDERS_KEY] as {
			newValue?: { folders: SessionFolder[]; sessions: [string, SessionMeta][] };
		};
		if (!newValue) return;
		foldersState.folders = newValue.folders ?? foldersState.folders;
		if (newValue.sessions) {
			foldersState.sessions = new Map(newValue.sessions);
		}
		notifyChange();
	});
}

// ─── Session write operations ────────────────────────────────────────────────────

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

/**
 * Set the user's custom title for a session — the single write path for all user
 * rename operations (double-click and context-menu rename). Preserves all other
 * metadata fields.
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

/**
 * Called by conversationStore.saveToStorage() to keep sessionMeta in sync.
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

// ─── Session read operations ──────────────────────────────────────────────────────

/** Read all sessions in a folder. */
export function getSessionsInFolder(folderId: string): SessionMeta[] {
	return Array.from(foldersState.sessions.values()).filter(
		(s) => s.folderId === folderId,
	);
}

/** Read a single session's metadata. */
export function getSessionMeta(sessionId: string): SessionMeta | undefined {
	return foldersState.sessions.get(sessionId);
}

// ─── Bootstrap ─────────────────────────────────────────────────────────────────

/** Load persisted folders from storage. Call once during content script bootstrap. */
export function initFolders(): Promise<void> {
	return loadFromStorage();
}

// ─── Legacy migration ─────────────────────────────────────────────────────────────

/**
 * One-time migration: scan chrome.storage.local for legacy historyTitle_* keys and
 * migrate their values into foldersState.sessions as customTitle.
 * Called once on bootstrap after initFolders().
 * Deletes old keys after migration so future startup does not re-migrate.
 */
export function migrateHistoryTitles(): Promise<void> {
	if (
		typeof chrome === "undefined" ||
		!chrome.storage ||
		!chrome.storage.local
	) {
		return Promise.resolve();
	}
	return new Promise((resolve) => {
		chrome.storage.local.get(null, (all) => {
			if (chrome.runtime.lastError) {
				console.warn("[AI Sidebar] migrateHistoryTitles: storage unavailable");
				resolve();
				return;
			}
			const keysToRemove: string[] = [];
			for (const [key, value] of Object.entries(all)) {
				const match = /^historyTitle_(.+)$/.exec(key);
				if (match && typeof value === "string" && value.trim()) {
					const sid = match[1];
					setSessionCustomTitle(sid, value.trim());
					keysToRemove.push(key);
				}
			}
			if (keysToRemove.length === 0) {
				resolve();
				return;
			}
			chrome.storage.local.remove(keysToRemove, () => {
				if (chrome.runtime.lastError) {
					console.warn("[AI Sidebar] migrateHistoryTitles: failed to remove old keys");
				} else {
					console.log(
						`[AI Sidebar] migrateHistoryTitles: migrated ${keysToRemove.length} key(s)`,
					);
				}
				resolve();
			});
		});
	});
}
