// Phase 1 bug fix: /c/ route parsing was duplicated across 4 files in 3
// different regex variants. Two of them used /\/c\/([^/?]+)/ (no `#` in the
// exclusion class), so a history link href of "/c/abc#section" resolved to
// sessionId "abc#section" instead of "abc".
//
// These tests pin the unified behaviour in src/platform/route.ts.
import { describe, it, expect } from "vitest";
import {
	getSessionId,
	isSessionRoute,
	routeKey,
	sessionIdFromHref,
} from "../../src/platform/route";

describe("getSessionId (from location.pathname)", () => {
	it("extracts the id from a session path", () => {
		expect(getSessionId("/c/abc123")).toBe("abc123");
	});

	it("stops at a query string", () => {
		expect(getSessionId("/c/abc123?x=1")).toBe("abc123");
	});

	it("returns empty for a non-session path", () => {
		expect(getSessionId("/")).toBe("");
		expect(getSessionId("/settings")).toBe("");
	});

	it("returns empty for the bare /c/ prefix with no id", () => {
		expect(getSessionId("/c/")).toBe("");
	});
});

describe("sessionIdFromHref (from an <a href> value)", () => {
	it("extracts the id from a relative href", () => {
		expect(sessionIdFromHref("/c/abc123")).toBe("abc123");
	});

	it("extracts the id from an absolute href", () => {
		expect(sessionIdFromHref("https://arena.ai/c/abc123")).toBe("abc123");
	});

	// ── The regression this module exists to fix ─────────────────────────
	it("stops at a fragment — the bug in the old [^/?] variant", () => {
		// historyTitles.ts used /\/c\/([^/?]+)/, which returned "abc123#section".
		expect(sessionIdFromHref("/c/abc123#section")).toBe("abc123");
	});

	it("stops at a query string in an href", () => {
		expect(sessionIdFromHref("/c/abc123?mode=direct")).toBe("abc123");
	});

	it("handles a fragment and a query together", () => {
		expect(sessionIdFromHref("/c/abc123?x=1#top")).toBe("abc123");
	});

	it("returns empty when there is no /c/ segment", () => {
		expect(sessionIdFromHref("/settings")).toBe("");
		expect(sessionIdFromHref("")).toBe("");
	});
});

describe("isSessionRoute", () => {
	it("is true for /c/ paths", () => {
		expect(isSessionRoute("/c/abc123")).toBe(true);
		expect(isSessionRoute("/c/")).toBe(true);
	});

	it("is false for everything else", () => {
		expect(isSessionRoute("/")).toBe(false);
		expect(isSessionRoute("/settings")).toBe(false);
		// must not match a /c/ that is not at the start
		expect(isSessionRoute("/x/c/abc")).toBe(false);
	});
});

describe("routeKey", () => {
	it("keys session routes by id only, so query changes do not look like navigation", () => {
		expect(routeKey("/c/abc123", "?a=1")).toBe("c:abc123");
		expect(routeKey("/c/abc123", "?a=2")).toBe("c:abc123");
	});

	it("keys non-session routes by path + search", () => {
		expect(routeKey("/", "?mode=direct")).toBe("/?mode=direct");
		expect(routeKey("/settings", "")).toBe("/settings");
	});

	it("gives different keys to different sessions", () => {
		expect(routeKey("/c/aaa", "")).not.toBe(routeKey("/c/bbb", ""));
	});
});
