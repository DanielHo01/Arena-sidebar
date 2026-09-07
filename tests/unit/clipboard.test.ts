// Real-source test: platform/clipboard.ts — the only module allowed to touch
// navigator.clipboard.
//
// Why this module exists: four call sites did
// `navigator.clipboard.writeText(x).then(() => {})` with no .catch. The
// Clipboard API rejects on denied permission, missing user activation, and any
// non-secure context, so each of those was an unhandled rejection that left the
// button showing a success state it had not earned.
//
// jsdom ships no navigator.clipboard at all, which is also the honest worst
// case: the module must survive its absence rather than throw.

import { afterEach, describe, it, expect, vi } from "vitest";
import { copyText, setClipboardBackend } from "../../src/platform/clipboard";

afterEach(() => {
	setClipboardBackend(null);
});

describe("copyText — success", () => {
	it("resolves true and forwards the text when the API accepts", async () => {
		const writeText = vi.fn(() => Promise.resolve());
		setClipboardBackend({ writeText });
		await expect(copyText("hello")).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith("hello");
	});

	it("copies an empty string without special-casing it", async () => {
		const writeText = vi.fn(() => Promise.resolve());
		setClipboardBackend({ writeText });
		await expect(copyText("")).resolves.toBe(true);
		expect(writeText).toHaveBeenCalledWith("");
	});
});

describe("copyText — every failure path resolves false instead of rejecting", () => {
	it("resolves false when the API rejects (denied permission)", async () => {
		setClipboardBackend({
			writeText: () => Promise.reject(new Error("NotAllowedError")),
		});
		await expect(copyText("x")).resolves.toBe(false);
	});

	it("resolves false when writeText throws synchronously", async () => {
		setClipboardBackend({
			writeText: () => {
				throw new Error("boom");
			},
		});
		await expect(copyText("x")).resolves.toBe(false);
	});

	it("resolves false when there is no clipboard at all (jsdom, insecure context)", async () => {
		// No backend injected, and jsdom provides no navigator.clipboard.
		await expect(copyText("x")).resolves.toBe(false);
	});

	it("resolves false when the backend exists but has no writeText", async () => {
		setClipboardBackend({} as { writeText: (t: string) => Promise<void> });
		await expect(copyText("x")).resolves.toBe(false);
	});

	it("resolves false when writeText returns a non-promise", async () => {
		setClipboardBackend({
			writeText: (() => undefined) as unknown as (t: string) => Promise<void>,
		});
		await expect(copyText("x")).resolves.toBe(false);
	});

	it("never rejects, so a caller cannot crash the content script", async () => {
		setClipboardBackend({ writeText: () => Promise.reject(new Error("x")) });
		// If this rejects, the test fails — that is the point of the assertion.
		await copyText("x");
	});
});

describe("setClipboardBackend", () => {
	it("restores the real lookup when reset to null", async () => {
		setClipboardBackend({ writeText: () => Promise.resolve() });
		await expect(copyText("x")).resolves.toBe(true);
		setClipboardBackend(null);
		// Back to the ambient (absent) clipboard, so this must fail cleanly.
		await expect(copyText("x")).resolves.toBe(false);
	});

	it("a failing copy does not poison the next one", async () => {
		// Regression guard against a contextValid-style global kill switch:
		// one rejection must not disable later copies.
		let shouldFail = true;
		setClipboardBackend({
			writeText: () =>
				shouldFail ? Promise.reject(new Error("once")) : Promise.resolve(),
		});
		await expect(copyText("a")).resolves.toBe(false);
		shouldFail = false;
		await expect(copyText("b")).resolves.toBe(true);
	});
});
