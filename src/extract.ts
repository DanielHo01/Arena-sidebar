// DOM extraction — collect messages from arena.ai's DOM tree via Shadow DOM traversal.
// Public exports:
//   extractMessages — () => ExtractedMessage[]  (main entry point)
//   generateStableId — stable per-element ID used for round grouping

import type { SidebarMessage } from "./types";
import { cachedElements } from "./state";

// P0 #1 — cooldown prevents expensive full-DOM scans on every MutationObserver trigger.
// P0 #1 — cooldown prevents expensive full-DOM scans on every MutationObserver trigger.
export const EXTRACT_COOLDOWN_MS = 800;

// ─── DOM change detection ─────────────────────────────────────────────────────────────
// Avoid re-extracting when DOM hasn't changed since last extract.
// Uses content-aware signature: element count + role sequence + first/last content.
// Covers: same element count but different text, streaming growth, node replacement.
let lastExtractSig = "";

/** Reset extract state on SPA route change. */
export function resetExtractState(): void {
	lastExtractSig = "";
}

function domSignature(all: Array<{ el: Element; role: "user" | "assistant" }>): string {
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

function collectAllElements(): Array<{
	el: Element;
	role: "user" | "assistant";
}> {
	const all: Array<{ el: Element; role: "user" | "assistant" }> = [];
	const MIN_USER_LEN = 3;
	const MIN_ASSISTANT_LEN = 50;

	// P0 #9 — cheap checks BEFORE getBoundingClientRect (which forces reflow).
	const isLikelyRealMessage = (
		el: Element,
		role: "user" | "assistant",
	): boolean => {
		const tag = el.tagName.toLowerCase();
		if (["script", "style", "noscript", "template"].includes(tag)) return false;
		if (el.getAttribute("aria-hidden") === "true") return false;
		const text = (el.textContent || "").trim();
		const minLen = role === "user" ? MIN_USER_LEN : MIN_ASSISTANT_LEN;
		if (text.length < minLen) return false;
		if (role === "user") {
			const lines = text
				.split(/[。！？.!?\n]/)
				.filter((s) => s.trim().length > 0);
			if (lines.length > 30) return false;
		}
		// P0 #9 — getBoundingClientRect is last; it forces layout so keep it after cheap filters.
		const rect = (el as HTMLElement).getBoundingClientRect?.();
		if (rect && rect.width < 200) return false;
		if (rect && role === "user" && rect.width > 1000) return false;
		return true;
	};

	const visit = (root: Element | Document) => {
		try {
			root.querySelectorAll(USER_MESSAGE_SELECTOR).forEach((el) => {
				if (!isLikelyRealMessage(el, "user")) return;
				all.push({ el, role: "user" });
			});
		} catch (_e) {
			/* intentionally empty — selector may throw on detached nodes */
		}
		try {
			root.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR).forEach((el) => {
				if (!isLikelyRealMessage(el, "assistant")) return;
				all.push({ el, role: "assistant" });
			});
		} catch (_e) {
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
	const dedupedEls = dedupeByRoot(all.map((x) => x.el));
	const roleByEl = new Map<Element, "user" | "assistant">();
	for (const { el, role } of all) {
		if (!roleByEl.has(el)) roleByEl.set(el, role);
	}
	return dedupedEls.map((el) => ({
		el,
		role: roleByEl.get(el) || "assistant",
	}));
}

// ─── Main extraction ──────────────────────────────────────────────────────────────

export function extractMessages(): SidebarMessage[] {
	// P1 fix: skip if DOM hasn't changed since last extract (avoids O(n) rebuild).
	// Collect elements ONCE — the signature check reuses the same batch instead of
	// walking the whole DOM a second time (getBoundingClientRect forces reflow, so
	// the old two-pass version paid the layout cost twice per scan).
	const all = collectAllElements();
	if (!domChanged(all)) return [];
	// Sprint 3.2 fix: do NOT clear cachedElements — it preserves anchor bindings
	// for previously extracted (now possibly recycled) DOM elements.
	// Stale entries for recycled elements naturally become inert in bindDomAnchors.
	const messages: SidebarMessage[] = [];
	all
		.sort((a, b) => compareDocOrder(a.el, b.el))
		.forEach(({ el, role }, idx) => {
			const content = extractText(el);
			if (!content || content.length < 1) return;
			const id = generateStableId(el, idx);
			el.setAttribute("data-ai-sidebar-id", id);
			cachedElements.set(id, el);
			messages.push({ id, role, content, origin: "dom", domId: id });
		});
	return messages;
}
