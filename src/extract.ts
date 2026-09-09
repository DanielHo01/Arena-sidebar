// DOM extraction — collect messages from arena.ai's DOM tree via Shadow DOM traversal.
// Public exports:
//   extractMessages — () => ExtractedMessage[]  (main entry point)
//   generateStableId — stable per-element ID used for round grouping

import type { SidebarMessage } from "./types";
import { cachedElements } from "./state";

// ─── DOM change detection ─────────────────────────────────────────────────────────────
// Avoid re-extracting when DOM hasn't changed since last extract.
// Uses content-aware signature: element count + role sequence + first/last content.
// Covers: same element count but different text, streaming growth, node replacement.
let lastExtractSig = "";

/** Why a selector hit was dropped. Counted in ExtractStats.dropped. */
export type ExtractDropReason =
	| "tag"
	| "ariaHidden"
	| "tooShort"
	| "tooManyLines"
	| "tooNarrow"
	| "emptyText"
	| "nestedDupe";

/** Snapshot of the most recent extractMessages() call. */
export interface ExtractStats {
	userHits: number;
	asstHits: number;
	kept: number;
	unchanged: boolean;
	dropped: Record<ExtractDropReason, number>;
}

function emptyDropped(): Record<ExtractDropReason, number> {
	return {
		tag: 0,
		ariaHidden: 0,
		tooShort: 0,
		tooManyLines: 0,
		tooNarrow: 0,
		emptyText: 0,
		nestedDupe: 0,
	};
}

function emptyStats(): ExtractStats {
	return {
		userHits: 0,
		asstHits: 0,
		kept: 0,
		unchanged: false,
		dropped: emptyDropped(),
	};
}

let lastExtractStats: ExtractStats = emptyStats();

/** Copy of the last extract's filter counts. Tests and the console probe read this. */
export function getLastExtractStats(): ExtractStats {
	return {
		...lastExtractStats,
		dropped: { ...lastExtractStats.dropped },
	};
}

/** Reset extract state on SPA route change. */
export function resetExtractState(): void {
	lastExtractSig = "";
	lastExtractStats = emptyStats();
}

function compactDropped(dropped: Record<ExtractDropReason, number>): string {
	const parts: string[] = [];
	for (const [reason, n] of Object.entries(dropped)) {
		if (n > 0) parts.push(`${reason}:${n}`);
	}
	return parts.length > 0 ? parts.join(",") : "none";
}

function logExtractStats(stats: ExtractStats): void {
	const line =
		`[AI Sidebar] extract: hits user=${stats.userHits} asst=${stats.asstHits} ` +
		`kept=${stats.kept} unchanged=${stats.unchanged} dropped={${compactDropped(stats.dropped)}}`;
	const allFiltered =
		!stats.unchanged && stats.kept === 0 && stats.userHits + stats.asstHits > 0;
	if (allFiltered) console.warn(line);
	else if (!stats.unchanged) console.log(line);
}

function domSignature(
	all: Array<{ el: Element; role: "user" | "assistant" }>,
): string {
	if (all.length === 0) return "empty";
	const first = all.find((x) => x.role === "user");
	const last = [...all].reverse().find((x) => x.role === "assistant");
	const first32 = first
		? (first.el.textContent?.trim().slice(0, 32) ?? "")
		: "";
	const lastRole = last ? last.role : "";
	const last64 = last ? (last.el.textContent?.trim().slice(0, 64) ?? "") : "";
	const lastLen = last ? (last.el.textContent?.trim().length ?? 0) : 0;
	const roles = all.map((x) => x.role[0]).join("");
	return [
		all.length,
		roles,
		first32.replace(/\s+/g, "_"),
		lastRole,
		last64.replace(/\s+/g, "_"),
		lastLen,
	].join("|");
}

function domChanged(
	all: Array<{ el: Element; role: "user" | "assistant" }>,
): boolean {
	const sig = domSignature(all);
	if (sig === lastExtractSig) return false;
	lastExtractSig = sig;
	return true;
}

// ─── Selectors (arena.ai specific — split from main module for easy tweaking) ─────

