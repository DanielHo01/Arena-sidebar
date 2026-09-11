// Replay tests/__fixtures__/probes/*.json through production functions.
//
// A live arena.ai paste becomes a JSON file; this suite is the regression
// gate so we do not sideload to notice that Battle detection or extract
// broke. The pasteable probe is generated from arenaContract.ts — the
// second test fails if someone edits selectors without regenerating it.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	BATTLE_MODE_LABEL,
	BATTLE_VOTE_PATTERNS,
} from "../../src/platform/arenaContract";
import {
	detectBattleMode,
	inspectArenaQuickNav,
	queryScrollContainer,
	resetQuickNavReport,
} from "../../src/platform/arenaDom";
import {
	extractMessages,
	getLastExtractStats,
	resetExtractState,
} from "../../src/extract";
import { cachedElements } from "../../src/state";
import { mountProbeSnapshot, rectForProbeEl } from "../__fixtures__/mountProbe";
import type { ArenaProbeSnapshot } from "../__fixtures__/probeSnapshot";

const PROBES_DIR = path.resolve("tests/__fixtures__/probes");

function loadSnapshots(): ArenaProbeSnapshot[] {
	return readdirSync(PROBES_DIR)
		.filter((f) => f.endsWith(".json"))
		.map((f) => {
			const raw = JSON.parse(
				readFileSync(path.join(PROBES_DIR, f), "utf8"),
			) as ArenaProbeSnapshot;
			if (raw.schema !== 1) {
				throw new Error(`${f}: unsupported snapshot schema ${raw.schema}`);
			}
			return raw;
		});
}

const snapshots = loadSnapshots();

beforeEach(() => {
	resetExtractState();
	resetQuickNavReport();
	cachedElements.clear();
	document.body.innerHTML = "";
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockImplementation(
		function (this: Element) {
			return rectForProbeEl(this);
		},
	);
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("live DOM contract snapshots", () => {
	it("loads at least the 2026-09 Battle and Direct pages", () => {
		const ids = snapshots.map((s) => s.id);
		expect(ids).toContain("search-arena-battle-2026-09-09");
		expect(ids).toContain("direct-chat-wide-2026-09-09");
		expect(ids).toContain("open-dropdown-not-battle");
	});

	it.each(snapshots.map((s) => [s.id, s] as const))(
		"%s matches production detectors",
		(_id, snap) => {
			mountProbeSnapshot(snap);

			expect(detectBattleMode()).toBe(snap.expect.battle);

			if (snap.expect.sidebar !== "skip") {
				const probe = inspectArenaQuickNav();
				if (snap.expect.sidebar === "ok") {
					expect(probe.ok).toBe(true);
				} else {
					expect(probe).toEqual({
						ok: false,
						failedAt: snap.expect.sidebar,
					});
				}
			}

			expect(Boolean(queryScrollContainer())).toBe(snap.expect.scrollFound);

			if (
				snap.expect.extractKeptMin !== undefined ||
				snap.expect.extractUserHitsMin !== undefined ||
				snap.expect.extractAsstHitsMin !== undefined
			) {
				extractMessages();
				const stats = getLastExtractStats();
				if (snap.expect.extractKeptMin !== undefined) {
					expect(stats.kept).toBeGreaterThanOrEqual(snap.expect.extractKeptMin);
				}
				if (snap.expect.extractUserHitsMin !== undefined) {
					expect(stats.userHits).toBeGreaterThanOrEqual(
						snap.expect.extractUserHitsMin,
					);
				}
				if (snap.expect.extractAsstHitsMin !== undefined) {
					expect(stats.asstHits).toBeGreaterThanOrEqual(
						snap.expect.extractAsstHitsMin,
					);
				}
			}
		},
	);
});

describe("console probe stays generated from the contract", () => {
	const probe = readFileSync(path.resolve("scripts/arena-probe.js"), "utf8");

	it("is marked generated and inlines the live-contract tokens", () => {
		// Full-string toContain breaks on JSON escaping / prettier quote
		// style. Unique substrings plus `npm run probe:check` (byte-equal
		// to gen-probe) are the lock.
		expect(probe).toContain("GENERATED");
		expect(probe).toContain("npm run gen:probe");
		expect(probe).toContain("bg-surface-raised");
		expect(probe).toContain("bg-surface-primary");
		expect(probe).toContain("data-radix-scroll-area-viewport");
		expect(probe).toContain("overscroll-none");
		expect(probe).toContain("sidebar-wrapper");
		expect(probe).toContain("都好(?!不)");
		expect(probe).toContain(BATTLE_MODE_LABEL.source);
		expect(probe).toContain(String(BATTLE_VOTE_PATTERNS.length));
	});
});
