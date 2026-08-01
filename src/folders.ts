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

// ─── Arena DOM Integration ───────────────────────────────────────────────────────────────

/**
 * Phase 10A Commit 1: Inject the 🗂 Session Library entry into Arena's native
 * quick-nav bar (Child 2 of the floating sidebar).
 *
 * Arena DOM path:
 *   [class*="sidebar-wrapper"]          ← sidebar wrapper
 *     .children[0]                         ← floating container
 *       .children[1]                       ← bg-sidebar
 *         .children[0]                     ← floating sidebar root
 *           Child 2 = quick-nav (New Chat / Leaderboard / Search)
 */

const ARENA_FOLDER_ENTRY_ATTR = "data-ai-sidebar-folder-entry";

/**
 * Locate the Arena sidebar-wrapper element.
 * Returns null if Arena DOM is not present (graceful degradation).
 */
function findArenaSidebarWrapper(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[class*="sidebar-wrapper"]');
}

/**
 * Navigate to the quick-nav container (Child 2) inside the floating sidebar.
 * This is where New Chat / Leaderboard / Search live.
 */
function findArenaQuickNavContainer(): HTMLElement | null {
	const wrapper = findArenaSidebarWrapper();
	if (!wrapper) return null;
	const floating = wrapper.children[0];
	if (!floating) return null;
	const bgSidebar = floating.children[1];
	if (!bgSidebar) return null;
	const floatingRoot = bgSidebar.children[0];
	if (!floatingRoot) return null;
	const quickNav = floatingRoot.children[2];
	if (!quickNav || quickNav.tagName !== "DIV") return null;
	return quickNav as HTMLElement;
}

/**
 * Build the 🗂 Session Library anchor element.
 * Does NOT open the modal — that is handled by the onclick.
 */
function buildArenaFolderEntry(onOpen: () => void): HTMLAnchorElement {
	const a = document.createElement("a");
	a.setAttribute(ARENA_FOLDER_ENTRY_ATTR, "1");
	a.className =
		"peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md border border-transparent pr-2 text-sidebar-foreground shadow-none transition-[color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[active=true]:bg-sidebar-accent group-data-[active=true]:text-sidebar-accent-foreground group-data-[active=true]:hover:bg-sidebar-accent/90";

	const icon = document.createElement("span");
	icon.className = "flex aspect-square h-[32px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-base leading-none";
	icon.textContent = "🗂";
	a.appendChild(icon);

	const label = document.createElement("span");
	label.className = "flex-1 truncate text-sm font-medium";
	label.textContent = "Session Library";
	a.appendChild(label);

	a.addEventListener("click", (e) => {
		e.preventDefault();
		onOpen();
	});
	return a;
}

/**
 * Inject the 🗂 Session Library entry into Arena's quick-nav bar.
 * Safe to call multiple times — checks for existing entry before inserting.
 *
 * @param onOpen  Callback to open the Session Library panel.
 */
export function ensureArenaFolderEntry(onOpen: () => void): void {
	// Guard: skip if already injected
	if (document.querySelector(`[${ARENA_FOLDER_ENTRY_ATTR}]`)) return;

	const container = findArenaQuickNavContainer();
	if (!container) {
		// Arena DOM not ready yet — will be retried by content.ts bootstrap / observer
		return;
	}

	const entry = buildArenaFolderEntry(onOpen);
	const firstChild = container.firstElementChild;
	if (firstChild) {
		container.insertBefore(entry, firstChild);
	} else {
		container.appendChild(entry);
	}
}

/**
 * Remove the injected entry (used when cleaning up or switching routes).
 */
export function removeArenaFolderEntry(): void {
	const entry = document.querySelector(`[${ARENA_FOLDER_ENTRY_ATTR}]`);
	if (entry) entry.remove();
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
		folderId: existing?.folderId ?? INBOX_ID,
		roundCount,
		messageCount,
		createdAt: existing?.createdAt ?? now,
		updatedAt: now,
		url,
	});
	saveToStorage();
}
