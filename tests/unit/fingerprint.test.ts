// core/fingerprint.ts — the pure content-keying primitives.
//
// These decide whether two messages are "the same message". Getting them wrong
// loses turns (Phase 1 bug 3: three "继续" collapsed into one), so the contract
// is pinned here rather than inferred from store behaviour.
import { describe, expect, it } from "vitest";
import {
	baseKey,
	fingerprint,
	withOccurrences,
} from "../../src/core/fingerprint";
import type { SidebarMessage } from "../../src/types";

function msg(over: Partial<SidebarMessage> = {}): SidebarMessage {
	return {
		id: "m" + Math.random().toString(36).slice(2),
		role: "user",
		content: "hello",
		fingerprint: "",
		domId: "",
		origin: "dom",
		...over,
	} as SidebarMessage;
}

describe("fingerprint", () => {
	it("is stable for identical text", () => {
		expect(fingerprint("hello world")).toBe(fingerprint("hello world"));
	});

	it("ignores leading/trailing and repeated whitespace", () => {
		expect(fingerprint("  hello   world  ")).toBe(fingerprint("hello world"));
	});

	it("is case-insensitive", () => {
		expect(fingerprint("Hello WORLD")).toBe(fingerprint("hello world"));
	});

	it("differs for different text", () => {
		expect(fingerprint("hello")).not.toBe(fingerprint("world"));
	});

	it("caps its input so huge messages do not produce huge keys", () => {
		const fp = fingerprint("x".repeat(5000));
		expect(fp.length).toBeLessThan(120);
	});

	it("two long messages sharing a prefix still collide by design (documented)", () => {
		// The key is length + first 80 normalized chars. This is the known
		// precision limit; Phase 1 kept it rather than widening the key.
		const a = "z".repeat(300) + "AAA";
		const b = "z".repeat(300) + "BBB";
		expect(fingerprint(a)).toBe(fingerprint(b));
	});
});

describe("baseKey", () => {
	it("uses the stored fingerprint when present", () => {
		expect(baseKey(msg({ content: "ignored", fingerprint: "fp-stored" }))).toBe(
			"fp-stored",
		);
	});

	it("computes from content when no fingerprint is stored", () => {
		expect(baseKey(msg({ content: "compute me" }))).toBe(
			fingerprint("compute me"),
		);
	});
});

describe("withOccurrences", () => {
	it("numbers repeats in order of first appearance", () => {
		const out = withOccurrences([
			msg({ content: "继续" }),
			msg({ content: "other" }),
			msg({ content: "继续" }),
			msg({ content: "继续" }),
		]);
		expect(out.map((m) => m.occurrence)).toEqual([0, 0, 1, 2]);
	});

	it("writes the base fingerprint onto every message", () => {
		const out = withOccurrences([msg({ content: "abc" })]);
		expect(out[0].fingerprint).toBe(fingerprint("abc"));
	});

	it("is idempotent: re-annotating unchanged input gives the same numbers", () => {
		const input = [
			msg({ content: "a" }),
			msg({ content: "a" }),
			msg({ content: "b" }),
		];
		const first = withOccurrences(input);
		const second = withOccurrences(first);
		expect(second.map((m) => m.occurrence)).toEqual(
			first.map((m) => m.occurrence),
		);
	});

	it("does not mutate the input array's elements", () => {
		const input = [msg({ content: "a" })];
		const before = input[0].fingerprint;
		withOccurrences(input);
		expect(input[0].fingerprint).toBe(before);
	});

	it("returns an empty array for empty input", () => {
		expect(withOccurrences([])).toEqual([]);
	});

	it("keys on normalized content, so whitespace variants share a counter", () => {
		const out = withOccurrences([
			msg({ content: "hi there" }),
			msg({ content: "  HI   THERE " }),
		]);
		expect(out.map((m) => m.occurrence)).toEqual([0, 1]);
	});
});
