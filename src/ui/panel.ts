// Panel — sidebar panel, round list reconciliation, and scroll highlight tracking.
// Public exports:
//   ensurePanelSkeleton — builds or updates the panel DOM
//   reconcileList       — diffs round list and updates DOM
//   setupScrollHighlight — attaches scroll-based active round tracking

import type { SidebarRound } from "../types";
import { roundSummaries, hiddenRoundIds } from "../rounds";
import { scrollToRound, getMessagesForRound } from "../conversationStore";
import { panel } from "../state";
import { conversationStore } from "../conversationStore";
import { UI_STYLES, ICON_X_SVG } from "./styles";
import { exportConversation, summarizeRounds } from "./modals";
// Sprint 9: session library
import {
	foldersState,
	getSessionsInFolder,
	createFolder,
	deleteFolder,
	renameFolder,
	addSessionToFolder,
	INBOX_ID,
} from "../folders";

// ─── Scroll highlight ──────────────────────────────────────────────────────────────────────

export function refreshCurrentHighlight(list: HTMLElement | null) {
	if (!list) return;
	for (const item of list.querySelectorAll(".item")) {
		(item as HTMLElement).classList.toggle(
			"current",
			parseInt((item as HTMLElement).dataset.roundIdx || "-1", 10) ===
				panel.currentRoundIdx,
		);
	}
}

export function setupScrollHighlight(list: HTMLElement | null) {
	if (!list) return;
	let ticking = false;
	list.addEventListener("scroll", () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			const items = list.querySelectorAll(".item");
			let bestIdx = panel.currentRoundIdx;
			let bestArea = 0;
			const lr = list.getBoundingClientRect();
			items.forEach((item) => {
				const ir = item.getBoundingClientRect();
				const overlap =
					Math.min(ir.bottom, lr.bottom) - Math.max(ir.top, lr.top);
				if (overlap > bestArea) {
					bestArea = overlap;
					bestIdx = parseInt((item as HTMLElement).dataset.roundIdx || "0", 10);
				}
			});
			if (bestIdx !== panel.currentRoundIdx) {
				panel.currentRoundIdx = bestIdx;
				refreshCurrentHighlight(list);
			}
			ticking = false;
		});
	});
}

// ─── List reconciliation ─────────────────────────────────────────────────────────────

export function reconcileList(
	list: HTMLElement,
	rounds: SidebarRound[],
	_refreshUI: () => void, // eslint-disable-line @typescript-eslint/no-unused-vars
) {
	const byId = new Map<string, HTMLElement>();
	for (const child of [...list.children] as HTMLElement[]) {
		if (child.dataset.roundId) byId.set(child.dataset.roundId, child);
	}

	const q = panel.searchQuery.toLowerCase().trim();
	const filtered = rounds
		.filter((r) => !hiddenRoundIds.has(r.id))
		.filter(
			(r) =>
				!q ||
				r.title.toLowerCase().includes(q) ||
				r.userPreview?.toLowerCase().includes(q) ||
				r.assistantPreview?.toLowerCase().includes(q),
		);

	if (filtered.length === 0) {
		for (const [, el] of byId) el.remove();
		const msg =
			list.querySelector(".empty") ||
			(() => {
				const e = document.createElement("div");
				e.className = "empty";
				list.appendChild(e);
				return e;
			})();
		msg.textContent = q
			? 'No matches for "' + panel.searchQuery + '"'
			: "No messages detected";
		return;
	}
	const emptyEl = list.querySelector(".empty");
	if (emptyEl) emptyEl.remove();

	const newIds = new Set(filtered.map((r) => r.id));
	for (const [id, el] of byId) {
		if (!newIds.has(id)) {
			el.remove();
			byId.delete(id);
		}
	}

	filtered.forEach((round, idx) => {
		let el = byId.get(round.id);
		if (!el) {
			el = createRoundEl(round, idx, _refreshUI);
		} else {
			updateRoundEl(el, round, idx);
		}
		if (list.children[idx] !== el) {
			list.insertBefore(el, list.children[idx] ?? null);
		}
	});
}

// ─── Round element ──────────────────────────────────────────────────────────────────

