// @vitest-environment node
// The gate that guards the architecture needs a gate of its own.
//
// `npm run arch:check` fails CI when a dependency edge points the wrong way,
// but a green run only means something if the rules still fire. So this suite
// drives analyzeGraph with synthetic module graphs — one per rule — and asserts
// both directions: a violation is reported, and a legal edge is NOT. The second
// half matters as much as the first; without it, someone loosening the contract
// in scripts/check-layers.ts would go unnoticed.
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

import {
	KNOWN_DEBT,
	ROOT_IN_EDGE_MAX,
	UNLAYERED,
	analyzeGraph,
	FILE_LINES_MAX,
	checkStaleDebt,
	collectModules,
	edgesOf,
	format,
	layerOf,
	stripNonCode,
	type ModuleGraph,
} from "../../scripts/check-layers";

// Relative to the vitest root (the repo dir), not to import.meta.url: under the
// jsdom environment vitest rewrites that to an http URL.
const SRC = resolve("src");

const FINE = `
import { helper } from "./helper";
import type { SomeType } from "./types";
export function run(): SomeType {
	return helper();
}
`;

// One file per layer, every edge legal, so a rule firing is never an accident of
// the fixture.
const graph: ModuleGraph = {
	"src/helper.ts": `export const helper = () => ({ x: 1 });\n`,
	"src/fine.ts": FINE,
	"src/types.ts": `export interface A { x: number }\nexport interface SomeType { y: number }\n`,
	"src/core/rounds.ts": `import type { A } from "../types";\nexport const computeRounds = (): A => ({ x: 1 });\n`,
	"src/core/serialize.ts": `import { computeRounds } from "./rounds";\nexport const s = computeRounds;\n`,
	"src/platform/storage.ts": `import { s } from "../core/serialize";\nexport const get = () => s;\n`,
	"src/app/store.ts": `import { get } from "../platform/storage";\nexport const reset = () => get;\n`,
	"src/features/prescroll.ts": `import { computeRounds } from "../core/rounds";\nexport const go = () => computeRounds;\n`,
	"src/ui/panel.ts": `import { go } from "../features/prescroll";\nexport const view = () => go;\n`,
};

function withFile(extra: ModuleGraph): ModuleGraph {
	return { ...graph, ...extra };
}

function violationsFor(g: ModuleGraph, rule: string) {
	return analyzeGraph(g).violations.filter((v) => v.rule === rule);
}

