// DOM extraction — scan arena.ai's DOM tree and return rendered messages.
// The collection half (selector sweep, classification, dedupe, text, stable
// ids, order) lives in ./extractCollect.ts; this file keeps the scan entry
// point (extractMessages), change detection and stats.
// Public exports:
//   extractMessages — () => SidebarMessage[]  (main entry point)
//   getLastExtractStats / resetExtractState — stats + route-change reset

import type { SidebarMessage } from "./types";
import { cachedElements } from "./state";
import {
	ASSISTANT_MESSAGE_SELECTOR,
	USER_MESSAGE_SELECTOR,
} from "./platform/arenaContract";
import {
	collectAllElements,
	compareDocOrder,
	emptyDropped,
	extractText,
	generateStableId,
	type ExtractDropReason,
} from "./extractCollect";

export { ASSISTANT_MESSAGE_SELECTOR, USER_MESSAGE_SELECTOR };

// ─── DOM change detection ─────────────────────────────────────────────────────────────
// Avoid re-extracting when DOM hasn't changed since last extract.
// Uses content-aware signature: element count + role sequence + first/last content.
// Covers: same element count but different text, streaming growth, node replacement.
let lastExtractSig = "";

/** Snapshot of the most recent extractMessages() call. */
export interface ExtractStats {
	userHits: number;
	asstHits: number;
	kept: number;
	unchanged: boolean;
	dropped: Record<ExtractDropReason, number>;
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

// Only the suspicious case is reported: hits that all got filtered means the
// selectors match but the guards reject everything (usually an Arena markup
// change). Routine per-scan stats were console.log noise on every extract.
function warnIfAllFiltered(stats: ExtractStats): void {
	const allFiltered =
		!stats.unchanged && stats.kept === 0 && stats.userHits + stats.asstHits > 0;
	if (!allFiltered) return;
	console.warn(
		`[AI Sidebar] extract: hits user=${stats.userHits} asst=${stats.asstHits} ` +
			`kept=${stats.kept} dropped={${compactDropped(stats.dropped)}} — all filtered`,
	);
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
	warnIfAllFiltered(lastExtractStats);
	return messages;
}
