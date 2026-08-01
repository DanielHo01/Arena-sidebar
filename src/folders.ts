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
	icon.className =
		"flex aspect-square h-[32px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-base leading-none";
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

// ─── Arena History Context Menu ───────────────────────────────────────────────────────────────

/**
 * Inject a right-click context menu on Arena's native history links (a[href*="/c/"]).
 * Shows "✏️ Rename" and "📁 Move to folder ▶" with a folder sub-menu.
 * Click-outside and Escape close the menu.
 * MutationObserver rebinds new links added by Arena SPA navigation.
 */
export function setupHistoryContextMenu(): void {
	const styleId = "ai-sidebar-ctx-style";
	if (!document.getElementById(styleId)) {
		const s = document.createElement("style");
		s.id = styleId;
		s.textContent = `
		.ai-sidebar-ctx {
			position: fixed;
			z-index: 999999;
			min-width: 196px;
			background: rgba(255,255,255,0.98);
			border: 1px solid rgba(0,0,0,0.10);
			border-radius: 8px;
			box-shadow: 0 8px 24px rgba(0,0,0,0.14);
			padding: 4px 0;
			font-family: Inter,system-ui,sans-serif;
			font-size: 13px;
			color: #374151;
			user-select: none;
		}
		.ai-sidebar-ctx-item {
			display: flex;
			align-items: center;
			gap: 8px;
			padding: 6px 12px;
			cursor: pointer;
			border-radius: 4px;
			margin: 0 4px;
		}
		.ai-sidebar-ctx-item:hover { background: rgba(0,0,0,0.05); }
		.ai-sidebar-ctx-sep {
			height: 1px;
			background: rgba(0,0,0,0.06);
			margin: 4px 8px;
		}
		.ai-sidebar-ctx-sub {
			display: none;
			position: absolute;
			left: 100%;
			top: 0;
			min-width: 160px;
			background: rgba(255,255,255,0.98);
			border: 1px solid rgba(0,0,0,0.10);
			border-radius: 8px;
			box-shadow: 0 8px 24px rgba(0,0,0,0.14);
			padding: 4px 0;
		}
		.ai-sidebar-ctx-sub-item {
			display: flex;
			align-items: center;
			padding: 6px 12px;
			cursor: pointer;
			border-radius: 4px;
			margin: 0 4px;
		}
		.ai-sidebar-ctx-sub-item:hover { background: rgba(0,0,0,0.05); }
		.ai-sidebar-ctx-sub-item.active { color: #4d7cff; font-weight: 500; }
		.ai-sidebar-ctx-trigger {
			display: flex;
			align-items: center;
			justify-content: space-between;
			width: 100%;
		}
		.ai-sidebar-ctx-arrow { font-size: 10px; opacity: 0.5; }
	`;
		document.head.appendChild(s);
	}

	let activeMenu: HTMLElement | null = null;

	function closeMenu() {
		if (!activeMenu) return;
		activeMenu.remove();
		activeMenu = null;
	}

	function showContextMenu(link: HTMLAnchorElement, e: MouseEvent) {
		e.preventDefault();
		e.stopPropagation();
		closeMenu();

		const href = link.getAttribute("href") || "";
		const sessionId = href.match(/\/c\/([^/?#]+)/)?.[1] || "";
		const meta = foldersState.sessions.get(sessionId);
		const currentFolderId = meta?.folderId || INBOX_ID;

		const menu = document.createElement("div");
		menu.className = "ai-sidebar-ctx";
		menu.style.left = e.clientX + "px";
		menu.style.top = e.clientY + "px";

		// Rename item
		const renameItem = document.createElement("div");
		renameItem.className = "ai-sidebar-ctx-item";
		renameItem.textContent = "✏️  Rename";
		renameItem.addEventListener("click", () => {
			closeMenu();
			const newTitle = prompt("Rename this session:", meta?.title || "");
			if (newTitle !== null && newTitle.trim()) {
				upsertSessionMetaFromStore(
					sessionId,
					newTitle.trim(),
					meta?.roundCount ?? 0,
					meta?.messageCount ?? 0,
					meta?.url || href,
				);
			}
		});
		menu.appendChild(renameItem);

		// Separator
		const sep = document.createElement("div");
		sep.className = "ai-sidebar-ctx-sep";
		menu.appendChild(sep);

		// Move to folder trigger
		const moveItem = document.createElement("div");
		moveItem.className = "ai-sidebar-ctx-item";
		const trigger = document.createElement("div");
		trigger.className = "ai-sidebar-ctx-trigger";
		const triggerLabel = document.createElement("span");
		triggerLabel.textContent = "📁  Move to folder";
		const arrow = document.createElement("span");
		arrow.className = "ai-sidebar-ctx-arrow";
		arrow.textContent = "▸";
		trigger.appendChild(triggerLabel);
		trigger.appendChild(arrow);
		moveItem.appendChild(trigger);
		menu.appendChild(moveItem);

		// Sub-menu: folder list
		const sub = document.createElement("div");
		sub.className = "ai-sidebar-ctx-sub";
		moveItem.addEventListener("click", (ev) => {
			ev.stopPropagation();
			if (sub.style.display === "block") {
				sub.style.display = "none";
				return;
			}
			// Clear and rebuild folder list
			while (sub.firstChild) sub.removeChild(sub.firstChild);
			foldersState.folders.forEach((folder) => {
				const item = document.createElement("div");
				item.className =
					"ai-sidebar-ctx-sub-item" +
					(folder.id === currentFolderId ? " active" : "");
				item.textContent =
					(folder.id === INBOX_ID ? "📥  " : "") +
					folder.name +
					(folder.id === currentFolderId ? " ✓" : "");
				item.addEventListener("click", (ev2) => {
					ev2.stopPropagation();
					addSessionToFolder(sessionId, meta?.title || "Untitled", folder.id);
					closeMenu();
				});
				sub.appendChild(item);
			});
			sub.style.display = "block";
		});
		moveItem.appendChild(sub);
		sub.addEventListener("click", (ev) => ev.stopPropagation());

		document.body.appendChild(menu);
		activeMenu = menu;

		// Keep sub-menu inside viewport
		requestAnimationFrame(() => {
			const rect = menu.getBoundingClientRect();
			if (rect.right > window.innerWidth)
				menu.style.left = window.innerWidth - rect.width - 8 + "px";
			if (rect.bottom > window.innerHeight)
				menu.style.top = window.innerHeight - rect.height - 8 + "px";
		});
	}

	// Close on outside click / Escape
	const onDocClick = (ev: MouseEvent) => {
		if (!activeMenu) return;
		if (!activeMenu.contains(ev.target as Node)) closeMenu();
	};
	const onKeyDown = (ev: KeyboardEvent) => {
		if (ev.key === "Escape") closeMenu();
	};
	document.addEventListener("click", onDocClick);
	document.addEventListener("keydown", onKeyDown);

	// Bind existing links
	function bindLinks() {
		const links =
			document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]');
		links.forEach((link) => {
			if (link.dataset.aiSidebarCtxBound) return;
			link.dataset.aiSidebarCtxBound = "1";
			link.addEventListener("contextmenu", (e) => {
				showContextMenu(link, e as MouseEvent);
			});
		});
	}
	bindLinks();

	// Re-bind for Arena SPA navigation
	const observer = new MutationObserver(() => bindLinks());
	if (document.body) {
		observer.observe(document.body, { childList: true, subtree: true });
	}
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
