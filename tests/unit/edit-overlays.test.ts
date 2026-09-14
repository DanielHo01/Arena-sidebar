// editOverlays — durable side storage for #15 local message edits.
//
// Snapshots are LRU-evicted; the user's corrections are the one thing in
// them that DOM cannot rebuild. These tests pin down the three halves:
//
//   collect/apply — (fingerprint, occurrence) matching, live edits win;
//   persist       — additive read-merge-write, never wipes stored overlays;
//   load          — shape validation + per-session cache.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { SidebarMessage } from "../../src/types";
import {
	EDIT_OVERLAY_PREFIX,
	MAX_OVERLAYS_PER_SESSION,
	applyOverlays,
	collectLiveOverlays,
	getCachedOverlays,
	loadEditOverlays,
	overlayKey,
	persistLiveOverlays,
	resetOverlayCache,
	type EditOverlay,
} from "../../src/editOverlays";
import { setStorageBackend } from "../../src/platform/storage";
import {
	conversationStore,
	editMessageContent,
	refreshStore,
} from "../../src/conversationStore";
import { fingerprint } from "../../src/core/fingerprint";
import { cachedElements } from "../../src/state";

function msg(
	partial: Partial<SidebarMessage> & { id: string },
): SidebarMessage {
	return { role: "user", content: "text", ...partial };
}

function memBackend() {
	const data = new Map<string, unknown>();
	setStorageBackend({
		get: async (keys: string | string[] | null) => {
			const list =
				keys === null ? [...data.keys()] : Array.isArray(keys) ? keys : [keys];
			return Object.fromEntries(
				list.filter((k) => data.has(k)).map((k) => [k, data.get(k)]),
			);
		},
		set: async (items: Record<string, unknown>) => {
			for (const [k, v] of Object.entries(items)) data.set(k, v);
		},
		remove: async (keys: string | string[]) => {
			for (const k of Array.isArray(keys) ? keys : [keys]) data.delete(k);
		},
	});
	return data;
}

describe("collectLiveOverlays", () => {
	it("collects edited messages keyed by fingerprint + occurrence", () => {
		const out = collectLiveOverlays([
			msg({
				id: "a",
				fingerprint: "fp-1",
				occurrence: 2,
				edited: true,
				content: "fixed",
				editedFrom: "orig",
				editedAt: 7,
			}),
			msg({ id: "b", fingerprint: "fp-2", content: "plain" }),
		]);
		expect(out).toEqual([
			{ fp: "fp-1", occ: 2, content: "fixed", editedFrom: "orig", editedAt: 7 },
		]);
	});

	it("skips edited messages without a fingerprint", () => {
		// Nothing a future DOM re-extract could match — collecting it would
		// only create an overlay that can never apply.
		expect(
			collectLiveOverlays([msg({ id: "a", edited: true, content: "x" })]),
		).toEqual([]);
	});

	it("defaults a missing occurrence to 0", () => {
		const out = collectLiveOverlays([
			msg({ id: "a", fingerprint: "fp-1", edited: true, content: "x" }),
		]);
		expect(out[0].occ).toBe(0);
	});
});

describe("applyOverlays", () => {
	it("pastes corrections onto matching unedited messages", () => {
		const messages = [
			msg({ id: "a", fingerprint: "fp-1", occurrence: 0, content: "orig" }),
		];
		const applied = applyOverlays(messages, [
			{ fp: "fp-1", occ: 0, content: "fixed", editedFrom: "orig", editedAt: 9 },
		]);
		expect(applied).toBe(1);
		expect(messages[0]).toMatchObject({
			content: "fixed",
			edited: true,
			editedFrom: "orig",
			editedAt: 9,
		});
	});

	it("never touches an already-edited message (live wins)", () => {
		const messages = [
			msg({
				id: "a",
				fingerprint: "fp-1",
				occurrence: 0,
				content: "live edit",
				edited: true,
			}),
		];
		const applied = applyOverlays(messages, [
			{ fp: "fp-1", occ: 0, content: "stale", editedAt: 1 },
		]);
		expect(applied).toBe(0);
		expect(messages[0].content).toBe("live edit");
	});

	it("occurrence disambiguates repeated content", () => {
		const messages = [
			msg({ id: "a", fingerprint: "fp-r", occurrence: 0, content: "same" }),
			msg({ id: "b", fingerprint: "fp-r", occurrence: 1, content: "same" }),
		];
		const applied = applyOverlays(messages, [
			{ fp: "fp-r", occ: 1, content: "second fixed", editedAt: 3 },
		]);
		expect(applied).toBe(1);
		expect(messages[0].content).toBe("same");
		expect(messages[1]).toMatchObject({
			content: "second fixed",
			edited: true,
		});
	});

	it("keeps — not prunes — overlays that match nothing", () => {
		const messages = [msg({ id: "a", fingerprint: "fp-1", content: "x" })];
		const overlays: EditOverlay[] = [
			{ fp: "fp-ghost", occ: 0, content: "?", editedAt: 1 },
		];
		expect(applyOverlays(messages, overlays)).toBe(0);
		expect(overlays).toHaveLength(1); // caller keeps it for a later merge
		expect(messages[0].edited).toBeUndefined();
	});

	it("is a no-op for an empty overlay list", () => {
		const messages = [msg({ id: "a", fingerprint: "fp-1", content: "x" })];
		expect(applyOverlays(messages, [])).toBe(0);
	});
});

