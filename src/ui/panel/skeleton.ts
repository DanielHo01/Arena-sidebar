// ui/panel/skeleton.ts — the panel shell: header, search, list container, FAB
// handoff, and style injection into the shadow root.

import { conversationStore } from "../../conversationStore";
import { panel } from "../../state";
import { isSessionRoute } from "../../platform/route";
import { ICON_X_SVG, UI_STYLES } from "../styles";
import { exportConversation, summarizeRounds } from "../modals";
import { cycleThemeMode } from "../../features/theme";
import { THEME_GLYPHS } from "../../platform/theme";
import { getStorageUsage } from "../../platform/storage";

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

	// Storage quota dot (#23), first in the actions row. Updated by
	// updateStorageDot(), which content.ts calls from refreshUI; neutral
	// until the first usage sample lands.
	const storageDot = document.createElement("span");
	storageDot.className = "storage-dot";
	storageDot.title = "Storage usage: measuring…";
	headerActions.appendChild(storageDot);

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
	const isCharacterChat = isSessionRoute(location.pathname);
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

	// Theme button — auto → light → dark (features/theme.ts persists the
	// choice and repaints every tab). The button is its own status display,
	// so it refreshes itself on click; a rebuild picks the mode up anyway.
	const setThemeBtnLabel = () => {
		themeBtn.textContent = THEME_GLYPHS[panel.themeMode];
		themeBtn.title =
			panel.themeMode === "auto"
				? "Theme: auto (follow page) — click for light"
				: panel.themeMode === "light"
					? "Theme: light — click for dark"
					: "Theme: dark — click for auto";
	};
	const themeBtn = makeHeaderBtn(THEME_GLYPHS[panel.themeMode], "Theme", () => {
		cycleThemeMode();
		setThemeBtnLabel();
	});
	setThemeBtnLabel();
	headerActions.appendChild(themeBtn);

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

// ─── Storage quota dot (#23) ─────────────────────────────────────────────────────────────
//
// refreshUI calls this on every render, so the cheap path (no panel yet, or
// sampled recently) must do no async work at all — just two guards.

let lastDotSampleAt = 0;
const DOT_SAMPLE_THROTTLE_MS = 60_000;

function dotLevel(frac: number): string {
	if (frac >= 0.95) return "full";
	if (frac >= 0.8) return "high";
	if (frac >= 0.5) return "warn";
	return "";
}

function formatMB(bytes: number): string {
	return (bytes / (1024 * 1024)).toFixed(1) + "MB";
}

/**
 * Refresh the header storage dot from chrome.storage usage. No-op when the
 * panel is not rendered or a sample landed within the last minute.
 */
export function updateStorageDot(shadowRoot: ShadowRoot): void {
	if (!shadowRoot.querySelector(".storage-dot")) return;
	const now = Date.now();
	if (now - lastDotSampleAt < DOT_SAMPLE_THROTTLE_MS) return;
	lastDotSampleAt = now;
	void (async () => {
		const usage = await getStorageUsage();
		const dot = shadowRoot.querySelector(".storage-dot");
		if (!dot) return;
		if (!usage || usage.quota <= 0) {
			dot.setAttribute("title", "Storage usage: unavailable");
			return;
		}
		const frac = usage.used / usage.quota;
		const level = dotLevel(frac);
		dot.className = "storage-dot" + (level ? " " + level : "");
		dot.setAttribute(
			"title",
			`Storage usage: ${formatMB(usage.used)} / ${formatMB(usage.quota)} (${Math.round(frac * 100)}%)`,
		);
	})();
}

// ─── Ensure styles are injected ──────────────────────────────────────────────────────────

export function ensureStyles(shadowRoot: ShadowRoot) {
	if (shadowRoot.querySelector("style")) return;
	const s = document.createElement("style");
	s.textContent = UI_STYLES;
	shadowRoot.appendChild(s);
}
