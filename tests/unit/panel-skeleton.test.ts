// The panel shell: header, search, list container, and style injection.
//
// ui/panel/skeleton.ts was split out of the 413-line ui/panel.ts in Phase 5 and
// has had no tests since. It is built once and then reused, so the interesting
// behaviour is idempotency plus the wiring of each header button -- including the
// two buttons that exist on only one of the two route families.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ensurePanelSkeleton, ensureStyles } from "../../src/ui/panel/skeleton";
import { panel } from "../../src/state";
import { exportConversation, summarizeRounds } from "../../src/ui/modals";

vi.mock("../../src/ui/modals", () => ({
	exportConversation: vi.fn(),
	summarizeRounds: vi.fn(),
}));

const mockExport = vi.mocked(exportConversation);
const mockSummarize = vi.mocked(summarizeRounds);

function makeShadow(): ShadowRoot {
	const host = document.createElement("div");
	document.body.appendChild(host);
	return host.attachShadow({ mode: "open" });
}

/** Buttons in .header-actions, in DOM order. */
function headerButtons(shadow: ShadowRoot): HTMLButtonElement[] {
	return [
		...shadow.querySelectorAll<HTMLButtonElement>(
			".header-actions .summary-btn",
		),
	];
}

function byTitle(
	shadow: ShadowRoot,
	title: string,
): HTMLButtonElement | undefined {
	return headerButtons(shadow).find((b) => b.title === title);
}

