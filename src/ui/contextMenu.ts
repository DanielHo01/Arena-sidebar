// ui/contextMenu.ts — the right-click menu on Arena's native history links:
// rename, move to folder, archive.
//
// Setup is idempotent by construction: the module keeps the live Disposer and a
// repeat call returns it instead of stacking a second set of document listeners.
// Phase 1 fixed a leak here (three route changes produced three click handlers,
// three keydown handlers and three whole-body MutationObservers); the lifecycle
// test in tests/unit/lifecycle.test.ts now pins that down.

import type { Disposer } from "../types";
import { CONTEXT_MENU_CSS } from "./styles";
import { queryHistoryLinks } from "../platform/arenaDom";
import { sessionIdFromHref } from "../platform/route";
import { resolveSessionTitle } from "../titleResolver";
import {
	addSessionToFolder,
	foldersState,
	INBOX_ID,
	setSessionCustomTitle,
} from "../features/sessions";

// ─── Arena History Context Menu ───────────────────────────────────────────────────────────────

/** Holds the live registration so repeat calls are no-ops. See the disposer. */
let contextMenuDisposer: Disposer | null = null;

/**
 * Inject a right-click context menu on Arena's native history links (a[href*="/c/"]).
 * Shows "✏️ Rename" and "📁 Move to folder ▶" with a folder sub-menu.
 * Click-outside and Escape close the menu.
 * MutationObserver rebinds new links added by Arena SPA navigation.
 *
 * Idempotent: content.ts calls this on bootstrap AND on every SPA route change.
 * Before the guard below, each call added another document-level click listener,
 * another keydown listener and another body-wide MutationObserver — so the
 * full-body querySelectorAll inside bindLinks ran once per visited session on
 * every DOM mutation. Re-calling returns the existing disposer.
 */
export function setupHistoryContextMenu(): Disposer {
	if (contextMenuDisposer) return contextMenuDisposer;

	const styleId = "ai-sidebar-ctx-style";
	if (!document.getElementById(styleId)) {
		const s = document.createElement("style");
		s.id = styleId;
		s.textContent = CONTEXT_MENU_CSS;
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
		const sessionId = sessionIdFromHref(href);
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
		const links = queryHistoryLinks(document);
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

	contextMenuDisposer = () => {
		document.removeEventListener("click", onDocClick);
		document.removeEventListener("keydown", onKeyDown);
		observer.disconnect();
		closeMenu();
		// Clear the per-link bound flags so a later setup can rebind them.
		document
			.querySelectorAll<HTMLElement>("[data-ai-sidebar-ctx-bound]")
			.forEach((el) => {
				delete el.dataset.aiSidebarCtxBound;
			});
		contextMenuDisposer = null;
	};
	return contextMenuDisposer;
}
