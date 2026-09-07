// ui/arenaSidebar.ts — injects this extension's entry points into Arena's own
// sidebar: the 🗂 Session Library anchor, the collapsible section that lists
// folders and sessions, and the cross-tab storage sync that re-renders it.
//
// Pure presentation over features/sessions.ts state; it holds no session data of
// its own beyond whether the section is currently open.

import type { Disposer, SessionFolder, SessionMeta } from "../types";
import { findArenaQuickNavContainer } from "../platform/arenaDom";
import { onStorageChanged } from "../platform/storage";
import { resolveSessionTitle } from "../titleResolver";
import {
	createFolder,
	FOLDERS_KEY,
	foldersState,
	getSessionsInFolder,
} from "../features/sessions";

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
 * Close the Session Library section on a route change.
 *
 * Residual state: the flag survived the route change while Arena re-rendered
 * its sidebar and dropped the injected section, so storage-sync callbacks kept
 * taking the "section is open, re-render it" branch against a detached node.
 */
export function resetLibrarySection(): void {
	librarySectionOpen = false;
}

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
export function setupFoldersStorageSync(): Disposer {
	return onStorageChanged(FOLDERS_KEY, (change) => {
		const { newValue } = change as {
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
