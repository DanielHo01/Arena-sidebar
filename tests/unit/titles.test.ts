// Real-source test: session title resolution (the "title three-source" fix).
// Imports the actual production logic from src/titleResolver.ts.
// Migrated verbatim from scripts/test-src-title-resolution.ts (6 assertions).
import { describe, it, expect } from "vitest";
import { resolveSessionTitle } from "../../src/titleResolver";

describe("resolveSessionTitle", () => {
	it("customTitle wins over title", () => {
		expect(
			resolveSessionTitle({
				customTitle: "My Custom",
				title: "Original",
				sessionId: "abc123",
			}),
		).toBe("My Custom");
	});

	it("falls back to title when customTitle empty", () => {
		expect(
			resolveSessionTitle({
				customTitle: "",
				title: "Original",
				sessionId: "abc123",
			}),
		).toBe("Original");
	});

	it("falls back to sessionId prefix when both empty", () => {
		expect(
			resolveSessionTitle({
				customTitle: "",
				title: "",
				sessionId: "abc12345-long-id",
			}),
		).toBe("abc12345");
	});

	it("whitespace-only customTitle is treated as unset", () => {
		expect(
			resolveSessionTitle({
				customTitle: "   ",
				title: "Fallback",
				sessionId: "x",
			}),
		).toBe("Fallback");
	});

	it("customTitle is trimmed before returning", () => {
		expect(
			resolveSessionTitle({
				customTitle: "  trimmed  ",
				title: "X",
				sessionId: "y",
			}),
		).toBe("trimmed");
	});

	it("whitespace-only title falls through to sessionId", () => {
		expect(
			resolveSessionTitle({
				customTitle: undefined,
				title: "  ",
				sessionId: "abcdefghij",
			}),
		).toBe("abcdefgh");
	});
});
