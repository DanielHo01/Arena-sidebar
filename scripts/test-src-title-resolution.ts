// Real source-based test for title resolution (problem 2: title three-source
// unification). Imports the ACTUAL production logic from src/titleResolver.ts.
import assert from "node:assert/strict";
import { resolveSessionTitle } from "../src/titleResolver";

const failures: string[] = [];
function run(label: string, fn: () => void) {
	try {
		fn();
		console.log("  ok - " + label);
	} catch (e) {
		failures.push(label + ": " + (e as Error).message);
		console.error("  FAIL - " + label + " :: " + (e as Error).message);
	}
}

console.log("test-src-title-resolution: resolveSessionTitle (real source import)");

run("customTitle wins over title", () => {
	assert.equal(
		resolveSessionTitle({
			customTitle: "My Custom",
			title: "Original",
			sessionId: "abc123",
		}),
		"My Custom",
	);
});

run("falls back to title when customTitle empty", () => {
	assert.equal(
		resolveSessionTitle({
			customTitle: "",
			title: "Original",
			sessionId: "abc123",
		}),
		"Original",
	);
});

run("falls back to sessionId prefix when both empty", () => {
	assert.equal(
		resolveSessionTitle({
			customTitle: "",
			title: "",
			sessionId: "abc12345-long-id",
		}),
		"abc12345",
	);
});

run("whitespace-only customTitle is treated as unset", () => {
	assert.equal(
		resolveSessionTitle({
			customTitle: "   ",
			title: "Fallback",
			sessionId: "x",
		}),
		"Fallback",
	);
});

run("customTitle is trimmed before returning", () => {
	assert.equal(
		resolveSessionTitle({
			customTitle: "  trimmed  ",
			title: "X",
			sessionId: "y",
		}),
		"trimmed",
	);
});

run("whitespace-only title falls through to sessionId", () => {
	assert.equal(
		resolveSessionTitle({
			customTitle: undefined,
			title: "  ",
			sessionId: "abcdefghij",
		}),
		"abcdefgh",
	);
});

if (failures.length > 0) {
	console.error(`test-src-title-resolution: FAILED ${failures.length}:`);
	failures.forEach((f) => console.error("  - " + f));
	process.exit(1);
}
console.log("test-src-title-resolution: PASS (" + 6 + " assertions)");
