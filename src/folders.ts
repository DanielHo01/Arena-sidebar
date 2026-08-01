// Session folder management — groups sessions into named folders.
// MVP scope: CRUD folders, move sessions between folders.
// Public exports:
//   foldersState   — shared mutable state
//   initFolders    — load persisted folders from storage
//   addSessionToFolder — assign a session to a folder
//   createFolder — create a new folder
//   deleteFolder — delete a folder (sessions go to inbox)
//   renameFolder — rename a folder
//   getSessionsInFolder — list sessions in a folder

import type { SessionFolder, SessionMeta } from "./types";
import { contextValid } from "./state";

// ─── Default folders ─────────────────────────────────────────────────────────────────

export const INBOX_ID = "inbox";
export const ARCHIVE_ID = "archive";

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

const FOLDERS_KEY = "edge-ai-sidebar:folders";

function saveToStorage() {
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

export function deleteFolder(folderId: string): void {
	if (folderId === INBOX_ID || folderId === ARCHIVE_ID) return; // cannot delete system folders
	foldersState.folders = foldersState.folders.filter((f) => f.id !== folderId);
	// Move orphaned sessions to inbox.
	for (const [sid, meta] of foldersState.sessions) {
		if (meta.folderId === folderId) {
			foldersState.sessions.set(sid, { ...meta, folderId: INBOX_ID });
		}
	}
	saveToStorage();
}

export function renameFolder(folderId: string, newName: string): void {
	const trimmed = newName.trim();
	if (!trimmed) return;
	const folder = foldersState.folders.find((f) => f.id === folderId);
	if (folder) {
		folder.name = trimmed.slice(0, 40);
		folder.updatedAt = Date.now();
		saveToStorage();
	}
}

export function getSessionsInFolder(folderId: string): SessionMeta[] {
	return Array.from(foldersState.sessions.values()).filter(
		(s) => s.folderId === folderId,
	);
}

// ─── UI Setup ───────────────────────────────────────────────────────────────────────

/** Call once from content.ts setup to load persisted folders. */
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
		folderId: existing?.folderId ?? INBOX_ID,
		roundCount,
		messageCount,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		url,
	});
	saveToStorage();
}