// Sprint 4: DeepSeek-style round item — .item-meta (label + actions) + .item-title
function createRoundEl(
	round: SidebarRound,
	idx: number,
	refreshUI: () => void,
): HTMLElement {
	const item = document.createElement("div");
	item.className = "item";
	item.dataset.roundId = round.id;
	item.dataset.roundIdx = String(idx);

	const s = roundSummaries.get(round.id);
	const currentTitle = s ? s.title : round.title;

	// .item-meta: label + hover actions
	const meta = document.createElement("div");
	meta.className = "item-meta";

	const metaLabel = document.createElement("span");
	metaLabel.className = "item-meta-label";
	// Sprint 8: show assistantCount when > 1
	const metaLabelText =
		round.assistantCount && round.assistantCount > 1
			? `Round ${idx + 1} · ${round.assistantCount} responses`
			: `Round ${idx + 1}`;
	metaLabel.textContent = metaLabelText;

	const actions = document.createElement("span");
	actions.className = "item-actions";

	// Copy button
	const copyBtn = document.createElement("button");
	copyBtn.className = "item-action";
	copyBtn.textContent = "📋";
	copyBtn.title = "Copy round content";
	copyBtn.onclick = (e) => {
		e.stopPropagation();
		const roundMsgs = getMessagesForRound(round.id);
		const txt = roundMsgs.map((m) => `[${m.role}] ${m.content}`).join("\n\n");
		if (txt)
			navigator.clipboard.writeText(txt).then(() => {
				copyBtn.textContent = "✅";
				setTimeout(() => {
					copyBtn.textContent = "📋";
				}, 1200);
			});
	};

	// Hide button
	const hideBtn = document.createElement("button");
	hideBtn.className = "item-action";
	hideBtn.textContent = "✕";
	hideBtn.title = "Hide this round";
	hideBtn.onclick = (e) => {
		e.stopPropagation();
		hiddenRoundIds.add(round.id);
		refreshUI();
	};

	actions.appendChild(copyBtn);
	actions.appendChild(hideBtn);
	meta.appendChild(metaLabel);
	meta.appendChild(actions);

	// .item-title — primary text (userPreview, with title as fallback)
	const title = document.createElement("div");
	title.className = "item-title";
	title.textContent = currentTitle;
	title.title = currentTitle;

	// Sprint 8: .item-assistant-preview
	const assistantPreview = document.createElement("div");
	assistantPreview.className = "item-assistant-preview";
	if (round.assistantPreview) {
		const prefix =
			round.assistantCount && round.assistantCount > 1
				? `${round.assistantCount} responses · `
				: "";
		assistantPreview.textContent = prefix + round.assistantPreview;
		assistantPreview.title = round.assistantPreview;
	} else {
		// No assistant yet — show generating placeholder
		assistantPreview.textContent = "Generating…";
		assistantPreview.title = "Waiting for assistant response…";
	}

	item.appendChild(meta);
	item.appendChild(title);
	item.appendChild(assistantPreview);

	const isCharacterChat = /^\/c\//.test(location.pathname);
	item.onclick = () => {
		scrollToRound(round.id);
		panel.currentRoundIdx = idx;
		if (!isCharacterChat) panel.isOpen = false;
		refreshUI();
	};

	return item;
}

// Sprint 4/8: updateRoundEl for .item-meta + .item-title + .item-assistant-preview
function updateRoundEl(el: HTMLElement, round: SidebarRound, idx: number) {
	const metaLabel = el.querySelector(".item-meta-label");
	if (metaLabel) {
		const metaLabelText =
			round.assistantCount && round.assistantCount > 1
				? `Round ${idx + 1} · ${round.assistantCount} responses`
				: `Round ${idx + 1}`;
		metaLabel.textContent = metaLabelText;
	}
	const title = el.querySelector(".item-title") as HTMLElement | null;
	if (title) {
		const s = roundSummaries.get(round.id);
		const currentTitle = s ? s.title : round.title;
		title.textContent = currentTitle;
		title.title = currentTitle;
	}
	// Sprint 8: update assistant preview
	const assistantEl = el.querySelector(
		".item-assistant-preview",
	) as HTMLElement | null;
	if (assistantEl) {
		if (round.assistantPreview) {
			const prefix =
				round.assistantCount && round.assistantCount > 1
					? `${round.assistantCount} responses · `
					: "";
			assistantEl.textContent = prefix + round.assistantPreview;
			assistantEl.title = round.assistantPreview;
		} else {
			assistantEl.textContent = "Generating…";
			assistantEl.title = "Waiting for assistant response…";
		}
	}
	el.dataset.roundIdx = String(idx);
}

