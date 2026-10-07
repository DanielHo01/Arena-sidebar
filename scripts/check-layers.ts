// scripts/check-layers.ts — the dependency-direction gate.
//
// Why this exists: the layer contract (core → platform → app/features/capture →
// ui → entry) lived only in prose, and prose does not fail a build. Forensics at
// the time this was written found 3 genuine upward edges (app → ui) and 41 edges
// pointing INTO the unlayered root files. So this gate does not encode a wish —
// it encodes the contract the code already keeps, plus an explicit per-pair debt
// list for the edges it does not. Two properties follow, and they are the whole
// point: a NEW violation anywhere fails CI, and the debt can only shrink
// (retiring a debt entry without deleting its line is also a failure).
//
// Run: npm run arch:check
// The rules themselves are unit-tested (tests/unit/layer-rules.test.ts), so a
// future edit to this file cannot silently turn the gate into a no-op.

import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

export type Layer =
	| "core"
	| "platform"
	| "app"
	| "features"
	| "capture"
	| "ui"
	| "root"
	| "types"
	| "entry";

export interface Violation {
	rule: string;
	file: string;
	line: number;
	message: string;
	hint: string;
}

/** path -> source. Pure input so the rules can be tested without a filesystem. */
export type ModuleGraph = Record<string, string>;

// ─── Layer assignment ─────────────────────────────────────────────────────────

const DIR_LAYERS: Record<string, Layer> = {
	core: "core",
	platform: "platform",
	app: "app",
	features: "features",
	capture: "capture",
	ui: "ui",
};

/**
 * Root files the layering migration has not placed yet, plus the ui/ root
 * barrels. Their inbound-edge count is ratcheted (see ROOT_IN_EDGE_MAX), so
 * this list can only get shorter. `src/types.ts` is deliberately absent: it is
 * a shared declaration module, not migration debt.
 */
export const UNLAYERED = new Set([
	"src/state.ts",
	"src/rounds.ts",
	"src/extract.ts",
	"src/conversationStore.ts",
	"src/capture.ts",
	"src/historyTitles.ts",
	"src/titleResolver.ts",
]);

export function layerOf(file: string): Layer {
	const rel = file.replace(/\\/g, "/");
	const dir = path.posix.dirname(rel); // e.g. "src/core", "src"
	const base = path.posix.basename(rel, ".ts");
	if (dir === "src") {
		if (base === "types") return "types";
		if (base === "content") return "entry";
		return "root";
	}
	// "src/ui/panel" -> "ui"; the layer is always the segment after src/.
	const top = dir.split("/")[1] ?? "";
	return DIR_LAYERS[top] ?? "root";
}

// ─── The contract ─────────────────────────────────────────────────────────────

/**
 * What each layer may import. Read as "downward or sideways"; `types` is
 * importable by everyone because it holds no runtime code, and `root` is
 * importable by everything only while the ratchet above shrinks it.
 */
const ALLOWED: Record<Layer, readonly Layer[]> = {
	types: [],
	core: ["core", "types"],
	platform: ["core", "platform", "types"],
	app: ["core", "platform", "app", "features", "capture", "root", "types"],
	features: ["core", "platform", "features", "capture", "root", "types"],
	capture: ["core", "platform", "capture", "root", "types"],
	ui: ["core", "platform", "ui", "features", "root", "types"],
	root: ["core", "platform", "features", "capture", "root", "types"],
	entry: [
		"core",
		"platform",
		"app",
		"features",
		"capture",
		"ui",
		"root",
		"types",
	],
};

/**
 * Known upward edges, listed per pair. Fix the edge, then DELETE its line here
 * — an entry that no longer matches anything is itself a failure.
 */