export const USER_MESSAGE_SELECTOR =
	'main [class*="bg-surface-raised"][class*="rounded-lg"]:not([class*="w-4"]):not([class*="inline-flex"])';
export const ASSISTANT_MESSAGE_SELECTOR =
	'main [class*="bg-surface-primary"][class*="flex-col"][class*="overflow-hidden"]';

// ─── Stable ID generation ─────────────────────────────────────────────────────────

export function generateStableId(el: Element, idx: number): string {
	if (el.id) return "el-" + el.id;
	const existing = el.getAttribute("data-ai-sidebar-id");
	if (existing) return existing;
	const id = "msg-" + idx + "-" + Math.random().toString(36).slice(2, 8);
	el.setAttribute("data-ai-sidebar-id", id);
	return id;
}

// ─── Text extraction ───────────────────────────────────────────────────────────────

// P0 #4 — TreeWalker avoids the expensive cloneNode(true) on potentially large message subtrees.
export function extractText(el: Element): string {
	const parts: string[] = [];
	const walker = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, {
		acceptNode(node) {
			const parent = node.parentElement;
			if (!parent) return NodeFilter.FILTER_REJECT;
			if (
				parent.closest('button, [role="button"], nav, [aria-hidden="true"]')
			) {
				return NodeFilter.FILTER_REJECT;
			}
			return NodeFilter.FILTER_ACCEPT;
		},
	});
	while (walker.nextNode()) {
		const t = walker.currentNode.textContent?.replace(/\s+/g, " ").trim();
		if (t) parts.push(t);
	}
	return parts.join(" ");
}

// ─── Document order ────────────────────────────────────────────────────────────────

function compareDocOrder(a: Element, b: Element): number {
	const pos = a.compareDocumentPosition(b);
	if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
	if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
	return 0;
}

// ─── Deduplication ────────────────────────────────────────────────────────────────

function dedupeByRoot(elements: Element[]): Element[] {
	const seen = new Set<Element>();
	const out: Element[] = [];
	for (const el of elements) {
		if (seen.has(el)) continue;
		let dup = false;
		for (const other of seen) {
			if (other.contains(el) || el.contains(other)) {
				dup = true;
				break;
			}
		}
		if (!dup) {
			seen.add(el);
			out.push(el);
		}
	}
	return out;
}

// ─── Element collection ────────────────────────────────────────────────────────────

const MIN_USER_LEN = 3;
const MIN_ASSISTANT_LEN = 50;

/**
 * Classify a selector hit. Returns a drop reason, or null when it looks like a
 * real message. Width > 1000 used to reject user bubbles (#28): on a wide
 * monitor Arena's cards easily exceed that, so every user message vanished
 * even though the selector hit. The lower bound stays — it filters chrome.
 */
function classifyHit(
	el: Element,
	role: "user" | "assistant",
): ExtractDropReason | null {
	const tag = el.tagName.toLowerCase();
	if (["script", "style", "noscript", "template"].includes(tag)) return "tag";
	if (el.getAttribute("aria-hidden") === "true") return "ariaHidden";
	const text = (el.textContent || "").trim();
	const minLen = role === "user" ? MIN_USER_LEN : MIN_ASSISTANT_LEN;
	if (text.length < minLen) return "tooShort";
	if (role === "user") {
		const lines = text
			.split(/[。！？.!?\n]/)
			.filter((s) => s.trim().length > 0);
		if (lines.length > 30) return "tooManyLines";
	}
	// P0 #9 — getBoundingClientRect is last; it forces layout so keep it after cheap filters.
	const rect = (el as HTMLElement).getBoundingClientRect?.();
	if (rect && rect.width < 200) return "tooNarrow";
	return null;
}