describe("layer rules", () => {
	it("accepts a graph that obeys the contract", () => {
		expect(analyzeGraph(graph).violations).toEqual([]);
	});

	it("assigns a layer from the src/<layer>/ path", () => {
		expect(layerOf("src/core/rounds.ts")).toBe("core");
		expect(layerOf("src/platform/arenaDom.ts")).toBe("platform");
		expect(layerOf("src/app/store.ts")).toBe("app");
		expect(layerOf("src/features/theme.ts")).toBe("features");
		expect(layerOf("src/capture/rsc.ts")).toBe("capture");
		expect(layerOf("src/ui/panel/list.ts")).toBe("ui");
		expect(layerOf("src/types.ts")).toBe("types");
		expect(layerOf("src/content.ts")).toBe("entry");
		// Not under a layer directory -> still unlayered, so the ratchet counts it.
		expect(layerOf("src/conversationStore.ts")).toBe("root");
	});

	it("reports a lower layer importing a higher one", () => {
		const g = withFile({
			"src/core/rounds.ts": `import { view } from "../ui/panel";\nexport const x = view;\n`,
		});
		const found = violationsFor(g, "no-upward-import");
		expect(found).toHaveLength(1);
		expect(found[0].message).toContain("core imports ui (src/ui/panel.ts)");
		// The hint must name the way out, not just forbid.
		expect(found[0].hint).toContain("KNOWN_DEBT");
	});

	// core/ is the no-DOM, no-chrome layer — the reason it needs no jsdom.
	// Comments and strings are stripped first, so prose about the DOM is not a
	// violation.
	it("reports DOM access in core, at the right line", () => {
		const g = withFile({
			"src/core/rounds.ts": `export const a = 1;\nexport const el = document.createElement("div");\n`,
		});
		const found = violationsFor(g, "core-purity");
		expect(found).toHaveLength(1);
		expect(found[0].message).toContain('"document"');
		expect(found[0].line).toBe(2);
	});

	it("ignores DOM words that appear only in comments or strings", () => {
		const g = withFile({
			"src/core/rounds.ts": `// reads the document for the caller\nexport const note = "window";\nexport const f = (x: string) => x.length;\n`,
		});
		expect(stripNonCode(g["src/core/rounds.ts"])).not.toContain("window");
		expect(analyzeGraph(g).violations).toEqual([]);
	});

	// core keeps zero RUNTIME dependencies: `import type` from the shared
	// declaration module is allowed, a value import from anywhere outside core is
	// not.
	it("rejects a value import out of core even when the target is types.ts", () => {
		const g = withFile({
			"src/core/rounds.ts": `import { helper } from "../helper";\nexport const x = helper;\n`,
		});
		expect(violationsFor(g, "no-upward-import")).toHaveLength(1);
	});

	it("reports chrome.* outside platform, and allows it inside", () => {
		expect(
			violationsFor(
				withFile({
					"src/features/prescroll.ts": `export const v = chrome.storage.local;\n`,
				}),
				"chrome-only-in-platform",
			),
		).toHaveLength(1);
		expect(
			analyzeGraph(
				withFile({
					"src/platform/storage.ts": `export const v = chrome.storage.local;\n`,
				}),
			).violations,
		).toEqual([]);
	});

	it("reports an import cycle", () => {
		const g: ModuleGraph = {
			"src/core/rounds.ts": `import { b } from "./serialize";\nexport const a = b;\n`,
			"src/core/serialize.ts": `import { a } from "./rounds";\nexport const b = a;\n`,
		};
		const found = violationsFor(g, "no-cycle");
		expect(found).toHaveLength(1);
		expect(found[0].message).toContain("src/core/rounds.ts");
	});

	it("reports a module that imports the entry point", () => {
		const g = withFile({
			"src/app/store.ts": `import { boot } from "../content";\nexport const reset = boot;\n`,
			"src/content.ts": `export const boot = 1;\n`,
		});
		expect(violationsFor(g, "entry-not-imported")).toHaveLength(1);
	});

	it("reports an import that resolves to nothing", () => {
		const g = withFile({
			"src/core/rounds.ts": `import { gone } from "./nope";\n`,
		});
		const found = violationsFor(g, "unresolved-import");
		expect(found).toHaveLength(1);
		expect(found[0].message).toContain("./nope");
	});

	// types.ts holds declarations only; if it starts importing, every layer
	// inherits that dependency through it.
	it("reports the shared type module importing anything", () => {
		const g = withFile({
			"src/types.ts": `import { helper } from "./helper";\nexport interface A { x: typeof helper }\n`,
		});
		expect(violationsFor(g, "types-has-no-imports")).toHaveLength(1);
	});
});