export const KNOWN_DEBT: ReadonlyArray<{
	from: string;
	to: string;
	retire: string;
}> = [
	{
		from: "src/app/store.ts",
		to: "src/ui/arenaSidebar.ts",
		retire:
			"state-model track: resetLibrarySection should be self-registered by the ui module, not reached into by app",
	},
	{
		from: "src/app/loop.ts",
		to: "src/ui/arenaSidebar.ts",
		retire:
			"state-model track: the loop should emit intents, ui should subscribe",
	},
	{
		from: "src/app/loop.ts",
		to: "src/ui/contextMenu.ts",
		retire: "state-model track: same as above",
	},
];

/**
 * Largest a single src/ file may get. Track A split the three giants
 * (storage.ts 414 -> reads + storageWrites.ts, conversationStore.ts 379 ->
 * store + conversationSync.ts, extract.ts 365 -> scan + extractCollect.ts)
 * and deleted the two ui barrels, so the worst file today is
 * ui/arenaSidebar.ts at 310 lines. 315 = that plus 5 lines of slack, and the
 * slack is the only gift: split a file, lower the ceiling, never the reverse.
 */
export const FILE_LINES_MAX = 315;

/**
 * Inbound edges into UNLAYERED files. 45 as of Track A1 (state.ts 14,
 * conversationStore.ts 9, rounds.ts 8, extract.ts 4, capture.ts 4,
 * historyTitles.ts 3, titleResolver.ts 3); the two ui barrels were deleted in
 * A1. That is the size of the migration debt the layering plan left behind,
 * and it is a CEILING, not a target: land one module in its layer, drop the
 * number, and the next person cannot quietly add a 46th edge.
 */
export const ROOT_IN_EDGE_MAX = 45;

// Identifiers that must never appear in runtime code under src/core/**: the
// point of core is that it is testable and reasoned about without a browser.
const CORE_FORBIDDEN =
	/\b(document|window|navigator|localStorage|sessionStorage|indexedDB|MutationObserver|IntersectionObserver|ResizeObserver|requestAnimationFrame|querySelector|querySelectorAll|getElementById|addEventListener|removeEventListener|fetch|XMLHttpRequest|WebSocket|chrome)\b/;
