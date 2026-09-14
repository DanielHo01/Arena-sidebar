// editOverlays — durable storage for #15 local message edits.
//
// Session snapshots (edge-ai-sidebar:session:*) are LRU-evicted and hold full
// message content, including the user's in-extension corrections. Eviction
// would silently discard the one thing that is NOT re-derivable from DOM, so
// overlays mirror just the edited messages into a tiny side key
// (edge-ai-sidebar:edits:{sid}) that snapshot eviction never touches.
//
// Lifecycle:
//   editMessageContent → persistLiveOverlays (read-merge-write, additive only)
//   rebuild with snapshot MISS → loadEditOverlays (cached per session id)
//   every refreshStore merge → applyOverlays from cache (idempotent)
//   scheduled trim → edits keys LRU-capped at MAX_EDIT_KEYS by updatedAt
//
// The match key is (fingerprint, occurrence): upsertMessage numbers DOM
// re-extracts identically, so the same DOM re-attaches the same overlays. An
// overlay that matches nothing is KEPT, not pruned — "no match yet" is
// indistinguishable from "virtual scroll hasn't loaded that message yet",
// and the data is tiny.
//
// Cross-tab: persist merges live edits over stored ones, so two tabs editing
// different messages both survive (same message: last writer wins). Live
// propagation to already-open tabs is out of scope — a tab picks up overlays
// on snapshot-miss rebuilds, same as snapshots themselves.

import type { SidebarMessage } from "./types";
import { storageGet, storageSet } from "./platform/storage";

/** Key prefix for per-session edit-overlay mirrors. Never evicted as snapshots. */
export const EDIT_OVERLAY_PREFIX = "edge-ai-sidebar:edits:";

/** Cap: newest N sessions keep their overlay mirrors. */
export const MAX_EDIT_KEYS = 200;

/** Cap: newest N overlays per session (by editedAt). Hand edits only. */
export const MAX_OVERLAYS_PER_SESSION = 100;

export interface EditOverlay {
	/** DOM-original fingerprint (keys the unedited content). */
	fp: string;
	occ: number;
	/** User-corrected content. */
	content: string;
	editedFrom?: string | undefined;
	editedAt: number;
}

export function overlayKey(sessionId: string): string {
	return `${EDIT_OVERLAY_PREFIX}${sessionId}`;
}

// ─── In-memory cache ──────────────────────────────────────────────────────────────
//
// refreshStore is synchronous but storage is not, so the session's overlays
// are loaded once (on snapshot-miss rebuilds) and applied from cache on
// every merge. Applying is O(overlays × messages) string compares — the
// overlay list is hand-sized, effectively free.

let cacheSid = "";
let cache: EditOverlay[] = [];

export function getCachedOverlays(sessionId: string): EditOverlay[] {
	return sessionId && sessionId === cacheSid ? cache : [];
}

/** Test seam (+ future session-teardown hook). */
export function resetOverlayCache(): void {
	cacheSid = "";
	cache = [];
}

// ─── Collect / apply ──────────────────────────────────────────────────────────────

/**
 * Overlays for every edited live message. Messages without a fingerprint are
 * skipped: without one there is nothing a future DOM re-extract could match
 * (in practice upsertMessage always sets it — this guards hand-built rows).
 */
export function collectLiveOverlays(messages: SidebarMessage[]): EditOverlay[] {
	const out: EditOverlay[] = [];
	for (const m of messages) {
		if (!m.edited || !m.fingerprint) continue;
		out.push({
			fp: m.fingerprint,
			occ: m.occurrence ?? 0,
			content: m.content,
			editedFrom: m.editedFrom,
			editedAt: m.editedAt ?? 0,
		});
	}
	return out;
}

/**
 * Paste cached overlays onto matching live messages. Live edits always win:
 * an already-edited message is never touched, so re-applying is idempotent.
 * Returns the number of messages changed (callers rebuild rounds on >0 —
 * refreshStore already rebuilds on every merge that reaches it).
 */
