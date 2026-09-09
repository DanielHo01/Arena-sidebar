// ui/arenaSidebar.ts — injects this extension's entry points into Arena's own
// sidebar: the 🗂 Session Library anchor, the collapsible section that lists
// folders and sessions, and the cross-tab storage sync that re-renders it.
//
// Pure presentation over features/sessions.ts state; it holds no session data of
// its own beyond whether the section is currently open.

import type { Disposer, SessionFolder, SessionMeta } from "../types";
import { resolveQuickNavContainer } from "../platform/arenaDom";
import { h } from "./dom";
import { ASL } from "./styles/arenaSidebar";
import { onStorageChanged } from "../platform/storage";
import { setupHistoryTitles } from "../historyTitles";
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
	return h(
		"a",
		{
			class: ASL.folderEntryClass,
			attrs: { [ARENA_FOLDER_ENTRY_ATTR]: "1" },
			onClick: (e) => {
				e.preventDefault();
				onToggle();
			},
		},
		h("span", { class: ASL.folderEntryIconClass, text: "🗂" }),
		h("span", {
			class: "flex-1 truncate text-sm font-medium",
			text: "Session Library",
		}),
	);
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
	const container = resolveQuickNavContainer();
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
		// #11: repaint history-link titles at once. Memory alone is not
		// enough — on an idle tab the next DOM mutation (the usual restore
		// trigger) may be minutes away, so a remote rename would sit
		// invisible. The restore is idempotent: links whose text already
		// matches are read, not rewritten.
		setupHistoryTitles();
		// Re-render if section is open
		if (librarySectionOpen) {
			const container = resolveQuickNavContainer();
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
/** Folder rows. Clicking one makes it the active folder and re-renders. */
function buildFolderList(container: HTMLElement): HTMLElement {
	const list = h("div", {
		class: "asl-folders",
		style: { cssText: ASL.foldersList },
	});
	for (const folder of foldersState.folders) {
		const isActive = foldersState.activeFolderId === folder.id;
		list.appendChild(
			h(
				"div",
				{
					class: "asl-folder-item" + (isActive ? " active" : ""),
					style: {
						cssText: ASL.folderRow + (isActive ? ASL.folderRowActive : ""),
					},
					onClick: () => {
						foldersState.activeFolderId = folder.id;
						renderArenaSessionLibrarySection(container);
					},
				},
				h("span", {
					text: folder.name,
					style: { cssText: ASL.folderName },
				}),
				h("span", {
					text: String(getSessionsInFolder(folder.id).length),
					style: { cssText: ASL.folderCount },
				}),
			),
		);
	}
	return list;
}

/** "+ New folder…" input; Enter creates the folder and re-renders. */
function buildNewFolderInput(container: HTMLElement): HTMLElement {
	const input = h("input", {
		placeholder: "+ New folder…",
		maxLength: 40,
		style: { cssText: ASL.newFolderInput },
	});
	input.addEventListener("keydown", (e) => {
		if (e.key !== "Enter" || !input.value.trim()) return;
		if (createFolder(input.value.trim())) {
			input.value = "";
			renderArenaSessionLibrarySection(container);
		}
	});
	return h("div", { style: { cssText: ASL.newFolderWrap } }, input);
}

/** Sessions in the active folder, or an empty-state message. */
function buildSessionList(): HTMLElement {
	const wrap = h("div", { style: { cssText: ASL.sessionsWrap } });
	const sessions = getSessionsInFolder(foldersState.activeFolderId);
	if (sessions.length === 0) {
		wrap.appendChild(
			h("div", {
				text: "No sessions in this folder",
				style: { cssText: ASL.sessionsEmpty },
			}),
		);
		return wrap;
	}
	for (const s of sessions) {
		const item = h(
			"a",
			{
				href: `/c/${s.sessionId}`,
				class: "asl-session-item",
				style: { cssText: ASL.sessionItem },
			},
			h("span", {
				text: resolveSessionTitle(s),
				style: { cssText: ASL.sessionTitle },
			}),
			h("span", {
				text: s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "",
				style: { cssText: ASL.sessionMeta },
			}),
		);
		item.addEventListener("mouseenter", () => {
			item.style.background = "rgba(255,255,255,0.05)";
		});
		item.addEventListener("mouseleave", () => {
			item.style.background = "";
		});
		wrap.appendChild(item);
	}
	return wrap;
}

/** Rebuild the whole Session Library section from current state. */
function renderArenaSessionLibrarySection(container: HTMLElement): void {
	container.textContent = "";
	container.append(
		buildFolderList(container),
		buildNewFolderInput(container),
		buildSessionList(),
	);
}

/**
 * Inject the 🗂 Session Library entry into Arena's quick-nav bar.
 * Safe to call multiple times — checks for existing entry before inserting.
 *
 * @param onOpen  Callback to open the Session Library panel.
 */
export function ensureArenaFolderEntry(onToggle: () => void): void {
	const container = resolveQuickNavContainer();
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
