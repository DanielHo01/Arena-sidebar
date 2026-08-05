// Arena native sidebar integration — injects the Session Library entry and
// renders the collapsible inline section into Arena's quick-nav bar.
//
// Depends on:
//   foldersStore — for foldersState, getSessionsInFolder, createFolder, INBOX_ID
//   titleResolver — for resolveSessionTitle

import { FOLDERS_KEY } from "./foldersStore";
import {
	foldersState,
	getSessionsInFolder,
	createFolder,
} from "./foldersStore";
import { resolveSessionTitle } from "./titleResolver";
import type { SessionFolder, SessionMeta } from "./types";

// ─── DOM helpers ─────────────────────────────────────────────────────────────────────

function findArenaSidebarWrapper(): HTMLElement | null {
	return document.querySelector<HTMLElement>('[class*="sidebar-wrapper"]');
}

function findArenaQuickNavContainer(): HTMLElement | null {
	const wrapper = findArenaSidebarWrapper();
	if (!wrapper) return null;
	const floating = wrapper.children[0] as HTMLElement | undefined;
	if (!floating) return null;
	const bgSidebar = floating.children[1] as HTMLElement | undefined;
	if (!bgSidebar) return null;
	const floatingRoot = bgSidebar.children[0] as HTMLElement | undefined;
	if (!floatingRoot) return null;
	const quickNav = floatingRoot.children[2];
	if (!quickNav || quickNav.tagName !== "DIV") return null;
	return quickNav as HTMLElement;
}

// ─── Entry constants ─────────────────────────────────────────────────────────────────

const ARENA_FOLDER_ENTRY_ATTR = "data-ai-sidebar-folder-entry";
const LIBRARY_SECTION_ATTR = "data-ai-sidebar-arena-library-section";

// ─── Library section state ─────────────────────────────────────────────────────────

let librarySectionOpen = false;
let _entryRetryTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Build the 🗂 Session Library anchor element.
 * Does NOT open the modal — onToggle handles that.
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

/**
 * Build the collapsible Session Library section container.
 * Injects inline into Arena's quick-nav area.
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

// ─── Render ────────────────────────────────────────────────────────────────────────

function renderArenaSessionLibrarySection(container: HTMLElement): void {
	while (container.firstChild) container.removeChild(container.firstChild);

	// ── Folder list ────────────────────────────────────────────────────────
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

	// ── New folder input ───────────────────────────────────────────────────
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

	// ── Session list ────────────────────────────────────────────────────────
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
 * Attempt to inject the 🗂 entry, retrying if Arena DOM is not yet available.
 * Use this instead of ensureArenaFolderEntry when the DOM may still be loading.
 */
export function ensureArenaFolderEntryWithRetry(
	onToggle: () => void,
	retriesLeft = 10,
): void {
	if (_entryRetryTimer) {
		clearTimeout(_entryRetryTimer);
		_entryRetryTimer = null;
	}
	const container = findArenaQuickNavContainer();
	if (container) {
		ensureArenaFolderEntry(onToggle);
		return;
	}
	if (retriesLeft <= 0) {
		console.warn(
			"[AI Sidebar] ensureArenaFolderEntry: max retries reached, arena DOM not available",
		);
		return;
	}
	_entryRetryTimer = setTimeout(() => {
		ensureArenaFolderEntryWithRetry(onToggle, retriesLeft - 1);
	}, 500);
}

/**
 * Inject the 🗂 Session Library entry into Arena's quick-nav bar.
 * Safe to call multiple times — checks for existing entry before inserting.
 */
export function ensureArenaFolderEntry(onToggle: () => void): void {
	const container = findArenaQuickNavContainer();
	if (!container) return;

	if (!container.querySelector(`[${ARENA_FOLDER_ENTRY_ATTR}]`)) {
		const entry = buildArenaFolderEntry(onToggle);
		const firstChild = container.firstElementChild;
		if (firstChild) {
			container.insertBefore(entry, firstChild);
		} else {
			container.appendChild(entry);
		}
	}

	if (!container.querySelector(`[${LIBRARY_SECTION_ATTR}]`)) {
		const section = buildLibrarySection();
		container.appendChild(section);
	}
}

/**
 * Listen to chrome.storage changes so cross-tab or cross-session updates to
 * folders/sessions are reflected in the current tab's in-memory state.
 * If the inline library section is currently open, re-renders it immediately.
 * Call once from content.ts bootstrap.
 */
export function setupFoldersStorageSync(): void {
	if (typeof chrome === "undefined" || !chrome.storage) return;
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
