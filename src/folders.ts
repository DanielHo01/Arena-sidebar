// Session folder management — groups sessions into named folders.
// MVP scope: CRUD folders, move sessions between folders.
// Public exports:
//   foldersState   — shared mutable state
//   initFolders    — load persisted folders from storage
//   addSessionToFolder — assign a session to a folder
//   createFolder — create a new folder
//   getSessionsInFolder — list sessions in a folder

import type { SessionFolder, SessionMeta } from "./types";
import { contextValid } from "./state";
import { resolveSessionTitle } from "./titleResolver";

// ─── Default folders ─────────────────────────────────────────────────────────────────

const INBOX_ID = "inbox";
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
function buildArenaFolderEntry(onToggle: () => void): HTMLAnchorElement {
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
		onToggle();
	});
	return a;
}

// ─── Inline Session Library Section ───────────────────────────────────────────────────────────────

const LIBRARY_SECTION_ATTR = "data-ai-sidebar-arena-library-section";

/** Whether the inline section is currently open. */
let librarySectionOpen = false;

/**
 * Build the collapsible Session Library section container.
 * Injects inline into Arena's quick-nav area (between Child 2 and Child 3).
 */
function buildLibrarySection(): HTMLDivElement {
	const section = document.createElement("div");
	section.setAttribute(LIBRARY_SECTION_ATTR, "1");
	section.className = "aria-session-library-section";
	section.style.cssText =
		"padding: 8px 8px 4px;" +
		"border-top: 1px solid rgba(255,255,255,0.05);" +
		"border-bottom: 1px solid rgba(255,255,255,0.05);";
	return section;
}

/**
 * Toggle the inline Session Library section open/closed.
 * Updates the 🗂 entry's active state accordingly.
 */
export function toggleArenaSessionLibrarySection(): void {
	const container = findArenaQuickNavContainer();
	const section = container?.querySelector<HTMLElement>(
		`[${LIBRARY_SECTION_ATTR}]`,
	);
	const entry = container?.querySelector<HTMLElement>(
		`[${ARENA_FOLDER_ENTRY_ATTR}]`,
	);
	if (!section) return;

	librarySectionOpen = !librarySectionOpen;
	section.style.display = librarySectionOpen ? "block" : "none";
	if (entry) {
		if (librarySectionOpen) {
			entry.setAttribute("data-ai-sidebar-lib-open", "1");
			entry.classList.add("bg-sidebar-accent/20");
		} else {
			entry.removeAttribute("data-ai-sidebar-lib-open");
			entry.classList.remove("bg-sidebar-accent/20");
		}
	}
	if (librarySectionOpen) {
		renderArenaSessionLibrarySection(section);
	}
}

/**
 * Listen to chrome.storage changes so that cross-tab or cross-session updates
 * to folders/sessions are reflected in the current tab's in-memory state.
 * If the inline section is currently open, re-renders it immediately.
 * Call once from content.ts bootstrap.
 */
export function setupFoldersStorageSync(): void {
	if (typeof chrome === "undefined" || !chrome.storage) return;
	if (!contextValid) return;
	chrome.storage.onChanged.addListener((changes) => {
		if (!(FOLDERS_KEY in changes)) return;
		const { newValue } = changes[FOLDERS_KEY] as {
			newValue?: {
				folders: SessionFolder[];
				sessions: [string, SessionMeta][];
			};
		};
		if (!newValue) return;
		foldersState.folders = newValue.folders ?? foldersState.folders;
		if (newValue.sessions) {
			foldersState.sessions = new Map(newValue.sessions);
		}
		// Re-render if section is open
		if (librarySectionOpen) {
			const container = findArenaQuickNavContainer();
			const section = container?.querySelector<HTMLElement>(
				`[${LIBRARY_SECTION_ATTR}]`,
			);
			if (section) renderArenaSessionLibrarySection(section);
		}
	});
}

/**
 * Render the Session Library content into an existing container element.
 * Called when the section is opened. Re-renders every time to pick up latest state.
 */