// ─── Panel skeleton ─────────────────────────────────────────────────────────────────────

export function ensurePanelSkeleton(
	shadowRoot: ShadowRoot,
	roundsCount: number,
	_messagesCount: number,
	refreshUI: () => void,
): HTMLElement {
	let panelEl = shadowRoot.querySelector(".panel") as HTMLElement | null;
	if (panelEl) {
		const titleEl = panelEl.querySelector(".panel-title");
		if (titleEl) titleEl.textContent = roundsCount + " loaded rounds";
		return panelEl;
	}

	panelEl = document.createElement("div");
	panelEl.className = "panel";
	panelEl.setAttribute("data-ai-sidebar-panel", "1"); // Sprint 4: mark for debugging

	// Header
	const header = document.createElement("div");
	header.className = "header";

	const title = document.createElement("span");
	title.className = "panel-title";
	title.textContent = roundsCount + " loaded rounds";
	header.appendChild(title);

	const makeHeaderBtn = (text: string, title: string, onclick: () => void) => {
		const btn = document.createElement("button");
		btn.className = "summary-btn";
		btn.textContent = text;
		btn.title = title;
		btn.onclick = onclick;
		return btn;
	};

	// All action buttons wrapped in header-actions
	const headerActions = document.createElement("div");
	headerActions.className = "header-actions";

	// Order toggle
	const orderBtn = makeHeaderBtn(
		panel.reverseOrder ? "🔃" : "🔄",
		"Newest first (click to reverse)",
		() => {
			panel.reverseOrder = !panel.reverseOrder;
			refreshUI();
		},
	);
	headerActions.appendChild(orderBtn);

	// Sprint 3.1: Scan button — auto-scroll up to trigger Arena loading older messages
	const isCharacterChat = /^\/c\//.test(location.pathname);
	if (isCharacterChat) {
		let scanning = false;
		const scanBtn = makeHeaderBtn("⤒", "Scan older loaded history", () => {
			if (scanning) return;
			scanning = true;
			const startY = window.scrollY;
			let idleTicks = 0;
			let steps = 0;
			let lastCount = document.querySelectorAll("[data-ai-sidebar-id]").length;

			const timer = window.setInterval(() => {
				window.scrollBy({ top: -700, behavior: "auto" });
				steps++;

				window.setTimeout(() => {
					const nextCount = document.querySelectorAll(
						"[data-ai-sidebar-id]",
					).length;
					if (nextCount > lastCount) {
						lastCount = nextCount;
						idleTicks = 0;
					} else {
						idleTicks++;
					}

					if (window.scrollY <= 0 || idleTicks >= 4 || steps >= 10) {
						clearInterval(timer);
						window.setTimeout(() => {
							window.scrollTo({ top: startY, behavior: "auto" });
							scanning = false;
						}, 250);
					}
				}, 220);
			}, 650);
		});
		headerActions.appendChild(scanBtn);
	}

	// Export button
	const exportBtn = makeHeaderBtn("📤", "Export current conversation", () => {
		exportConversation(conversationStore.messages, shadowRoot);
	});
	headerActions.appendChild(exportBtn);

	// Summarize button — hidden on /c/ (no full history available there)
	if (!isCharacterChat) {
		const sumBtn = makeHeaderBtn("✨", "AI summarize rounds", () => {
			summarizeRounds(conversationStore.messages, shadowRoot);
		});
		headerActions.appendChild(sumBtn);
	}

	header.appendChild(headerActions);

	// Close button
	const closeBtn = document.createElement("button");
	closeBtn.className = "close-btn";
	closeBtn.setAttribute("aria-label", "Close");
	const xParser = new DOMParser();
	const xDoc = xParser.parseFromString(ICON_X_SVG, "image/svg+xml");
	const xSvg = xDoc.documentElement as unknown as SVGElement;
	if (xSvg) closeBtn.appendChild(xSvg);
	closeBtn.onclick = () => {
		panel.isOpen = false;
		refreshUI();
	};
	header.appendChild(closeBtn);

	panelEl.appendChild(header);

	// Search input
	const searchInput = document.createElement("input");
	searchInput.className = "search-input";
	searchInput.type = "text";
	searchInput.placeholder = "Search rounds...";
	searchInput.oninput = () => {
		panel.searchQuery = searchInput.value.toLowerCase().trim();
		refreshUI();
	};
	panelEl.appendChild(searchInput);

	// List container
	const list = document.createElement("div");
	list.className = "list";
	panelEl.appendChild(list);

	shadowRoot.appendChild(panelEl);
	return panelEl;
}