// `chrome.*` may only be touched by platform/ — that is what makes the storage
// adapter the single place MV3 context-invalidation is handled.
const CHROME_USE = /\bchrome\s*[.[]/;

// ─── Source scanning ──────────────────────────────────────────────────────────

// Static `import … from "…"` / `export … from "…"` (statement anchored, so a
// multi-line specifier list still resolves), bare side-effect imports, and
// dynamic import() calls.
// The anchor is a lookbehind: consuming the newline would shift every reported
// line down by one, which is exactly the off-by-one that makes a violation
// message useless.
const FROM_RE =
	/(?<=^|[;\n])(?:import|export)\s+(type\s+)?[^;"']*?\bfrom\s*["'](\.{1,2}\/[^"']+)["']/g;
const BARE_RE = /(?<=^|[;\n])import\s*["'](\.{1,2}\/[^"']+)["']/g;
const DYNAMIC_RE = /\bimport\(\s*["'](\.{1,2}\/[^"']+)["']\s*\)/g;

export interface Edge {
	from: string;
	to: string;
	line: number;
	typeOnly: boolean;
}

/** Removes comments and string bodies so identifier scans see code only. */
export function stripNonCode(src: string): string {
	return src
		.replace(/\/\*[\s\S]*?\*\//g, (m) => m.replace(/[^\n]/g, " "))
		.replace(/^\s*\/\/.*$/gm, "")
		.replace(/"(?:\\.|[^"\\\n])*"/g, '""')
		.replace(/'(?:\\.|[^'\\\n])*'/g, "''")
		.replace(/`(?:\\.|[^`\\])*`/g, "``");
}

function resolve(
	from: string,
	spec: string,
	graph: ModuleGraph,
): string | null {
	const base = path.posix.resolve("/", path.posix.dirname(from), spec).slice(1);
	for (const cand of [base, `${base}.ts`, `${base}/index.ts`]) {
		if (cand in graph) return cand;
	}
	// The manifest is imported as JSON by the build config, not a module edge.
	return null;
}

export function edgesOf(
	file: string,
	src: string,
	graph: ModuleGraph,
): { edges: Edge[]; missing: { spec: string; line: number }[] } {
	const edges: Edge[] = [];
	const missing: { spec: string; line: number }[] = [];
	const lineAt = (index: number) => src.slice(0, index).split("\n").length;
	const push = (spec: string, index: number, typeOnly: boolean) => {
		const to = resolve(file, spec, graph);
		if (to === null) {
			if (!spec.endsWith(".json")) missing.push({ spec, line: lineAt(index) });
			return;
		}
		edges.push({ from: file, to, line: lineAt(index), typeOnly });
	};
	for (const m of src.matchAll(FROM_RE))
		push(m[2], m.index, m[1] !== undefined);
	for (const m of src.matchAll(BARE_RE)) push(m[1], m.index, false);
	for (const m of src.matchAll(DYNAMIC_RE)) push(m[1], m.index, false);
	// Deterministic order, whatever the pattern order above happens to produce.
	const byLine = (a: { line: number }, b: { line: number }) => a.line - b.line;
	edges.sort(byLine);
	missing.sort(byLine);
	return { edges, missing };
}

// ─── Rules ────────────────────────────────────────────────────────────────────

export interface Analysis {
	violations: Violation[];
	rootInbound: number;
	edgeCount: number;
	perFileRoot: Map<string, number>;
	/** Longest file in the graph, so the ceiling can be shown next to it. */
	largestFile: number;
	/** KNOWN_DEBT pairs that this graph still contains. */
	liveDebt: string[];
}

export function analyzeGraph(graph: ModuleGraph): Analysis {
	const violations: Violation[] = [];
	const files = Object.keys(graph).sort();
	const allEdges: Edge[] = [];
	const seen = new Set<string>();

	for (const file of files) {
		const { edges, missing } = edgesOf(file, graph[file], graph);
		for (const spec of missing) {
			violations.push({
				rule: "unresolved-import",
				file,
				line: spec.line,
				message: `imports "${spec.spec}", which resolves to no .ts module`,
				hint: "renamed or deleted file — the import graph must stay resolvable",
			});
		}
		for (const e of edges) {
			const key = `${e.from}\u0000${e.to}\u0000${e.line}`;
			if (seen.has(key)) continue;
			seen.add(key);
			allEdges.push(e);
		}
	}

	const debtPairs = new Set(KNOWN_DEBT.map((d) => `${d.from}\u0000${d.to}`));
	const liveDebt = new Set<string>();

	for (const e of allEdges) {
		const fromL = layerOf(e.from);
		const toL = layerOf(e.to);
		const pair = `${e.from}\u0000${e.to}`;

		// 1. direction
		if (!ALLOWED[fromL].includes(toL)) {
			if (debtPairs.has(pair)) {
				liveDebt.add(pair);
			} else {
				violations.push({
					rule: "no-upward-import",
					file: e.from,
					line: e.line,
					message: `${fromL} imports ${toL} (${e.to})`,
					hint: `a ${fromL} module may import: ${ALLOWED[fromL].join(", ")}. Move the logic down, invert it with a subscription, or — only if this is deliberate and you have a plan to retire it — add it to KNOWN_DEBT in scripts/check-layers.ts`,
				});
			}
		}

		// 2. nothing wires back into the entry point
		if (toL === "entry") {
			violations.push({
				rule: "entry-not-imported",
				file: e.from,
				line: e.line,
				message: `imports the entry point (${e.to})`,
				hint: "content.ts is the assembly root; extract the shared piece instead",
			});
		}

		// 3. core may depend on types.ts only as a type import
		if (fromL === "core" && toL === "types" && !e.typeOnly) {
			violations.push({
				rule: "core-purity",
				file: e.from,
				line: e.line,
				message: `core takes a value import from ${e.to}`,
				hint: "use `import type` so core keeps zero runtime dependencies",
			});
		}

		// 4. types.ts holds declarations only — no imports, ever
		if (fromL === "types" && toL !== "types") {
			violations.push({
				rule: "types-has-no-imports",
				file: e.from,
				line: e.line,
				message: `the shared type module imports ${e.to}`,
				hint: "declare the type where it belongs instead; types.ts must stay dependency-free",
			});
		}
	}

	// 6. core purity by identifier
	for (const file of files) {
		if (layerOf(file) !== "core") continue;
		const lines = stripNonCode(graph[file]).split("\n");
		for (let i = 0; i < lines.length; i++) {
			const hit = lines[i].match(CORE_FORBIDDEN);
			if (hit) {
				violations.push({
					rule: "core-purity",
					file,
					line: i + 1,
					message: `core references "${hit[1]}" (comments and strings are stripped, so this is live code)`,
					hint: "core is the no-DOM, no-chrome layer — the caller should pass the value in",
				});
			}
		}
	}

	// 7. chrome.* confined to platform/
	for (const file of files) {
		if (layerOf(file) === "platform") continue;
		const code = stripNonCode(graph[file]);
		if (CHROME_USE.test(code)) {
			violations.push({
				rule: "chrome-only-in-platform",
				file,
				line: code.split("\n").findIndex((l) => CHROME_USE.test(l)) + 1,
				message: "touches chrome.* outside src/platform",
				hint: "platform/storage.ts owns MV3 context-invalidation handling; go through it",
			});
		}
	}

	// 8. dependency cycles
	violations.push(...findCycles(allEdges, files));

	// 9. unlayered-inbound ratchet
	const perFileRoot = new Map<string, number>();
	let rootInbound = 0;
	for (const e of allEdges) {
		if (!UNLAYERED.has(e.to)) continue;
		rootInbound += 1;
		perFileRoot.set(e.to, (perFileRoot.get(e.to) ?? 0) + 1);
	}
	if (rootInbound > ROOT_IN_EDGE_MAX) {
		violations.push({
			rule: "unlayered-coupling-ratchet",
			file: "src",
			line: 0,
			message: `${rootInbound} imports point into unlayered root files; the ceiling is ${ROOT_IN_EDGE_MAX}`,
			hint: "these edges are migration debt and the ceiling only ever comes down — move the module into its layer, or lower ROOT_IN_EDGE_MAX if you just did",
		});
	}

	// 10. file-size ceiling, per file, checked on the way past the door
	for (const file of files) {
		const lines = graph[file].split("\n").length;
		if (lines > FILE_LINES_MAX) {
			violations.push({
				rule: "file-size-ceiling",
				file,
				line: FILE_LINES_MAX + 1,
				message: `${lines} lines exceeds the ${FILE_LINES_MAX}-line ceiling`,
				hint: "split it along a section boundary, or lower FILE_LINES_MAX if you just did",
			});
		}
	}

	return {
		violations,
		rootInbound,
		largestFile: files.reduce(
			(best, f) => Math.max(best, graph[f].split("\n").length),
			0,
		),
		edgeCount: allEdges.length,
		perFileRoot,
		liveDebt: [...liveDebt],
	};
}

/**
 * Are the KNOWN_DEBT entries still true of this graph? An edge that has been
 * retired must have its line deleted, so the ceiling cannot silently rise again.
 * This is a property of the repository, not of an arbitrary graph, so it is a
 * separate check from analyzeGraph -- which stays usable on fixtures.
 */
export function checkStaleDebt(report: Analysis): Violation[] {
	const live = new Set(report.liveDebt);
	return KNOWN_DEBT.filter((d) => !live.has(`${d.from}\u0000${d.to}`)).map(
		(d) => ({
			rule: "stale-debt",
			file: "scripts/check-layers.ts",
			line: 0,
			message: `KNOWN_DEBT entry ${d.from} → ${d.to} no longer matches any import`,
			hint: `that edge is gone — delete the entry (${d.retire})`,
		}),
	);
}

function findCycles(edges: Edge[], files: string[]): Violation[] {
	const adj = new Map<string, string[]>();
	for (const e of edges) {
		const list = adj.get(e.from) ?? [];
		list.push(e.to);
		adj.set(e.from, list);
	}
	const out: Violation[] = [];
	const state = new Map<string, "visiting" | "done">();
	const stack: string[] = [];

	const walk = (node: string): void => {
		state.set(node, "visiting");
		stack.push(node);
		for (const next of adj.get(node) ?? []) {
			if (state.get(next) === "visiting") {
				const cycle = [...stack.slice(stack.indexOf(next)), next];
				out.push({
					rule: "no-cycle",
					file: cycle[0],
					line: 1,
					message: `import cycle: ${cycle.join(" → ")}`,
					hint: "the layer contract assumes a DAG; break it by extracting the shared piece",
				});
			} else if (!state.has(next)) {
				walk(next);
			}
		}
		stack.pop();
		state.set(node, "done");
	};

	for (const f of files) if (!state.has(f)) walk(f);
	// One report per cycle member set is enough.
	return out.filter(
		(v, i, arr) => arr.findIndex((o) => o.message === v.message) === i,
	);
}

// ─── Filesystem + CLI ─────────────────────────────────────────────────────────

export function collectModules(srcDir: string): ModuleGraph {
	const graph: ModuleGraph = {};
	const walkDir = (dir: string): void => {
		for (const entry of readdirSync(dir)) {
			const full = path.join(dir, entry);
			if (statSync(full).isDirectory()) walkDir(full);
			else if (entry.endsWith(".ts"))
				graph[path.relative(path.dirname(srcDir), full).replace(/\\/g, "/")] =
					readFileSync(full, "utf8");
		}
	};
	if (existsSync(srcDir)) walkDir(srcDir);
	return graph;
}

const SEVERITY_ORDER = [
	"core-purity",
	"chrome-only-in-platform",
	"no-upward-import",
	"no-cycle",
	"entry-not-imported",
	"types-has-no-imports",
	"unresolved-import",
	"stale-debt",
	"file-size-ceiling",
	"unlayered-coupling-ratchet",
];

export function format(report: Analysis): string {
	const lines: string[] = [];
	const sorted = [...report.violations].sort(
		(a, b) =>
			SEVERITY_ORDER.indexOf(a.rule) - SEVERITY_ORDER.indexOf(b.rule) ||
			a.file.localeCompare(b.file) ||
			a.line - b.line,
	);
	for (const v of sorted) {
		lines.push(`  ✗ ${v.rule}  ${v.file}:${v.line}`);
		lines.push(`      ${v.message}`);
		lines.push(`      → ${v.hint}`);
	}
	lines.push("");
	lines.push(
		`edges: ${report.edgeCount}  ·  unlayered inbound: ${report.rootInbound}/${ROOT_IN_EDGE_MAX}  ·  largest file: ${report.largestFile}/${FILE_LINES_MAX}  ·  debt: ${KNOWN_DEBT.length} pair(s)`,
	);
	if (report.rootInbound > 0) {
		const detail = [...report.perFileRoot.entries()]
			.sort((a, b) => b[1] - a[1])
			.map(([f, n]) => `${f} ${n}`)
			.join(", ");
		lines.push(`  ${detail}`);
	}
	return lines.join("\n");
}

const isCliEntry =
	process.argv[1] !== undefined &&
	import.meta.url === pathToFileURL(process.argv[1]).href;

if (isCliEntry) {
	const report = analyzeGraph(collectModules(path.resolve("src")));
	report.violations.push(...checkStaleDebt(report));
	if (report.violations.length === 0) {
		console.log(`\n  ✓ layer contract holds — no violations\n`);
		console.log(format(report));
		console.log("");
		process.exit(0);
	}
	console.error(`\n  ${report.violations.length} architecture violation(s):\n`);
	console.error(format(report));
	console.error("");
	process.exit(1);
}