function renderArenaSessionLibrarySection(container: HTMLElement): void {
	// Clear existing content
	while (container.firstChild) container.removeChild(container.firstChild);

	// ── Folder list ──────────────────────────────────────────────────────────
	const foldersList = document.createElement("div");
	foldersList.className = "asl-folders";
	foldersList.style.cssText = "margin-bottom: 6px;";

	foldersState.folders.forEach((folder) => {
		const isActive = foldersState.activeFolderId === folder.id;
		const row = document.createElement("div");
		row.className = "asl-folder-item" + (isActive ? " active" : "");
		row.style.cssText =
			"display: flex; align-items: center; justify-content: space-between;" +
			"padding: 5px 6px; border-radius: 5px; cursor: pointer;" +
			"font-size: 12px; color: #000000;" +
			"transition: background 0.08s;";
		if (isActive) {
			row.style.background = "rgba(77,124,255,0.15)";
			row.style.color = "#7aa3ff";
		}

		const name = document.createElement("span");
		name.textContent = folder.name;
		name.style.cssText =
			"flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
		row.appendChild(name);

		const count = document.createElement("span");
		count.textContent = String(getSessionsInFolder(folder.id).length);
		count.style.cssText =
			"font-size: 10px; color: #374151; margin-left: 4px; flex-shrink: 0;";
		row.appendChild(count);

		row.addEventListener("click", () => {
			foldersState.activeFolderId = folder.id;
			renderArenaSessionLibrarySection(container);
		});

		foldersList.appendChild(row);
	});

	// ── New folder input ──────────────────────────────────────────────────────
	const inputWrap = document.createElement("div");
	inputWrap.style.cssText = "margin-bottom: 6px;";
	const input = document.createElement("input");
	input.placeholder = "+ New folder…";
	input.maxLength = 40;
	input.style.cssText =
		"width: 100%; box-sizing: border-box;" +
		"padding: 4px 8px; border: 1px solid rgba(255,255,255,0.08);" +
		"border-radius: 5px; background: rgba(255,255,255,0.05);" +
		"color: #000000; font-size: 11px; outline: none;";
	input.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && input.value.trim()) {
			const folder = createFolder(input.value.trim());
			if (folder) {
				input.value = "";
				renderArenaSessionLibrarySection(container);
			}
		}
	});
	inputWrap.appendChild(input);

	// ── Session list ─────────────────────────────────────────────────────────
	const sessions = getSessionsInFolder(foldersState.activeFolderId);
	const sessionsWrap = document.createElement("div");
	sessionsWrap.style.cssText = "max-height: 200px; overflow-y: auto;";

	if (sessions.length === 0) {
		const empty = document.createElement("div");
		empty.textContent = "No sessions in this folder";
		empty.style.cssText =
			"padding: 8px 6px; font-size: 11px; color: #374151; text-align: center;";
		sessionsWrap.appendChild(empty);
	} else {
		sessions.forEach((s) => {
			const item = document.createElement("a");
			item.href = `/c/${s.sessionId}`;
			item.className = "asl-session-item";
			item.style.cssText =
				"display: flex; flex-direction: column; gap: 1px;" +
				"padding: 6px 6px; border-radius: 5px; text-decoration: none;" +
				"cursor: pointer; transition: background 0.08s;";
			const title = document.createElement("span");
			title.textContent = resolveSessionTitle(s);
			title.style.cssText =
				"font-size: 12px; color: #000000; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;";
			item.appendChild(title);
			const meta = document.createElement("span");
			meta.textContent = s.updatedAt
				? new Date(s.updatedAt).toLocaleDateString()
				: "";
			meta.style.cssText = "font-size: 10px; color: #374151;";
			item.appendChild(meta);
			item.addEventListener("mouseenter", () => {
				item.style.background = "rgba(255,255,255,0.05)";
			});
			item.addEventListener("mouseleave", () => {
				item.style.background = "";
			});
			sessionsWrap.appendChild(item);
		});
	}

	container.appendChild(foldersList);
	container.appendChild(inputWrap);
	container.appendChild(sessionsWrap);
}

/**
 * Inject the 🗂 Session Library entry into Arena's quick-nav bar.
 * Safe to call multiple times — checks for existing entry before inserting.
 *
 * @param onOpen  Callback to open the Session Library panel.
 */
export function ensureArenaFolderEntry(onToggle: () => void): void {
	const container = findArenaQuickNavContainer();
	if (!container) return;

	// Inject 🗂 entry if not already present
	if (!container.querySelector(`[${ARENA_FOLDER_ENTRY_ATTR}]`)) {
		const entry = buildArenaFolderEntry(onToggle);
		const firstChild = container.firstElementChild;
		if (firstChild) {
			container.insertBefore(entry, firstChild);
		} else {
			container.appendChild(entry);
		}
	}

	// Inject section container as a sibling of quickNav (between Child 2 and Child 3)
	if (!container.querySelector(`[${LIBRARY_SECTION_ATTR}]`)) {
		const section = buildLibrarySection();
		container.appendChild(section);
	}
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
			const currentMeta = foldersState.sessions.get(sessionId);
			const currentDisplay = resolveSessionTitle(currentMeta ?? { sessionId });
			const newTitle = prompt("Rename this session:", currentDisplay);
			if (newTitle !== null && newTitle.trim()) {
				setSessionCustomTitle(sessionId, newTitle.trim());
				// Sync: update native history link's title attribute so it shows the rename
				link.title = newTitle.trim();
				const titleSpan = link.querySelector("span");
				if (titleSpan) titleSpan.textContent = newTitle.trim();
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
 * One-time migration: scan chrome.storage.local for legacy historyTitle_* keys and
 * migrate their values into foldersState.sessions as customTitle. Called once on
 * bootstrap after initFolders() so that the sessions index is already populated.
 *
 * After migration the old keys are deleted so that future startup does not re-migrate.
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
					console.warn(
						"[AI Sidebar] migrateHistoryTitles: failed to remove old keys",
					);
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