// ─── Ensure styles are injected ──────────────────────────────────────────────────────────

export function ensureStyles(shadowRoot: ShadowRoot) {
	if (shadowRoot.querySelector("style")) return;
	const s = document.createElement("style");
	s.textContent = UI_STYLES;
	shadowRoot.appendChild(s);
}

// ─── Phase 10A Commit 2: Arena-native Session Library Panel ────────────────────────────────────

/**
 * Open the Session Library as an Arena-native floating panel.
 * Appends to document.body (not Shadow DOM) so it sits naturally in the Arena DOM tree.
 * Uses existing folder/session state from folders.ts.
 */
export function showArenaSessionLibraryPanel(): void {
	showSessionLibraryInline(
		document.body,
		foldersState,
		getSessionsInFolder,
		createFolder,
		deleteFolder,
		renameFolder,
		addSessionToFolder,
		INBOX_ID,
	);
}

/**
 * Arena-native version of the Session Library.
 * Renders into a given container (e.g. document.body) using Arena CSS class names.
 */
function showSessionLibraryInline(
	container: ParentNode,
	foldersState: FolderState,
	getSessionsInFolder: (folderId: string) => Array<{ sessionId: string; title: string; folderId: string; createdAt: number; updatedAt: number }>,
	createFolder: (name: string) => { id: string; name: string; createdAt: number; updatedAt: number } | null,
	deleteFolder: (folderId: string) => void,
	renameFolder: (folderId: string, newName: string) => void,
	addSessionToFolder: (sessionId: string, title: string, folderId: string) => void,
	INBOX_ID: string,
) {
	// Dismiss if already open
	const existing = container.querySelector(".arena-slm");
	if (existing) { existing.remove(); return; }

	const overlay = document.createElement("div");
	overlay.className = "arena-slm";
	overlay.setAttribute("role", "dialog");
	overlay.setAttribute("aria-label", "Session Library");

	// Arena-style panel
	overlay.innerHTML = `
		<div class="arena-slm-backdrop" aria-hidden="true"></div>
		<div class="arena-slm-panel">
			<div class="arena-slm-header">
				<span class="arena-slm-title">🗂 Session Library</span>
				<button class="arena-slm-close" title="Close" aria-label="Close">✕</button>
			</div>
			<div class="arena-slm-body">
				<div class="arena-slm-folders">
					<div class="arena-slm-folder-list"></div>
					<div class="arena-slm-new-folder">
						<input class="arena-slm-input" placeholder="+ New folder…" maxlength="40" />
					</div>
				</div>
				<div class="arena-slm-sessions">
					<div class="arena-slm-session-list"></div>
				</div>
			</div>
		</div>
	`;

	const close = () => overlay.remove();
	overlay.querySelector(".arena-slm-close")!.addEventListener("click", close);
	overlay.querySelector(".arena-slm-backdrop")!.addEventListener("click", close);

	const folderList = overlay.querySelector(".arena-slm-folder-list")!;
	const sessionList = overlay.querySelector(".arena-slm-session-list")!;
	const folderInput = overlay.querySelector(".arena-slm-input") as HTMLInputElement;

	function renderFolders() {
		folderList.innerHTML = "";
		foldersState.folders.forEach((folder) => {
			const el = document.createElement("div");
			const isActive = foldersState.activeFolderId === folder.id;
			const isSystem = folder.id === INBOX_ID || folder.id === "archive";
			el.className = "arena-slm-folder-item" + (isActive ? " active" : "");
			const count = getSessionsInFolder(folder.id).length;

			const nameSpan = document.createElement("span");
			nameSpan.className = "arena-slm-folder-name";
			nameSpan.textContent = folder.name;
			el.appendChild(nameSpan);

			const countSpan = document.createElement("span");
			countSpan.className = "arena-slm-folder-count";
			countSpan.textContent = String(count);
			el.appendChild(countSpan);

			if (isActive) el.classList.add("active");
			el.addEventListener("click", () => {
				foldersState.activeFolderId = folder.id;
				renderFolders();
				renderSessions();
			});

			// Rename on double-click (not for system folders)
			if (!isSystem) {
				el.addEventListener("dblclick", (e) => {
					e.stopPropagation();
					const newName = prompt("Rename folder:", folder.name);
					if (newName?.trim()) {
						renameFolder(folder.id, newName);
						renderFolders();
					}
				});
				const delBtn = document.createElement("button");
				delBtn.className = "arena-slm-folder-del";
				delBtn.textContent = "✕";
				delBtn.title = "Delete folder";
				delBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					const folderName = folder.name;
					if (confirm(`Delete "${folderName}"? Sessions go to Inbox.`)) {
						deleteFolder(folder.id);
						if (foldersState.activeFolderId === folder.id) foldersState.activeFolderId = INBOX_ID;
						renderFolders();
						renderSessions();
					}
				});
				el.appendChild(delBtn);
			}
			folderList.appendChild(el);
		});
	}

	function renderSessions() {
		sessionList.innerHTML = "";
		const sessions = getSessionsInFolder(foldersState.activeFolderId);
		if (sessions.length === 0) {
			const empty = document.createElement("div");
			empty.className = "arena-slm-empty";
			empty.textContent = "No sessions";
			sessionList.appendChild(empty);
			return;
		}
		sessions.forEach((s) => {
			const el = document.createElement("div");
			el.className = "arena-slm-session-item";
			const titleDiv = document.createElement("div");
			titleDiv.className = "arena-slm-session-title";
			titleDiv.textContent = s.title || "未命名会话";
			el.appendChild(titleDiv);

			const metaDiv = document.createElement("div");
			metaDiv.className = "arena-slm-session-meta";
			metaDiv.textContent = s.updatedAt ? new Date(s.updatedAt).toLocaleDateString() : "";
			el.appendChild(metaDiv);

			const moveBtn = document.createElement("select");
			moveBtn.className = "arena-slm-move-select";
			moveBtn.title = "Move to folder";
			foldersState.folders.forEach((f) => {
				const opt = document.createElement("option");
				opt.value = f.id;
				opt.textContent = f.name;
				if (f.id === s.folderId) opt.selected = true;
				moveBtn.appendChild(opt);
			});
			moveBtn.addEventListener("change", () => {
				addSessionToFolder(s.sessionId, s.title, moveBtn.value);
				renderSessions();
				renderFolders();
			});
			el.appendChild(moveBtn);
			sessionList.appendChild(el);
		});
	}

	folderInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && folderInput.value.trim()) {
			const folder = createFolder(folderInput.value.trim());
			if (folder) {
				folderInput.value = "";
				renderFolders();
			}
		}
	});

	renderFolders();
	renderSessions();
	container.appendChild(overlay);

	// Focus close on open
	overlay.querySelector<HTMLButtonElement>(".arena-slm-close")?.focus();
}

