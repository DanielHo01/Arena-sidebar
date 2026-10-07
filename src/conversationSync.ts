// conversationSync — merge + mutation operations over the conversation store.
//
// refreshStore merges the three sources in priority order
// (bootstrap > capture > dom) through the upsertMessage primitive;
// addCapturedMessage ingests one capture message; editMessageContent applies
// a local correction. The store object, persistence, the change pub/sub and
// the maintenance ops loadFromStorage needs (bindDomAnchors, rebuildRounds,
// dropTombstonedMessages) stay in ./conversationStore.ts, which this file
// imports one-directionally — never the reverse, so no cycle is possible.

import type { SidebarMessage } from "./types";
import {
	bindDomAnchors,
	conversationStore,
	rebuildRounds,
} from "./conversationStore";
import { baseKey, fingerprint, withOccurrences } from "./core/fingerprint";
import { deletedMessageKeys, tombstoneKey } from "./rounds";

// ─── Merge helpers ─────────────────────────────────────────────────────────────────

/** Add a message to the store if not already present (by content + occurrence). */
function upsertMessage(msg: SidebarMessage): boolean {
	const base = baseKey(msg);
	const occ = msg.occurrence ?? 0;
	msg.fingerprint = base;
	msg.occurrence = occ;

	// #15: tombstoned messages never come back, however often the DOM
	// re-extracts them.
	if (deletedMessageKeys.has(tombstoneKey(base, occ))) return false;

	const existing = conversationStore.messages.find(
		(m) => baseKey(m) === base && (m.occurrence ?? 0) === occ,
	);
	if (existing) {
		// Merge: preserve existing domId even if new source doesn't have it.
		if (!existing.domId && msg.domId) existing.domId = msg.domId;
		// #15: a user edit wins over every re-extract — the overlay is keyed
		// by the ORIGINAL fingerprint, which is exactly what the DOM returns.
		if (existing.edited) return false;
		// Prefer capture origin over dom origin.
		if (msg.origin === "capture" && existing.origin !== "capture") {
			existing.content = msg.content;
			existing.capturedAt = msg.capturedAt;
			existing.origin = "capture";
		}
		return false; // not new
	}

	conversationStore.messages.push(msg);
	return true; // was new
}

// ─── Capture: add captured messages to store ───────────────────────────────────────

export function addCapturedMessage(msg: SidebarMessage): boolean {
	msg.origin = "capture";
	// Capture arrives one message at a time, so its occurrence index is the
	// number of already-merged capture messages with the same content. That
	// lines up with the DOM's own numbering for the normal case; if the hook
	// installed late and missed earlier repeats, the worst case is that this
	// message merges into the wrong occurrence and keeps DOM text instead of
	// capture text — no message or round is lost.
	const base = fingerprint(msg.content);
	let n = 0;
	for (const m of conversationStore.messages) {
		if (m.origin === "capture" && baseKey(m) === base) n++;
	}
	msg.fingerprint = base;
	msg.occurrence = n;
	return upsertMessage(msg);
}

// ─── Full refresh: merge all sources and rebuild ───────────────────────────────────

export function refreshStore(opts: {
	bootstrap?: SidebarMessage[];
	capture?: SidebarMessage[];
	dom?: SidebarMessage[];
	bindAnchors?: boolean;
}) {
	const { bootstrap = [], capture = [], dom = [], bindAnchors = true } = opts;
	const hadDom = dom.length > 0;

	// P3 fix: skip if nothing new to add (avoids O(n) rebuildRounds on every call).
	if (bootstrap.length === 0 && capture.length === 0 && dom.length === 0) {
		return;
	}

	// Priority merge: bootstrap → capture → dom. Each source is numbered
	// independently, so repeats inside one source survive while the same message
	// seen by two sources still merges.
	for (const m of withOccurrences(bootstrap)) {
		upsertMessage({ ...m, origin: "bootstrap" });
	}
	for (const m of withOccurrences(capture)) {
		upsertMessage({ ...m, origin: "capture" });
	}
	for (const m of withOccurrences(dom)) {
		upsertMessage({
			...m,
			role: m.role === "system" ? "assistant" : m.role,
			origin: "dom",
		});
	}

	// Sprint 3.2: always bind anchors to keep DOM ↔ store in sync (even if no new messages).
	if (bindAnchors) bindDomAnchors();

	// Compute rounds only when DOM content changed (P3).
	if (bootstrap.length > 0 || capture.length > 0 || hadDom) {
		rebuildRounds();
	}

	// Set lastOrigin to the highest-priority origin that contributed.
	if (capture.length > 0) conversationStore.lastOrigin = "capture";
	else if (bootstrap.length > 0) conversationStore.lastOrigin = "bootstrap";
	else if (dom.length > 0) conversationStore.lastOrigin = "dom";
}

// ─── Local message edit (#15) ──────────────────────────────────────────────────

/**
 * Replace one message's content with the user's correction. The fingerprint
 * deliberately still keys the DOM original, so re-extracts merge into this
 * message (and lose to the overlay via upsertMessage) instead of duplicating
 * it, and DOM anchors keep binding. Returns false when the id is unknown or
 * the text is empty/unchanged.
 *
 * Extension-visible only — arena.ai itself is never touched (it exposes no
 * message edit API; help.arena.ai documents session delete only).
 *
 * Note: round ids do not move on edit, so the caller must invalidate the
 * render fast path (panel.lastRenderKey) or refreshUI swallows the re-render
 * and the row shows stale text.
 */
export function editMessageContent(
	messageId: string,
	newContent: string,
): boolean {
	const msg = conversationStore.messages.find((m) => m.id === messageId);
	const trimmed = newContent.trim();
	if (!msg || !trimmed || trimmed === msg.content) return false;
	if (!msg.edited) msg.editedFrom = msg.content;
	msg.content = trimmed;
	msg.edited = true;
	msg.editedAt = Date.now();
	rebuildRounds();
	void conversationStore.saveToStorage();
	return true;
}