export function applyOverlays(
	messages: SidebarMessage[],
	overlays: EditOverlay[],
): number {
	if (overlays.length === 0) return 0;
	let applied = 0;
	for (const o of overlays) {
		const msg = messages.find(
			(m) =>
				!m.edited && m.fingerprint === o.fp && (m.occurrence ?? 0) === o.occ,
		);
		if (!msg) continue;
		msg.content = o.content;
		msg.edited = true;
		if (o.editedFrom !== undefined) msg.editedFrom = o.editedFrom;
		msg.editedAt = o.editedAt;
		applied++;
	}
	return applied;
}

// ─── Persist / load ───────────────────────────────────────────────────────────────

function isOverlayArray(value: unknown): value is EditOverlay[] {
	return (
		Array.isArray(value) &&
		value.every(
			(o) =>
				typeof (o as EditOverlay)?.fp === "string" &&
				typeof (o as EditOverlay)?.occ === "number" &&
				typeof (o as EditOverlay)?.content === "string",
		)
	);
}

function normalizeOverlays(value: unknown): EditOverlay[] {
	if (!isOverlayArray(value)) return [];
	return value.map((o) => ({
		fp: o.fp,
		occ: o.occ,
		content: o.content,
		editedFrom: typeof o.editedFrom === "string" ? o.editedFrom : undefined,
		editedAt: typeof o.editedAt === "number" ? o.editedAt : 0,
	}));
}

function overlayId(o: EditOverlay): string {
	return `${o.fp}#${o.occ}`;
}

/**
 * Load one session's overlays into cache. Resolves [] for unknown sessions,
 * corrupt payloads, or storage failures — all mean "nothing to apply".
 * Never rejects.
 */
export async function loadEditOverlays(
	sessionId: string,
): Promise<EditOverlay[]> {
	if (!sessionId) return [];
	const raw = (await storageGet(overlayKey(sessionId))) as {
		edits?: unknown;
	} | null;
	const overlays = normalizeOverlays(raw?.edits);
	cacheSid = sessionId;
	cache = overlays;
	return overlays;
}

// Persists serialize through this chain: two rapid edits fire-and-forget two
// read-modify-writes, and without ordering the second write could land first
// and lose the newer edit.
let persistChain: Promise<void> = Promise.resolve();

/**
 * Mirror the store's live edits into the session's side key. Additive:
 * stored overlays the live store no longer holds are kept (the live store
 * may be partial — virtual scroll — or owned by another tab). Resolves false
 * when there is nothing to do or the write failed. Never rejects.
 */
export function persistLiveOverlays(
	sessionId: string,
	messages: SidebarMessage[],
): Promise<boolean> {
	if (!sessionId) return Promise.resolve(false);
	const run = persistChain.then(async (): Promise<boolean> => {
		const live = collectLiveOverlays(messages);
		const raw = (await storageGet(overlayKey(sessionId))) as {
			edits?: unknown;
		} | null;
		const stored = normalizeOverlays(raw?.edits);
		if (live.length === 0 && stored.length === 0) return true;
		const merged = new Map<string, EditOverlay>();
		for (const o of stored) merged.set(overlayId(o), o);
		for (const o of live) merged.set(overlayId(o), o); // live wins
		let edits = [...merged.values()];
		if (edits.length > MAX_OVERLAYS_PER_SESSION) {
			edits = edits
				.sort((a, b) => b.editedAt - a.editedAt)
				.slice(0, MAX_OVERLAYS_PER_SESSION);
		}
		const ok = await storageSet(overlayKey(sessionId), {
			edits,
			updatedAt: Date.now(),
		});
		if (ok) {
			cacheSid = sessionId;
			cache = edits;
		}
		return ok;
	});
	// The chain itself never rejects (storageSet doesn't); the caller still
	// gets the real outcome.
	persistChain = run.then(
		() => undefined,
		() => undefined,
	);
	return run;
}
