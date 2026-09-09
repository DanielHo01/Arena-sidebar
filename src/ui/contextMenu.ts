// ui/contextMenu.ts — the right-click menu on Arena's native history links:
// rename, move to folder. Since #17 this menu is the only rename entry
// (ChatGPT/Claude parity); double-click rename was removed.
//
// Setup is idempotent by construction: the module keeps the live Disposer and a
// repeat call returns it instead of stacking a second set of document listeners.
// Phase 1 fixed a leak here (three route changes produced three click handlers,
// three keydown handlers and three whole-body MutationObservers); the lifecycle
// test in tests/unit/lifecycle.test.ts now pins that down.
//
// Phase 5 broke the 222-line setup function into the pieces below and moved its
// 58-line stylesheet to ui/styles/contextMenu.ts. Each builder returns an
// element; setupHistoryContextMenu only wires them together.

import type { Disposer, SessionMeta } from "../types";
import { queryHistoryLinks } from "../platform/arenaDom";
import { sessionIdFromHref } from "../platform/route";
import { resolveSessionTitle } from "../titleResolver";
import {
	addSessionToFolder,
	foldersState,
	INBOX_ID,
	setSessionCustomTitle,
} from "../features/sessions";
import { CONTEXT_MENU_CSS } from "./styles";
import { h } from "./dom";
import { beginInlineRename } from "./inlineRename";

/** Holds the live registration so repeat calls are no-ops. See the disposer. */
let contextMenuDisposer: Disposer | null = null;

/** The menu currently on screen, if any. There is only ever one. */
let activeMenu: HTMLElement | null = null;

const STYLE_ID = "ai-sidebar-ctx-style";
const EDGE_MARGIN = 8;

function ensureStyles(): void {
	if (document.getElementById(STYLE_ID)) return;
	document.head.appendChild(
		h("style", { id: STYLE_ID, text: CONTEXT_MENU_CSS }),
	);
}

function closeMenu(): void {
	if (!activeMenu) return;
	activeMenu.remove();
	activeMenu = null;
}

/** "✏️ Rename" — inline edit on the link, then writes through to the index. */
function buildRenameItem(
	sessionId: string,
	link: HTMLAnchorElement,
): HTMLElement {
	return h("div", {
		class: "ai-sidebar-ctx-item",
		text: "✏️  Rename",
		onClick: () => {
			closeMenu();
			const currentMeta = foldersState.sessions.get(sessionId);
			const currentDisplay = resolveSessionTitle(currentMeta ?? { sessionId });
			// Edit in place on the link rather than in a native prompt(): the
			// prompt cannot be styled to match the extension, and jsdom does not
			// implement it at all, which made this path untestable.
			const target = link.querySelector("span") ?? link;
			beginInlineRename({
				target,
				initial: currentDisplay,
				onCommit: (trimmed) => {
					setSessionCustomTitle(sessionId, trimmed);
					// beginInlineRename already wrote target.textContent; the anchor's
					// tooltip is the one thing it cannot know about.
					link.title = trimmed;
				},
			});
		},
	});
}

/** Rebuild the folder list inside the sub-menu from current state. */
function fillFolderList(
	sub: HTMLElement,
	sessionId: string,
	meta: SessionMeta | undefined,
	currentFolderId: string,
): void {
	sub.textContent = "";
	for (const folder of foldersState.folders) {
		const isActive = folder.id === currentFolderId;
		sub.appendChild(
			h("div", {
				class: "ai-sidebar-ctx-sub-item" + (isActive ? " active" : ""),
				text:
					(folder.id === INBOX_ID ? "📥  " : "") +
					folder.name +
					(isActive ? " ✓" : ""),
				onClick: (ev) => {
					ev.stopPropagation();
					addSessionToFolder(sessionId, meta?.title || "Untitled", folder.id);
					closeMenu();
				},
			}),
		);
	}
}

/** "📁 Move to folder ▸" plus its lazily-filled sub-menu. */
function buildMoveItem(
	sessionId: string,
	meta: SessionMeta | undefined,
	currentFolderId: string,
): HTMLElement {
	const sub = h("div", { class: "ai-sidebar-ctx-sub" });
	// Clicks inside the sub-menu must not bubble to the trigger and re-toggle it.
	sub.addEventListener("click", (ev) => ev.stopPropagation());

	const moveItem = h(
		"div",
		{
			class: "ai-sidebar-ctx-item",
			onClick: (ev) => {
				ev.stopPropagation();
				if (sub.style.display === "block") {
					sub.style.display = "none";
					return;
				}
				fillFolderList(sub, sessionId, meta, currentFolderId);
				sub.style.display = "block";
			},
		},
		h(
			"div",
			{ class: "ai-sidebar-ctx-trigger" },
			h("span", { text: "📁  Move to folder" }),
			h("span", { class: "ai-sidebar-ctx-arrow", text: "▸" }),
		),
	);
	moveItem.appendChild(sub);
	return moveItem;
}

/** Nudge the menu back on screen if it opened too close to an edge. */
function clampToViewport(menu: HTMLElement): void {
	requestAnimationFrame(() => {
		const rect = menu.getBoundingClientRect();
		if (rect.right > window.innerWidth)
			menu.style.left = window.innerWidth - rect.width - EDGE_MARGIN + "px";
		if (rect.bottom > window.innerHeight)
			menu.style.top = window.innerHeight - rect.height - EDGE_MARGIN + "px";
	});
}

function showContextMenu(link: HTMLAnchorElement, e: MouseEvent): void {
	e.preventDefault();
	e.stopPropagation();
	closeMenu();

	const sessionId = sessionIdFromHref(link.getAttribute("href") || "");
	const meta = foldersState.sessions.get(sessionId);
	const currentFolderId = meta?.folderId || INBOX_ID;

	const menu = h(
		"div",
		{
			class: "ai-sidebar-ctx",
			style: { left: e.clientX + "px", top: e.clientY + "px" },
		},
		buildRenameItem(sessionId, link),
		h("div", { class: "ai-sidebar-ctx-sep" }),
		buildMoveItem(sessionId, meta, currentFolderId),
	);

	document.body.appendChild(menu);
	activeMenu = menu;
	clampToViewport(menu);
}

/** Attach the contextmenu handler to every history link not yet bound. */
function bindLinks(): void {
	for (const link of queryHistoryLinks(document)) {
		if (link.dataset.aiSidebarCtxBound) continue;
		link.dataset.aiSidebarCtxBound = "1";
		link.addEventListener("contextmenu", (e) => {
			showContextMenu(link, e as MouseEvent);
		});
	}
}

/**
 * Install the context menu. Idempotent: a second call returns the existing
 * Disposer rather than stacking another set of document listeners.
 */
export function setupHistoryContextMenu(): Disposer {
	if (contextMenuDisposer) return contextMenuDisposer;

	ensureStyles();

	const onDocClick = (ev: MouseEvent) => {
		if (!activeMenu) return;
		if (!activeMenu.contains(ev.target as Node)) closeMenu();
	};
	const onKeyDown = (ev: KeyboardEvent) => {
		if (ev.key === "Escape") closeMenu();
	};
	document.addEventListener("click", onDocClick);
	document.addEventListener("keydown", onKeyDown);

	bindLinks();

	// Re-bind as Arena's SPA re-renders its history list.
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