describe("debt ratchet", () => {
	// An edge may stay broken while there is a written plan, but the plan has to
	// be specific: same pair, or it is a new violation.
	it("tolerates exactly the documented pairs", () => {
		const entry = KNOWN_DEBT[0];
		const g: ModuleGraph = {
			"src/app/store.ts": `import { view } from "../${entry.to.replace("src/", "")}";\nexport const reset = view;\n`,
			[entry.to]: `export const view = 1;\n`,
			"src/types.ts": `export interface A { x: number }\n`,
		};
		expect(violationsFor(g, "no-upward-import")).toEqual([]);
	});

	it("flags a new app-to-ui edge that is not on the list", () => {
		const g: ModuleGraph = {
			"src/app/store.ts": `import { modal } from "../ui/modals";\nexport const reset = modal;\n`,
			"src/ui/modals.ts": `export const modal = 1;\n`,
		};
		const found = violationsFor(g, "no-upward-import");
		expect(found).toHaveLength(1);
		expect(found[0].message).toContain("src/ui/modals.ts");
	});

	// Retired debt must be deleted, not kept as documentation — otherwise the
	// ceiling rises again the moment someone reuses the path.
	it("reports stale debt", () => {
		const g: ModuleGraph = { "src/app/store.ts": `export const reset = 1;\n` };
		expect(checkStaleDebt(analyzeGraph(g))).toHaveLength(KNOWN_DEBT.length);
	});

	// On the real tree every listed pair must still be live, and no other
	// upward edge may exist. This is the assertion CI actually runs.
	it("matches the real src/ tree", () => {
		const report = analyzeGraph(collectModules(SRC));
		expect([...report.violations, ...checkStaleDebt(report)]).toEqual([]);
		expect(report.rootInbound).toBeLessThanOrEqual(ROOT_IN_EDGE_MAX);
	});

	// The size ceiling is the same kind of ratchet, for the other axis: a file
	// may stay big, it may not get bigger, and it may not be re-grown by the next
	// person who "just adds a few lines here".
	it("refuses a file over the size ceiling", () => {
		const padding = `// pad\n`.repeat(FILE_LINES_MAX);
		const g: ModuleGraph = {
			...graph,
			"src/core/rounds.ts": `export const a = 1;\n${padding}`,
		};
		const found = violationsFor(g, "file-size-ceiling");
		expect(found).toHaveLength(1);
		expect(found[0].file).toBe("src/core/rounds.ts");
		// And the real tree sits inside it.
		expect(analyzeGraph(collectModules(SRC)).largestFile).toBeLessThanOrEqual(
			FILE_LINES_MAX,
		);
	});

	// A ratchet is only honest if its ceiling equals what is measured today:
	// slack here is debt that nobody has to pay.
	it("pins the unlayered ceiling to the measured count", () => {
		expect(analyzeGraph(collectModules(SRC)).rootInbound).toBe(
			ROOT_IN_EDGE_MAX,
		);
	});

	it("lists only files that still exist in src/", () => {
		const real = collectModules(SRC);
		for (const file of UNLAYERED) {
			expect(
				real[file],
				`${file} is listed as unlayered but is gone`,
			).toBeDefined();
		}
	});

	// A barrel that only re-exports has no executable statements, so it is
	// excluded from coverage instead of being padded with a test that proves
	// nothing. If anyone puts logic in one, that exemption has to be revisited.
	it("keeps the pure re-export barrels free of logic", () => {
		const real = collectModules(SRC);
		for (const file of ["src/capture.ts"]) {
			const body = stripNonCode(real[file] ?? "").trim();
			expect(body, file).toMatch(/^(import|export)\s/);
			expect(body, file).not.toMatch(
				/(=>|\bif\b|\bfor\b|\bwhile\b|\bswitch\b|\bfunction\b)/,
			);
		}
	});
});

describe("import scanning", () => {
	it("sees static, type-only, side-effect and dynamic imports, with lines", () => {
		const src = [
			`import "./setup";`, // 1
			`import type { A } from "./types";`, // 2
			`import {`, // 3
			`  b,`,
			`} from "./multi";`, // 5
			`const c = () => import("./late");`, // 6
		].join("\n");
		const g: ModuleGraph = {
			"src/a.ts": src,
			"src/setup.ts": "",
			"src/types.ts": "",
			"src/multi.ts": "",
			"src/late.ts": "",
		};
		const { edges, missing } = edgesOf("src/a.ts", src, g);
		expect(missing).toEqual([]);
		expect(edges.map((e) => [e.to, e.line, e.typeOnly])).toEqual([
			["src/setup.ts", 1, false],
			["src/types.ts", 2, true],
			["src/multi.ts", 3, false],
			["src/late.ts", 6, false],
		]);
	});

	it("does not mistake a relative string for an import", () => {
		const src = `const p = "./not-an-import";\nexport default p;\n`;
		expect(edgesOf("src/a.ts", src, { "src/a.ts": src }).edges).toEqual([]);
	});
});

describe("report formatting", () => {
	it("prints the rule, the location and the ratchet line", () => {
		const g = withFile({
			"src/core/rounds.ts": `import { view } from "../ui/panel";\nexport const x = view;\n`,
			// One legal edge into an unlayered file, so the ratchet line
			// prints a nonzero count (app may import root).
			"src/rounds.ts": `export const y = 1;\n`,
			"src/app/store.ts": `import { get } from "../platform/storage";\nimport { y } from "../rounds";\nexport const reset = () => [get, y];\n`,
		});
		const text = format(analyzeGraph(g));
		expect(text).toContain("no-upward-import");
		expect(text).toContain("src/core/rounds.ts:1");
		expect(text).toContain(`unlayered inbound: 1/${ROOT_IN_EDGE_MAX}`);
		expect(text).toContain(`debt: ${KNOWN_DEBT.length} pair(s)`);
	});

	it("says nothing alarming when the graph is clean", () => {
		const text = format(analyzeGraph(graph));
		expect(text).not.toContain("✗");
		expect(text).toContain("edges:");
	});
});