describe("loadEditOverlays", () => {
	let data: Map<string, unknown>;

	beforeEach(() => {
		data = memBackend();
		resetOverlayCache();
	});

	afterEach(() => {
		setStorageBackend(null);
		resetOverlayCache();
	});

	it("loads, normalizes and caches one session's overlays", async () => {
		data.set(`${EDIT_OVERLAY_PREFIX}s1`, {
			edits: [{ fp: "fp-1", occ: 0, content: "fixed" }],
			updatedAt: 5,
		});
		const out = await loadEditOverlays("s1");
		expect(out).toEqual([
			{
				fp: "fp-1",
				occ: 0,
				content: "fixed",
				editedFrom: undefined,
				editedAt: 0,
			},
		]);
		expect(getCachedOverlays("s1")).toEqual(out);
	});

	it("resolves [] for unknown sessions, corrupt payloads and no session", async () => {
		data.set(`${EDIT_OVERLAY_PREFIX}s9`, { edits: [{ fp: 42 }] });
		await expect(loadEditOverlays("missing")).resolves.toEqual([]);
		await expect(loadEditOverlays("s9")).resolves.toEqual([]);
		await expect(loadEditOverlays("")).resolves.toEqual([]);
	});

	it("the cache is gated on the session id", async () => {
		data.set(`${EDIT_OVERLAY_PREFIX}s1`, {
			edits: [{ fp: "fp-1", occ: 0, content: "x" }],
		});
		await loadEditOverlays("s1");
		expect(getCachedOverlays("other")).toEqual([]);
		expect(getCachedOverlays("")).toEqual([]);
	});
});

