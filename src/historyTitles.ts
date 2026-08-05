// History title editing — double-click on Arena sidebar /c/ links to rename them.
// Titles are persisted directly to chrome.storage.local under historyTitle_<sid> keys.
// No external dependency on folders or sessionMeta.
//
// Public exports:
//   setupHistoryTitleEditing — scans and binds double-click rename to all /c/ links

// ─── Storage key ─────────────────────────────────────────────────────────────────────

const TITLE_KEY_PREFIX = "historyTitle_";

function titleKey(sid: string): string {
	return TITLE_KEY_PREFIX + sid;
}

// ─── Title cache ─────────────────────────────────────────────────────────────────────
// In-memory cache so that restoreTitle() does not O(N) scan storage on every
// DOM mutation. cacheTitle() is called on every successful save; restoreTitle()
// reads the cache first (O(1)) before falling back to chrome.storage.local.

const titleCache = new Map<string, string>();
let cacheLoaded = false;

// Load all historyTitle_* keys into the cache in ONE storage call. After this the
// restore path is pure in-memory — no per-link chrome.storage.local.get on every
// DOM change (Arena's sidebar can hold dozens of /c/ links, and the observer fires
// on every mutation).
function loadTitleCache(): void {
	if (cacheLoaded) return;
	cacheLoaded = true;
	chrome.storage.local.get(null, (items) => {
		if (chrome.runtime.lastError) return;
		for (const [key, value] of Object.entries(items)) {
			if (key.startsWith(TITLE_KEY_PREFIX) && typeof value === "string" && value) {
				const sid = key.slice(TITLE_KEY_PREFIX.length);
				titleCache.set(sid, value);
			}
		}
	});
}

// ─── Apply custom title to an anchor element ─────────────────────────────────────────
// Only rewrites text, never replaces element structure: overwriting anchor.textContent
// would destroy React-rendered children (spans, svg) and trigger an infinite
// re-render loop with Arena's virtual DOM.

function applyCustomTitle(anchor: Element, customTitle: string) {
	const candidates = anchor.querySelectorAll<HTMLElement>("span, div, p");
	let bestCandidate: HTMLElement | null = null;
	let bestLen = 0;
	for (const el of candidates) {
		const t = (el.textContent || "").trim();
		if (t.length > bestLen) {
			bestLen = t.length;
			bestCandidate = el;
		}
	}
	if (bestCandidate !== null) {
		bestCandidate.textContent = customTitle;
		return;
	}
	// No structural child found — rewrite the longest text node in place.
	let bestTextNode: Text | null = null;
	bestLen = 0;
	const walker = document.createTreeWalker(anchor, NodeFilter.SHOW_TEXT);
	let node: Node | null;
	while ((node = walker.nextNode())) {
		const t = (node.textContent || "").trim();
		if (t.length > bestLen) {
			bestLen = t.length;
			bestTextNode = node as Text;
		}
	}
	if (bestTextNode) {
		bestTextNode.textContent = customTitle;
	} else {
		anchor.appendChild(document.createTextNode(customTitle));
	}
}

// ─── Restore ─────────────────────────────────────────────────────────────────────────
// Idempotent: applies custom title only when the visible text differs, so it can be
// re-run on every DOM change without side effects.

function restoreTitle(item: HTMLElement, sid: string): void {
	// Check in-memory cache first (O(1)).
	const cached = titleCache.get(sid);
	if (cached !== undefined) {
		if (item.textContent && item.textContent.trim() !== cached) {
			applyCustomTitle(item, cached);
		}
		return;
	}
	// Cache miss — load this specific key from storage.
	chrome.storage.local.get(titleKey(sid), (items) => {
		if (chrome.runtime.lastError) return;
		const stored = items[titleKey(sid)];
		if (typeof stored === "string" && stored) {
			titleCache.set(sid, stored);
			if (item.textContent && item.textContent.trim() !== stored) {
				applyCustomTitle(item, stored);
			}
		}
	});
}

function restoreAllTitles(): void {
	const items = document.querySelectorAll('a[href*="/c/"]');
	items.forEach((item) => {
		const href = item.getAttribute("href") || "";
		const sid = href.match(/\/c\/([^/?]+)/)?.[1];
		if (sid) restoreTitle(item as HTMLElement, sid);
	});
}

// ─── Save ───────────────────────────────────────────────────────────────────────────

function saveTitle(sid: string, title: string): void {
	// Update in-memory cache immediately.
	titleCache.set(sid, title);
	// Persist to chrome.storage.local.
	chrome.storage.local.set({ [titleKey(sid)]: title }, () => {
		// Fire-and-forget; no retry needed for title saves.
	});
}

// ─── Main setup ─────────────────────────────────────────────────────────────────────

export function setupHistoryTitleEditing() {
	loadTitleCache();
	restoreAllTitles();
	const items = document.querySelectorAll('a[href*="/c/"]');
	items.forEach((item) => {
		const itemEl = item as HTMLElement;
		const href = item.getAttribute("href") || "";
		const sid = href.match(/\/c\/([^/?]+)/)?.[1];
		if (!sid) return;
		if (itemEl.dataset.aiSidebarEditable === "1") return;
		itemEl.dataset.aiSidebarEditable = "1";
		itemEl.title = (itemEl.title || "") + " | Double-click to rename";

		// Double-click → inline edit.
		itemEl.addEventListener(
			"dblclick",
			(e) => {
				e.preventDefault();
				e.stopPropagation();
				const target =
					(e.target as HTMLElement).closest("span, div, p") || itemEl;
				const oldText = (target.textContent || "").trim();
				const input = document.createElement("input");
				input.type = "text";
				input.value = oldText;
				input.style.cssText =
					"width: 100%; min-width: 0; font: inherit; background: white; border: 1px solid #3b82f6; padding: 2px 4px; border-radius: 3px; color: black;";
				target.textContent = "";
				target.appendChild(input);
				input.focus();
				input.select();

				let saved = false;
				const doSave = () => {
					if (saved) return;
					saved = true;
					const newText = (input.value || "").trim() || oldText;
					saveTitle(sid, newText);
					target.textContent = newText;
				};
				const cancel = () => {
					if (saved) return;
					saved = true;
					target.textContent = oldText;
				};
				input.addEventListener("blur", doSave);
				input.addEventListener("keydown", (ev) => {
					ev.stopPropagation();
					if (ev.key === "Enter") {
						ev.preventDefault();
						input.blur();
					}
					if (ev.key === "Escape") {
						input.removeEventListener("blur", doSave);
						cancel();
					}
				});
			},
			true,
		);
	});
}