// ─── Sprint 9: Session Library Modal ──────────────────────────────────────────────────────────

type FolderState = {
	folders: Array<{
		id: string;
		name: string;
		createdAt: number;
		updatedAt: number;
	}>;
	sessions: Map<
		string,
		{
			sessionId: string;
			title: string;
			folderId: string;
			createdAt: number;
			updatedAt: number;
		}
	>;
	activeFolderId: string;
};

// @ts-ignore — deprecated fallback, kept for emergency recovery
function _showSessionLibraryModal(
	shadowRoot: ShadowRoot,
	foldersState: FolderState,
	getSessionsInFolder: (
		folderId: string,
	) => Array<{
		sessionId: string;
		title: string;
		folderId: string;
		createdAt: number;
		updatedAt: number;
	}>,
	createFolder: (
		name: string,
	) => {
		id: string;
		name: string;
		createdAt: number;
		updatedAt: number;
	} | null,
	deleteFolder: (folderId: string) => void,
	renameFolder: (folderId: string, newName: string) => void,
	addSessionToFolder: (
		sessionId: string,
		title: string,
		folderId: string,
	) => void,
	INBOX_ID: string,
	refreshUI: () => void,
) {
	const existing = shadowRoot.querySelector(".session-library-modal");
	if (existing) {
		existing.remove();
		return;
	}

	const overlay = document.createElement("div");
	overlay.className = "session-library-modal";
	overlay.innerHTML = `
		<div class="slm-overlay"></div>
		<div class="slm-box">
			<div class="slm-header">
				<span class="slm-title">🗂 Session Library</span>
				<button class="slm-close" title="Close">✕</button>
			</div>
			<div class="slm-body">
				<div class="slm-folders">
					<div class="slm-folder-list"></div>
					<div class="slm-new-folder">
						<input class="slm-folder-input" placeholder="+ New folder…" maxlength="40" />
					</div>
				</div>
				<div class="slm-sessions">
					<div class="slm-session-list"></div>
				</div>
			</div>
		</div>
	`;

	const close = () => {
		overlay.remove();
		refreshUI();
	};
	overlay.querySelector(".slm-close")!.addEventListener("click", close);
	overlay.querySelector(".slm-overlay")!.addEventListener("click", close);

	const folderList = overlay.querySelector(".slm-folder-list")!;
	const sessionList = overlay.querySelector(".slm-session-list")!;
	const folderInput = overlay.querySelector(
		".slm-folder-input",
	) as HTMLInputElement;

	function renderFolders() {
		folderList.innerHTML = "";
		foldersState.folders.forEach((folder) => {
			const el = document.createElement("div");
			const isActive = foldersState.activeFolderId === folder.id;
			const isSystem = folder.id === INBOX_ID || folder.id === "archive";
			el.className = "slm-folder-item" + (isActive ? " active" : "");
			const count = getSessionsInFolder(folder.id).length;
			el.innerHTML = `<span class="slm-folder-name">${folder.name}</span><span class="slm-folder-count">${count}</span>`;
			if (isActive) el.classList.add("active");
			el.addEventListener("click", () => {
				foldersState.activeFolderId = folder.id;
				renderFolders();
				renderSessions();
			});
			// Rename on double-click (not for system folders)
			if (!isSystem) {
				el.addEventListener("dblclick", (e) => {
					e.stopPropagation();
					const newName = prompt("Rename folder:", folder.name);
					if (newName?.trim()) {
						renameFolder(folder.id, newName);
						renderFolders();
					}
				});
				const delBtn = document.createElement("button");
				delBtn.className = "slm-folder-del";
				delBtn.textContent = "✕";
				delBtn.title = "Delete folder";
				delBtn.addEventListener("click", (e) => {
					e.stopPropagation();
					if (confirm(`Delete "${folder.name}"? Sessions go to Inbox.`)) {
						deleteFolder(folder.id);
						if (foldersState.activeFolderId === folder.id)
							foldersState.activeFolderId = INBOX_ID;
						renderFolders();
						renderSessions();
					}
				});
				el.appendChild(delBtn);
			}
			folderList.appendChild(el);
		});
	} // end renderFolders

	function renderSessions() {
		sessionList.innerHTML = "";
		const sessions = getSessionsInFolder(foldersState.activeFolderId);
		if (sessions.length === 0) {
			sessionList.innerHTML = '<div class="slm-empty">No sessions</div>';
			return;
		}
		sessions.forEach((s) => {
			const el = document.createElement("div");
			el.className = "slm-session-item";
			const date = s.updatedAt
				? new Date(s.updatedAt).toLocaleDateString()
				: "";
			el.innerHTML = `<div class="slm-session-title">${s.title || "未命名会话"}</div><div class="slm-session-meta">${date}</div>`;
			// Move dropdown
			const moveBtn = document.createElement("select");
			moveBtn.className = "slm-move-select";
			moveBtn.title = "Move to folder";
			foldersState.folders.forEach((f) => {
				const opt = document.createElement("option");
				opt.value = f.id;
				opt.textContent = f.name;
				if (f.id === s.folderId) opt.selected = true;
				moveBtn.appendChild(opt);
			});
			moveBtn.addEventListener("change", () => {
				addSessionToFolder(s.sessionId, s.title, moveBtn.value);
				renderSessions();
				renderFolders();
			});
			el.appendChild(moveBtn);
			sessionList.appendChild(el);
		});
	}

	folderInput.addEventListener("keydown", (e) => {
		if (e.key === "Enter" && folderInput.value.trim()) {
			const folder = createFolder(folderInput.value.trim());
			if (folder) {
				folderInput.value = "";
				renderFolders();
			}
		}
	});

	renderFolders();
	renderSessions();
	shadowRoot.appendChild(overlay);
}
