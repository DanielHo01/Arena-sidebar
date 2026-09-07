// Phase 1 bug fix: preScrollDone was set once at bootstrap and never cleared,
// and startPreScroll() was only ever called from bootstrap. So navigating to
// another /c/{id} session never force-loaded its virtualised history -- the
// panel only ever saw the ~8 messages Arena happened to have rendered.
//
// content.ts runs its bootstrap IIFE at import time, which is why this logic was
// extracted into src/features/prescroll.ts: it can now be imported and tested.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	isPreScrollActive,
	resetPreScroll,
	startPreScroll,
} from "../../src/features/prescroll";

// jsdom reports scrollHeight/clientHeight as 0, so findScrollContainer() returns
// null and startPreScroll takes its retry path: 200ms per tick, giving up after
// 10 retries. Fake timers keep that instant instead of a real 2.2s wait.
const RETRY_MS = 200;
const GIVE_UP_MS = RETRY_MS * 11;

beforeEach(() => {
	vi.useFakeTimers();
	resetPreScroll();
});

afterEach(() => {
	resetPreScroll();
	vi.useRealTimers();
});

describe("startPreScroll", () => {
	it("does not complete synchronously on a cold start", () => {
		let done = false;
		startPreScroll(() => {
			done = true;
		});
		expect(done).toBe(false);
	});

	it("completes once the retry budget is exhausted", () => {
		let done = false;
		startPreScroll(() => {
			done = true;
		});
		vi.advanceTimersByTime(GIVE_UP_MS);
		expect(done).toBe(true);
	});

	it("short-circuits synchronously once it has already run", () => {
		startPreScroll(() => {});
		vi.advanceTimersByTime(GIVE_UP_MS);

		// Second call takes the `if (preScrollDone) { onDone(); return; }` path.
		let second = false;
		startPreScroll(() => {
			second = true;
		});
		expect(second).toBe(true);
	});

	// ── The regression ────────────────────────────────────────────────────
	it("resetPreScroll makes the next route scroll again", () => {
		startPreScroll(() => {});
		vi.advanceTimersByTime(GIVE_UP_MS);

		resetPreScroll();

		// Before the fix there was no way to clear the flag, so a session switch
		// took the short-circuit path and never loaded the new history.
		let afterReset = false;
		startPreScroll(() => {
			afterReset = true;
		});
		expect(afterReset).toBe(false); // went through the retry path again

		vi.advanceTimersByTime(GIVE_UP_MS);
		expect(afterReset).toBe(true);
	});

	it("is not active before or after a completed run", () => {
		expect(isPreScrollActive()).toBe(false);
		startPreScroll(() => {});
		vi.advanceTimersByTime(GIVE_UP_MS);
		expect(isPreScrollActive()).toBe(false);
	});

	it("resetPreScroll clears the in-flight flag", () => {
		resetPreScroll();
		expect(isPreScrollActive()).toBe(false);
	});
});
