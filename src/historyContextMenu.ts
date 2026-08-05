// Arena history context menu — right-click on /c/ sidebar links to get
// "✏️ Rename" and "📁 Move to folder ▶" with a collapsible folder sub-menu.
// Click-outside and Escape close the menu.
//
// Depends on:
//   foldersStore — for setSessionCustomTitle, addSessionToFolder,
//                  foldersState, INBOX_ID, getSessionMeta

import {
	foldersState,
	INBOX_ID,
	getSessionMeta,
	setSessionCustomTitle,
	addSessionToFolder,
} from "./foldersStore";
import { resolveSessionTitle } from "./titleResolver";
import { applyCustomTitle, updateTitleCache } from "./historyTitles";

// ─── Styles ──────────────────────────────────────────────────────────────────────────

const CTX_STYLE_ID = "ai-sidebar-ctx-style";

function ensureStyles(): void {
	if (document.getElementById(CTX_STYLE_ID)) return;
	const s = document.createElement("style");
	s.id = CTX_STYLE_ID;
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

// ─── Menu controller ────────────────────────────────────────────────────────────────

let activeMenu: HTMLElement | null = null;

export function hideHistoryContextMenu(): void {
	if (!activeMenu) return;
	activeMenu.remove();
	activeMenu = null;
}

function showContextMenu(link: HTMLAnchorElement, e: MouseEvent) {
	e.preventDefault();
	e.stopPropagation();
	hideHistoryContextMenu();

	const href = link.getAttribute("href") || "";
	const sessionId = href.match(/\/c\/([^/?#]+)/)?.[1] || "";
	const meta = getSessionMeta(sessionId);
	const currentFolderId = meta?.folderId || INBOX_ID;

	const menu = document.createElement("div");
	menu.className = "ai-sidebar-ctx";
	menu.style.left = e.clientX + "px";
	menu.style.top = e.clientY + "px";

	// ── Rename ──────────────────────────────────────────────────────────────
	const renameItem = document.createElement("div");
	renameItem.className = "ai-sidebar-ctx-item";
	renameItem.textContent = "✏️  Rename";
	renameItem.addEventListener("click", () => {
		hideHistoryContextMenu();
		const currentMeta = getSessionMeta(sessionId);
		const currentDisplay = resolveSessionTitle(
			currentMeta ?? { sessionId },
		);
		const newTitle = prompt("Rename this session:", currentDisplay);
		if (newTitle !== null && newTitle.trim()) {
				setSessionCustomTitle(sessionId, newTitle.trim());
				updateTitleCache(sessionId, newTitle.trim());
				applyCustomTitle(link, newTitle.trim());
			}
	});
	menu.appendChild(renameItem);

	// ── Separator ──────────────────────────────────────────────────────────
	const sep = document.createElement("div");
	sep.className = "ai-sidebar-ctx-sep";
	menu.appendChild(sep);

	// ── Move to folder ─────────────────────────────────────────────────────
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

	// ── Folder sub-menu ────────────────────────────────────────────────────
	const sub = document.createElement("div");
	sub.className = "ai-sidebar-ctx-sub";
	moveItem.addEventListener("click", (ev) => {
		ev.stopPropagation();
		if (sub.style.display === "block") {
			sub.style.display = "none";
			return;
		}
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
				addSessionToFolder(
					sessionId,
					meta?.title || "Untitled",
					folder.id,
				);
				hideHistoryContextMenu();
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

// ─── Setup ─────────────────────────────────────────────────────────────────────────

function bindLinks(): void {
	const links = document.querySelectorAll<HTMLAnchorElement>('a[href*="/c/"]');
	links.forEach((link) => {
		if (link.dataset.aiSidebarCtxBound) return;
		link.dataset.aiSidebarCtxBound = "1";
		link.addEventListener("contextmenu", (e) => {
			showContextMenu(link, e as MouseEvent);
		});
	});
}

/**
 * Inject right-click context menus on Arena's native history links.
 * MutationObserver rebinds new links added by Arena SPA navigation.
 */
export function setupHistoryContextMenu(): void {
	ensureStyles();
	bindLinks();

	const observer = new MutationObserver(() => bindLinks());
	if (document.body) {
		observer.observe(document.body, { childList: true, subtree: true });
	}

	// Close on outside click / Escape
	document.addEventListener("click", (ev) => {
		if (!activeMenu) return;
		if (!activeMenu.contains(ev.target as Node)) hideHistoryContextMenu();
	});
	document.addEventListener("keydown", (ev) => {
		if (ev.key === "Escape") hideHistoryContextMenu();
	});
}
