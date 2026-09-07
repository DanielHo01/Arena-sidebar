// core/fingerprint.ts — pure content-keying primitives.
//
// No imports from anywhere in src/: this module decides whether two messages
// are "the same message", and that decision must not depend on store state, DOM
// or platform.
//
// Extracted from conversationStore.ts (Phase 3) where fingerprint/baseKey/
// withOccurrences were private and therefore untestable in isolation.

import type { SidebarMessage } from "../types";

/**
 * Stable content fingerprint.
 *
 * Normalizes (trim, collapse whitespace, lowercase) then keys on length plus
 * the first 80 normalized characters, over at most the first 200. The 80-char
 * window is a deliberate precision/cost trade: two messages that share a 300-char
 * prefix collide. Phase 1 kept this rather than widening the key, because the
 * cost of a collision is bounded (DOM text wins the merge) and widening would
 * change every stored key.
 */
export function fingerprint(text: string): string {
	const normalized = text
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.slice(0, 200);
	return "fp-" + normalized.length + "-" + normalized.slice(0, 80);
}

/** Content-only dedup key: the stored fingerprint if present, else computed. */
export function baseKey(msg: SidebarMessage): string {
	return msg.fingerprint || fingerprint(msg.content);
}

/**
 * Number each message by how many times its content already appeared earlier in
 * this source's own ordered list. Two properties matter:
 *   - re-extracting an unchanged DOM renumbers identically, so refresh stays
 *     idempotent and does not duplicate anything;
 *   - genuine repeats (the user really did send "继续" three times) get distinct
 *     numbers and therefore survive as distinct turns.
 * Cross-source merge still works because both DOM and capture enumerate their
 * occurrences in the same chronological order, so capture's 0th "继续" lands on
 * DOM's 0th.
 *
 * Pure: returns new message objects, never mutates the input.
 */
export function withOccurrences(msgs: SidebarMessage[]): SidebarMessage[] {
	const seen = new Map<string, number>();
	return msgs.map((m) => {
		const base = fingerprint(m.content);
		const n = seen.get(base) ?? 0;
		seen.set(base, n + 1);
		return { ...m, fingerprint: base, occurrence: n };
	});
}
