// Phase 1 bug fix: preScrollDone was set once at bootstrap and never cleared,
// and startPreScroll() was only ever called from bootstrap. So navigating to
// another /c/{id} session never force-loaded its virtualised history -- the
// panel only ever saw the ~8 messages Arena happened to have rendered.
//
// content.ts runs its bootstrap IIFE at import time, which is why this logic was
// extracted into src/features/prescroll.ts: it can now be imported and tested.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	findScrollContainer,
	isPreScrollActive,
	resetPreScroll,
	startPreScroll,
} from "../../src/features/prescroll";

// jsdom reports scrollHeight/clientHeight as 0, so findScrollContainer() returns
// null and startPreScroll takes its retry path: 200ms per tick, giving up after
// 10 retries. Fake timers keep that instant instead of a real 2.2s wait.
const RETRY_MS = 200;
const GIVE_UP_MS = RETRY_MS * 11;

function setGeometry(
	el: HTMLElement,
	scrollHeight: number,
	clientHeight: number,
): void {
	Object.defineProperties(el, {
		scrollHeight: { configurable: true, value: scrollHeight },
		clientHeight: { configurable: true, value: clientHeight },
	});
}

function mountVirtualizedContainer(
	scrollHeight = 4000,
	clientHeight = 1000,
): {
	main: HTMLElement;
	container: HTMLElement;
	scrollBy: ReturnType<typeof vi.fn>;
} {
	document.body.innerHTML =
		'<main><div><div class="h-full w-full overscroll-none"></div></div></main>';
	const main = document.querySelector("main") as HTMLElement;
	const container = main.querySelector(
		'[class*="overscroll-none"]',
	) as HTMLElement;
	setGeometry(container, scrollHeight, clientHeight);
	const scrollBy = vi.fn();
	Object.defineProperty(container, "scrollBy", {
		configurable: true,
		value: scrollBy,
	});
	return { main, container, scrollBy };
}

beforeEach(() => {
	vi.useFakeTimers();
	resetPreScroll();
	document.body.innerHTML = "";
});

afterEach(() => {
	resetPreScroll();
	vi.restoreAllMocks();
	vi.useRealTimers();
	document.body.innerHTML = "";
});

describe("findScrollContainer", () => {
	it("returns Arena's direct container when it is strongly virtualized", () => {
		const { container } = mountVirtualizedContainer(4000, 1000);

		expect(findScrollContainer()).toBe(container);
	});

	it("returns the largest scrollable element from the main fallback", () => {
		document.body.innerHTML = `
			<main>
				<div data-size="small"></div>
				<div data-size="large"></div>
				<div data-size="medium"></div>
			</main>`;
		const main = document.querySelector("main") as HTMLElement;
		const small = main.querySelector('[data-size="small"]') as HTMLElement;
		const large = main.querySelector('[data-size="large"]') as HTMLElement;
		const medium = main.querySelector('[data-size="medium"]') as HTMLElement;
		setGeometry(small, 1000, 300); // score 700
		setGeometry(large, 3000, 500); // score 2500
		setGeometry(medium, 1800, 400); // score 1400, not the winner

		expect(findScrollContainer()).toBe(large);
	});

	it("returns null when there is no main element", () => {
		expect(findScrollContainer()).toBeNull();
	});

	it("returns null when the direct container is not scrollable enough", () => {
		mountVirtualizedContainer(1800, 1000);

		expect(findScrollContainer()).toBeNull();
	});
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

	it("clears an active interval and prevents its completion callback", () => {
		const { container } = mountVirtualizedContainer();
		const done = vi.fn();
		startPreScroll(done);
		expect(isPreScrollActive()).toBe(true);

		resetPreScroll();
		expect(vi.getTimerCount()).toBe(0);
		vi.advanceTimersByTime(5000);

		expect(isPreScrollActive()).toBe(false);
		expect(done).not.toHaveBeenCalled();
		expect(container.scrollTop).toBe(0);
	});
});

describe("virtualized scroll algorithm", () => {
	it("scrolls until three stable ticks, then returns to the top", () => {
		const { container, scrollBy } = mountVirtualizedContainer(4000, 500);
		const done = vi.fn();

		startPreScroll(done);
		expect(isPreScrollActive()).toBe(true);

		vi.advanceTimersByTime(120 * 3);
		expect(scrollBy).toHaveBeenCalledTimes(3);
		expect(scrollBy).toHaveBeenCalledWith(0, 1500);
		expect(done).not.toHaveBeenCalled();
		expect(isPreScrollActive()).toBe(false);

		vi.advanceTimersByTime(599);
		expect(done).not.toHaveBeenCalled();
		vi.advanceTimersByTime(1);
		expect(done).toHaveBeenCalledTimes(1);
		expect(container.scrollTop).toBe(0);
	});

	it("resets stability when scrolling reveals another message", () => {
		const { main, scrollBy } = mountVirtualizedContainer();
		const firstMessage = document.createElement("div");
		firstMessage.className = "bg-surface-raised rounded-lg";
		firstMessage.textContent = "question";
		main.appendChild(firstMessage);
		const done = vi.fn();
		scrollBy.mockImplementation(() => {
			if (scrollBy.mock.calls.length === 1) {
				const next = document.createElement("div");
				next.className = "bg-surface-primary flex-col overflow-hidden";
				next.textContent = "answer";
				main.appendChild(next);
			}
		});

		startPreScroll(done);
		vi.advanceTimersByTime(120 * 4);
		expect(scrollBy).toHaveBeenCalledTimes(4);
		expect(done).not.toHaveBeenCalled();
		vi.advanceTimersByTime(600);
		expect(done).toHaveBeenCalledTimes(1);
	});

	it("continues to completion when message selectors throw", () => {
		const { main } = mountVirtualizedContainer();
		vi.spyOn(main, "querySelectorAll").mockImplementation(() => {
			throw new Error("detached main");
		});
		const done = vi.fn();

		startPreScroll(done);
		vi.advanceTimersByTime(120 * 3 + 600);

		expect(done).toHaveBeenCalledTimes(1);
	});

	it("starts scrolling when the container appears during retry", () => {
		document.body.innerHTML = "";
		const done = vi.fn();
		startPreScroll(done);
		expect(isPreScrollActive()).toBe(false);

		mountVirtualizedContainer();
		vi.advanceTimersByTime(RETRY_MS);
		expect(isPreScrollActive()).toBe(true);

		vi.advanceTimersByTime(120 * 3 + 600);
		expect(done).toHaveBeenCalledTimes(1);
	});
});
