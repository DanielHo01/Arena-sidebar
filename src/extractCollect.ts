// extractCollect — the collection half of DOM extraction.
//
// Split out of ./extract.ts (Track A4): selector sweep (collectAllElements),
// hit classification, nested-dupe dedupe, per-element text, stable ids and
// document order. The scan entry point (extractMessages), change detection
// and stats stay in extract.ts, which imports this file one-directionally.

import {
	ASSISTANT_MESSAGE_SELECTOR,
	USER_MESSAGE_SELECTOR,
} from "./platform/arenaContract";

/** Why a selector hit was dropped. Counted in ExtractStats.dropped. */
export type ExtractDropReason =
	| "tag"
	| "ariaHidden"
	| "tooShort"
	| "tooManyLines"
	| "tooNarrow"
	| "emptyText"
	| "nestedDupe";

export function emptyDropped(): Record<ExtractDropReason, number> {
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

export function compareDocOrder(a: Element, b: Element): number {
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

// Keep these guards deliberately permissive. The selectors already identify
// Arena's message surfaces; these are only a last line of defence against
// obvious layout chrome. The previous values (30 sentences / 200px) rejected
// ordinary long prompts and narrow assistant cards on real pages (#32).
const MAX_USER_SENTENCES = 100;
const MIN_MESSAGE_WIDTH = 100;

/**
 * Classify a selector hit. Returns a drop reason, or null when it looks like a
 * real message. Width > 1000 used to reject user bubbles (#28): on a wide
 * monitor Arena's cards easily exceed that, so every user message vanished
 * even though the selector hit. The lower bound is intentionally only 100px —
 * it filters tiny chrome without rejecting a real narrow message bubble.
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
		if (lines.length > MAX_USER_SENTENCES) return "tooManyLines";
	}
	// P0 #9 — getBoundingClientRect is last; it forces layout so keep it after cheap filters.
	const rect = (el as HTMLElement).getBoundingClientRect?.();
	if (rect && rect.width > 0 && rect.width < MIN_MESSAGE_WIDTH)
		return "tooNarrow";
	return null;
}

export function collectAllElements(): {
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