describe("persistLiveOverlays", () => {
	let data: Map<string, unknown>;

	beforeEach(() => {
		data = memBackend();
		resetOverlayCache();
	});

	afterEach(() => {
		setStorageBackend(null);
		resetOverlayCache();
	});

	it("writes live edits under the session's side key", async () => {
		const ok = await persistLiveOverlays("s1", [
			msg({
				id: "a",
				fingerprint: "fp-1",
				edited: true,
				content: "fixed",
				editedAt: 4,
			}),
		]);
		expect(ok).toBe(true);
		const stored = data.get(overlayKey("s1")) as {
			edits: EditOverlay[];
			updatedAt: number;
		};
		expect(stored.edits).toHaveLength(1);
		expect(stored.edits[0]).toMatchObject({ fp: "fp-1", content: "fixed" });
		expect(typeof stored.updatedAt).toBe("number");
		expect(getCachedOverlays("s1")).toHaveLength(1);
	});

	it("merges live over stored instead of wiping (cross-tab safe)", async () => {
		data.set(overlayKey("s1"), {
			edits: [
				{ fp: "fp-tab-b", occ: 0, content: "from B", editedAt: 1 },
				{ fp: "fp-1", occ: 0, content: "old", editedAt: 1 },
			],
			updatedAt: 1,
		});
		// This tab only knows its own edit — the other tab's overlay must
		// survive, and this tab's newer correction wins its own slot.
		await persistLiveOverlays("s1", [
			msg({
				id: "a",
				fingerprint: "fp-1",
				edited: true,
				content: "new",
				editedAt: 9,
			}),
		]);
		const stored = data.get(overlayKey("s1")) as { edits: EditOverlay[] };
		expect(stored.edits).toHaveLength(2);
		expect(stored.edits.find((o) => o.fp === "fp-tab-b")?.content).toBe(
			"from B",
		);
		expect(stored.edits.find((o) => o.fp === "fp-1")?.content).toBe("new");
	});

	it("writes nothing when neither live nor stored edits exist", async () => {
		await expect(persistLiveOverlays("s1", [msg({ id: "a" })])).resolves.toBe(
			true,
		);
		expect(data.has(overlayKey("s1"))).toBe(false);
	});

	it("keeps stored overlays when the live store has none", async () => {
		// The live store may be partial (virtual scroll) — an empty live set
		// is never a delete signal.
		data.set(overlayKey("s1"), {
			edits: [{ fp: "fp-1", occ: 0, content: "x", editedAt: 1 }],
		});
		await expect(persistLiveOverlays("s1", [msg({ id: "a" })])).resolves.toBe(
			true,
		);
		expect(
			(data.get(overlayKey("s1")) as { edits: EditOverlay[] }).edits,
		).toHaveLength(1);
	});

	it("caps the mirror at the newest MAX_OVERLAYS_PER_SESSION", async () => {
		const live = Array.from({ length: MAX_OVERLAYS_PER_SESSION + 5 }, (_, i) =>
			msg({
				id: `m${i}`,
				fingerprint: `fp-${i}`,
				edited: true,
				content: `c${i}`,
				editedAt: i,
			}),
		);
		await persistLiveOverlays("s1", live);
		const stored = data.get(overlayKey("s1")) as { edits: EditOverlay[] };
		expect(stored.edits).toHaveLength(MAX_OVERLAYS_PER_SESSION);
		expect(stored.edits.some((o) => o.fp === "fp-0")).toBe(false);
		expect(
			stored.edits.some((o) => o.fp === `fp-${MAX_OVERLAYS_PER_SESSION + 4}`),
		).toBe(true);
	});

	it("serializes rapid persists so no edit is lost", async () => {
		const first = persistLiveOverlays("s1", [
			msg({
				id: "a",
				fingerprint: "fp-1",
				edited: true,
				content: "one",
				editedAt: 1,
			}),
		]);
		const second = persistLiveOverlays("s1", [
			msg({
				id: "a",
				fingerprint: "fp-1",
				edited: true,
				content: "one",
				editedAt: 1,
			}),
			msg({
				id: "b",
				fingerprint: "fp-2",
				edited: true,
				content: "two",
				editedAt: 2,
			}),
		]);
		await expect(first).resolves.toBe(true);
		await expect(second).resolves.toBe(true);
		const stored = data.get(overlayKey("s1")) as { edits: EditOverlay[] };
		expect(stored.edits.map((o) => o.fp).sort()).toEqual(["fp-1", "fp-2"]);
	});

	it("resolves false without a session", async () => {
		await expect(persistLiveOverlays("", [])).resolves.toBe(false);
	});
});

describe("store integration", () => {
	let data: Map<string, unknown>;

	beforeEach(() => {
		data = memBackend();
		resetOverlayCache();
		conversationStore.reset();
		cachedElements.clear();
	});

	afterEach(() => {
		setStorageBackend(null);
		resetOverlayCache();
		conversationStore.sessionId = "";
	});

	it("refreshStore re-attaches cached overlays to DOM re-extracts", async () => {
		// The evicted-session revisit: no snapshot, DOM re-extracts the
		// original text, the cached overlay corrects it back.
		data.set(overlayKey("s1"), {
			edits: [
				{
					fp: fingerprint("hello world"),
					occ: 0,
					content: "hello brave world",
					editedAt: 5,
				},
			],
		});
		conversationStore.sessionId = "s1";
		await loadEditOverlays("s1");
		refreshStore({ dom: [{ id: "m1", role: "user", content: "hello world" }] });

		expect(conversationStore.messages).toHaveLength(1);
		expect(conversationStore.messages[0]).toMatchObject({
			content: "hello brave world",
			edited: true,
		});
	});

	it("overlays cached for another session do not apply", async () => {
		data.set(overlayKey("s1"), {
			edits: [
				{ fp: fingerprint("hello"), occ: 0, content: "hijacked", editedAt: 5 },
			],
		});
		await loadEditOverlays("s1");
		conversationStore.sessionId = "s2";
		refreshStore({ dom: [{ id: "m1", role: "user", content: "hello" }] });

		expect(conversationStore.messages[0].content).toBe("hello");
		expect(conversationStore.messages[0].edited).toBeUndefined();
	});

	it("editMessageContent mirrors the overlay to the side key", async () => {
		conversationStore.sessionId = "s1";
		refreshStore({ dom: [{ id: "m1", role: "user", content: "hello" }] });
		expect(editMessageContent("m1", "hello!")).toBe(true);

		// persistLiveOverlays is fire-and-forget off the (sync) edit call.
		await new Promise((r) => setTimeout(r, 0));
		const stored = data.get(overlayKey("s1")) as { edits: EditOverlay[] };
		expect(stored.edits).toHaveLength(1);
		expect(stored.edits[0]).toMatchObject({
			fp: fingerprint("hello"),
			occ: 0,
			content: "hello!",
			editedFrom: "hello",
		});
	});
});