function collectAllElements(): {
	items: Array<{ el: Element; role: "user" | "assistant" }>;
	userHits: number;
	asstHits: number;
	dropped: Record<ExtractDropReason, number>;
} {
	const all: Array<{ el: Element; role: "user" | "assistant" }> = [];
	const dropped = emptyDropped();
	let userHits = 0;
	let asstHits = 0;

	const visit = (root: Element | Document) => {
		try {
			const users = root.querySelectorAll(USER_MESSAGE_SELECTOR);
			userHits += users.length;
			users.forEach((el) => {
				const reason = classifyHit(el, "user");
				if (reason) {
					dropped[reason]++;
					return;
				}
				all.push({ el, role: "user" });
			});
		} catch {
			/* intentionally empty — selector may throw on detached nodes */
		}
		try {
			const assts = root.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR);
			asstHits += assts.length;
			assts.forEach((el) => {
				const reason = classifyHit(el, "assistant");
				if (reason) {
					dropped[reason]++;
					return;
				}
				all.push({ el, role: "assistant" });
			});
		} catch {
			/* intentionally empty — selector may throw on detached nodes */
		}
		const anyRoot = root as Element & { shadowRoot?: ShadowRoot | null };
		if (anyRoot.shadowRoot) visit(anyRoot.shadowRoot as unknown as Element);
		root.querySelectorAll("*").forEach((el) => {
			const sr = (el as Element & { shadowRoot?: ShadowRoot | null })
				.shadowRoot;
			if (sr) visit(sr as unknown as Element);
		});
	};
	visit(document);
	const beforeDedupe = all.length;
	const dedupedEls = dedupeByRoot(all.map((x) => x.el));
	dropped.nestedDupe += beforeDedupe - dedupedEls.length;
	const roleByEl = new Map<Element, "user" | "assistant">();
	for (const { el, role } of all) {
		if (!roleByEl.has(el)) roleByEl.set(el, role);
	}
	return {
		items: dedupedEls.map((el) => ({
			el,
			role: roleByEl.get(el) || "assistant",
		})),
		userHits,
		asstHits,
		dropped,
	};
}

// ─── Main extraction ──────────────────────────────────────────────────────────────

/**
 * Scan the page and return the messages currently rendered.
 *
 * CONTRACT — an empty array is deliberately ambiguous, and callers must not read
 * meaning into it. It is returned both when the DOM has not changed since the
 * last scan (the fast path below) and when the page genuinely holds no messages.
 *
 * That is safe today because both call sites feed the result straight into
 * refreshStore(), which upserts and returns early on empty input — so "nothing
 * changed" and "nothing there" both correctly produce "leave the store alone".
 * Nothing is ever cleared.
 *
 * If a future caller needs to tell those two apart (for example to detect a
 * cleared conversation), it must ask separately rather than branch on length:
 * change this signature to a discriminated result at that point, and update
 * both call sites together. Do not "fix" the ambiguity by returning null for the
 * unchanged case — the current callers would then skip legitimate empty scans.
 */
export function extractMessages(): SidebarMessage[] {
	// P1 fix: skip if DOM hasn't changed since last extract (avoids O(n) rebuild).
	// Collect elements ONCE — the signature check reuses the same batch instead of
	// walking the whole DOM a second time (getBoundingClientRect forces reflow, so
	// the old two-pass version paid the layout cost twice per scan).
	const collected = collectAllElements();
	if (!domChanged(collected.items)) {
		lastExtractStats = {
			userHits: collected.userHits,
			asstHits: collected.asstHits,
			kept: 0,
			unchanged: true,
			dropped: collected.dropped,
		};
		return [];
	}
	// Sprint 3.2 fix: do NOT clear cachedElements — it preserves anchor bindings
	// for previously extracted (now possibly recycled) DOM elements.
	// Stale entries for recycled elements naturally become inert in bindDomAnchors.
	const messages: SidebarMessage[] = [];
	collected.items
		.sort((a, b) => compareDocOrder(a.el, b.el))
		.forEach(({ el, role }, idx) => {
			const content = extractText(el);
			if (!content || content.length < 1) {
				collected.dropped.emptyText++;
				return;
			}
			const id = generateStableId(el, idx);
			el.setAttribute("data-ai-sidebar-id", id);
			cachedElements.set(id, el);
			messages.push({ id, role, content, origin: "dom", domId: id });
		});
	lastExtractStats = {
		userHits: collected.userHits,
		asstHits: collected.asstHits,
		kept: messages.length,
		unchanged: false,
		dropped: collected.dropped,
	};
	logExtractStats(lastExtractStats);
	return messages;
}
