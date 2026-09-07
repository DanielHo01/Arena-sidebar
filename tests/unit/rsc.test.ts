import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetRscState, setupRscCapture } from "../../src/capture/rsc";
import type { Disposer } from "../../src/types";

const EVENT_NAME = "__aiSidebarRsc";
const disposers: Disposer[] = [];

function track(disposer: Disposer): void {
	disposers.push(disposer);
}

function emit(detail: unknown): void {
	document.documentElement.dispatchEvent(
		new CustomEvent(EVENT_NAME, { detail }),
	);
}

function payload(overrides: Record<string, unknown> = {}): string {
	return JSON.stringify({
		url: "/api/agent",
		status: 200,
		ts: 1,
		body: "short body",
		...overrides,
	});
}

beforeEach(() => {
	resetRscState();
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

afterEach(() => {
	while (disposers.length > 0) disposers.pop()!();
	resetRscState();
	vi.restoreAllMocks();
	document.head.innerHTML = "";
	document.body.innerHTML = "";
});

describe("setupRscCapture lifecycle", () => {
	it("registers a listener and returns a disposer", () => {
		const dispose = setupRscCapture();
		track(dispose);

		expect(typeof dispose).toBe("function");
	});

	it("is idempotent while the first registration is live", () => {
		const first = setupRscCapture();
		track(first);
		const second = setupRscCapture();
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		emit(payload());
		expect(log).toHaveBeenCalledTimes(1);

		second();
		emit(payload({ ts: 2 }));
		expect(log).toHaveBeenCalledTimes(2);

		first();
		emit(payload({ ts: 3 }));
		expect(log).toHaveBeenCalledTimes(2);
	});

	it("can be registered again after disposal", () => {
		const first = setupRscCapture();
		first();
		const second = setupRscCapture();
		track(second);
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		emit(payload());

		expect(log).toHaveBeenCalledTimes(1);
		second();
	});
});

describe("RSC event parsing", () => {
	beforeEach(() => {
		track(setupRscCapture());
	});

	it("ignores an empty event detail", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		emit("");
		emit(null);

		expect(log).toHaveBeenCalledTimes(0);
	});

	it("ignores malformed JSON", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		emit("not-json");

		expect(log).toHaveBeenCalledTimes(0);
	});

	it("uses defaults for omitted payload fields", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		emit(JSON.stringify({ ts: 1 }));

		expect(log).toHaveBeenCalledWith(
			"[AI Sidebar] RSC captured: status=0 len=0 url=",
		);
	});

	it("warns for an RSC error and does not log it as a capture", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		emit(payload({ ts: 2, error: "upstream failed" }));

		expect(warn).toHaveBeenCalledWith(
			"[AI Sidebar] RSC error:",
			"upstream failed",
			"url=",
			"/api/agent",
		);
		expect(log).toHaveBeenCalledTimes(0);
	});

	it("logs a preview and structure probe for a long body", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});
		const body =
			'"role":"assistant","content":"answer","id":"1234567890abcdef-1234567890abcdef"' +
			"x".repeat(60);

		emit(payload({ ts: 3, body }));

		expect(log).toHaveBeenCalledWith(
			"[AI Sidebar] RSC captured: status=200 len=" +
				body.length +
				" url=/api/agent",
		);
		expect(log).toHaveBeenCalledWith(
			"[AI Sidebar] RSC preview (first 2000 chars):",
			body,
		);
		expect(log).toHaveBeenCalledWith(
			"[AI Sidebar] RSC structure: role-token=true content-field=true uuid-id=true",
		);
	});
});

describe("timestamp guard", () => {
	beforeEach(() => {
		track(setupRscCapture());
	});

	it("ignores an event whose timestamp is not newer", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		emit(payload({ ts: 10, body: "first" }));
		emit(payload({ ts: 10, body: "same timestamp" }));
		emit(payload({ ts: 9, body: "older" }));

		expect(log).toHaveBeenCalledTimes(1);
	});

	it("resetRscState allows a timestamp to be observed again", () => {
		const log = vi.spyOn(console, "log").mockImplementation(() => {});

		emit(payload({ ts: 10 }));
		resetRscState();
		emit(payload({ ts: 10 }));

		expect(log).toHaveBeenCalledTimes(2);
	});
});