describe("ensurePanelSkeleton", () => {
	let shadow: ShadowRoot;
	const refreshUI = vi.fn();

	beforeEach(() => {
		document.body.innerHTML = "";
		shadow = makeShadow();
		// Module-level state shared with the whole test process.
		panel.isOpen = false;
		panel.searchQuery = "";
		panel.reverseOrder = true;
		refreshUI.mockClear();
		mockExport.mockClear();
		mockSummarize.mockClear();
		window.history.pushState({}, "", "/");
	});

	it("builds the shell the rest of the UI hangs off", () => {
		const el = ensurePanelSkeleton(shadow, 7, 12, refreshUI);

		expect(el.className).toBe("panel");
		expect(el.getAttribute("data-ai-sidebar-panel")).toBe("1");
		expect(el.querySelector(".panel-title")?.textContent).toBe(
			"7 loaded rounds",
		);
		expect(el.querySelector(".search-input")).not.toBeNull();
		expect(el.querySelector(".list")).not.toBeNull();
		expect(el.querySelector(".close-btn")).not.toBeNull();
		// The close button carries an inline SVG, not a text glyph.
		expect(el.querySelector(".close-btn svg")).not.toBeNull();
	});

	it("is idempotent and updates the round count on reuse", () => {
		const first = ensurePanelSkeleton(shadow, 3, 6, refreshUI);
		const second = ensurePanelSkeleton(shadow, 9, 20, refreshUI);

		expect(second).toBe(first);
		expect(shadow.querySelectorAll(".panel")).toHaveLength(1);
		expect(second.querySelector(".panel-title")?.textContent).toBe(
			"9 loaded rounds",
		);
	});

	it("toggles the round order and refreshes", () => {
		panel.reverseOrder = true;
		const el = ensurePanelSkeleton(shadow, 1, 2, refreshUI);

		byTitle(shadow, "Newest first (click to reverse)")!.click();

		expect(panel.reverseOrder).toBe(false);
		expect(refreshUI).toHaveBeenCalledTimes(1);
		// The button is built once, so its glyph is stale until refreshUI re-renders.
		expect(el.querySelector(".header-actions .summary-btn")!.textContent).toBe(
			"🔃",
		);
	});

	it("closes the panel and refreshes", () => {
		panel.isOpen = true;
		const el = ensurePanelSkeleton(shadow, 1, 2, refreshUI);

		el.querySelector<HTMLButtonElement>(".close-btn")!.click();

		expect(panel.isOpen).toBe(false);
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	it("filters on the lowercased, trimmed search value", () => {
		const el = ensurePanelSkeleton(shadow, 1, 2, refreshUI);
		const input = el.querySelector<HTMLInputElement>(".search-input")!;

		input.value = "  Mixed Case  ";
		input.dispatchEvent(new Event("input"));

		expect(panel.searchQuery).toBe("mixed case");
		expect(refreshUI).toHaveBeenCalledTimes(1);
	});

	it("exports the current conversation", () => {
		ensurePanelSkeleton(shadow, 1, 2, refreshUI);

		byTitle(shadow, "Export current conversation")!.click();

		expect(mockExport).toHaveBeenCalledTimes(1);
		expect(mockExport.mock.calls[0]?.[1]).toBe(shadow);
	});

	it("offers summarize off a session route and hides the scan button", () => {
		window.history.pushState({}, "", "/library");
		ensurePanelSkeleton(shadow, 1, 2, refreshUI);

		expect(byTitle(shadow, "AI summarize rounds")).toBeDefined();
		expect(byTitle(shadow, "Scan older loaded history")).toBeUndefined();

		byTitle(shadow, "AI summarize rounds")!.click();
		expect(mockSummarize).toHaveBeenCalledTimes(1);
	});

	it("offers scan on a session route and hides summarize", () => {
		// /c/ character chats have no full history, so summarizing there would
		// silently summarize a fragment. Scan is what those routes need instead.
		window.history.pushState({}, "", "/c/abc123");
		ensurePanelSkeleton(shadow, 1, 2, refreshUI);

		expect(byTitle(shadow, "Scan older loaded history")).toBeDefined();
		expect(byTitle(shadow, "AI summarize rounds")).toBeUndefined();
	});

	it("ignores a second scan click while one is still running", () => {
		// jsdom has no scrolling, so stub the two calls the scan loop makes.
		const scrollBy = vi
			.spyOn(window, "scrollBy")
			.mockImplementation(() => undefined);
		vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
		window.history.pushState({}, "", "/c/abc123");
		ensurePanelSkeleton(shadow, 1, 2, refreshUI);

		const scan = byTitle(shadow, "Scan older loaded history")!;
		scan.click();
		scan.click();
		scan.click();

		// Only the first click schedules work; the rest hit the `scanning` guard.
		expect(scrollBy).not.toHaveBeenCalled();
		vi.restoreAllMocks();
	});
});

describe("ensureStyles", () => {
	beforeEach(() => {
		document.body.innerHTML = "";
	});

	it("injects the stylesheet into the shadow root", () => {
		const shadow = makeShadow();

		ensureStyles(shadow);

		const style = shadow.querySelector("style");
		expect(style).not.toBeNull();
		expect(style!.textContent!.length).toBeGreaterThan(0);
	});

	it("injects only once", () => {
		const shadow = makeShadow();

		ensureStyles(shadow);
		ensureStyles(shadow);

		expect(shadow.querySelectorAll("style")).toHaveLength(1);
	});

	it("leaves an existing style element alone", () => {
		const shadow = makeShadow();
		const existing = document.createElement("style");
		existing.textContent = "/* pre-existing */";
		shadow.appendChild(existing);

		ensureStyles(shadow);

		expect(shadow.querySelectorAll("style")).toHaveLength(1);
		expect(existing.textContent).toBe("/* pre-existing */");
	});
});

// The scan-older-history button is the one piece of this file with real control
// flow: a 650ms interval that scrolls up, checks whether Arena loaded more
// messages, and must stop. It has three independent exits -- hit the top, four
// ticks without new messages, or a hard cap of ten steps. Lose any one of them
// and the page scrolls forever, which is why each is asserted separately.
describe("the scan-older-history loop", () => {
	let shadow: ShadowRoot;
	let scrollBy: ReturnType<typeof vi.spyOn>;
	let scrollTo: ReturnType<typeof vi.spyOn>;

	/** jsdom has no scrolling; scrollY is a plain 0. Make it settable. */
	function setScrollY(value: number): void {
		Object.defineProperty(window, "scrollY", {
			configurable: true,
			get: () => value,
		});
	}

	/**
	 * Advance the scan loop by exactly one interval period.
	 *
	 * The interval scrolls every 650ms and each scroll schedules its own check
	 * 220ms later, so one 650ms step produces one scroll and runs the *previous*
	 * step's check. After N steps: N scrolls, N-1 checks.
	 *
	 * Advancing 650+220 in one go is wrong: 870ms straddles the next interval
	 * boundary (2600 < 3*870), so the third step double-counts a scroll.
	 */
	function tick(): void {
		vi.advanceTimersByTime(650);
	}

	function scanButton(): HTMLButtonElement {
		window.history.pushState({}, "", "/c/abc123");
		ensurePanelSkeleton(shadow, 1, 2, vi.fn());
		return byTitle(shadow, "Scan older loaded history")!;
	}

	/** Arena "loaded more history": one more anchored message in the DOM. */
	function loadMoreMessages(n: number): void {
		for (let i = 0; i < n; i++) {
			const el = document.createElement("div");
			el.setAttribute("data-ai-sidebar-id", `loaded-${Math.random()}`);
			document.body.appendChild(el);
		}
	}

	beforeEach(() => {
		document.body.innerHTML = "";
		shadow = makeShadow();
		vi.useFakeTimers();
		scrollBy = vi.spyOn(window, "scrollBy").mockImplementation(() => undefined);
		scrollTo = vi.spyOn(window, "scrollTo").mockImplementation(() => undefined);
		setScrollY(0);
	});

	afterEach(() => {
		vi.useRealTimers();
		vi.restoreAllMocks();
		window.history.pushState({}, "", "/");
	});

	it("stops as soon as it reaches the top of the page", () => {
		setScrollY(0); // startY is captured here
		scanButton().click();

		tick(); // scroll 1; its check is still pending
		expect(scrollBy).toHaveBeenCalledTimes(1);

		// The pending check runs during the next step, sees scrollY <= 0, clears
		// the interval and schedules the restore 250ms later -- all inside 650ms.
		tick();
		expect(scrollBy).toHaveBeenCalledTimes(1);
		expect(scrollTo).toHaveBeenCalledWith({ top: 0, behavior: "auto" });

		tick();
		tick();
		expect(scrollBy).toHaveBeenCalledTimes(1);
	});

	it("stops after four ticks that loaded nothing new", () => {
		setScrollY(5000);
		scanButton().click();

		tick(); // scroll 1
		tick(); // check 1 -> idle 1, scroll 2
		tick(); // check 2 -> idle 2, scroll 3
		tick(); // check 3 -> idle 3, scroll 4
		expect(scrollBy).toHaveBeenCalledTimes(4);

		// Check 4 pushes idleTicks to 4, which clears the interval before the next
		// scroll is due, so the count stays at 4.
		tick();
		expect(scrollBy).toHaveBeenCalledTimes(4);
		expect(scrollTo).toHaveBeenCalledWith({ top: 5000, behavior: "auto" });

		tick();
		expect(scrollBy).toHaveBeenCalledTimes(4);
	});

	it("keeps going while new messages keep arriving", () => {
		// Progress resets the idle counter, so a page that is still loading must not
		// be abandoned after four ticks. Each message lands before the check that
		// reads the count.
		setScrollY(5000);
		scanButton().click();

		for (let i = 0; i < 8; i++) {
			loadMoreMessages(1);
			tick();
		}

		expect(scrollBy).toHaveBeenCalledTimes(8);
		expect(scrollTo).not.toHaveBeenCalled();
	});

	it("stops at the ten-step cap even while messages keep arriving", () => {
		setScrollY(5000);
		scanButton().click();

		// Never idle, so the idle exit cannot fire -- only the hard cap can stop it.
		for (let i = 0; i < 12; i++) {
			loadMoreMessages(1);
			tick();
		}

		expect(scrollBy).toHaveBeenCalledTimes(10);
	});

	it("can be started again once the previous scan finished", () => {
		setScrollY(0);
		const scan = scanButton();

		scan.click();
		tick(); // scroll 1
		tick(); // check 1 -> stop, restore, scanning = false
		expect(scrollBy).toHaveBeenCalledTimes(1);

		// The `scanning` guard must be released, or the button is dead for the rest
		// of the session.
		scan.click();
		tick();

		expect(scrollBy).toHaveBeenCalledTimes(2);
	});
});
