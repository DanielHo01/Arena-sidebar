// Pre-scroll: force Arena to render its virtualised message list.
//
// Arena renders only ~8 messages and lazy-loads more as the user scrolls, so a
// long conversation cannot be extracted without scrolling it first. This module
// owns that forced scroll and its "is it finished" state.
//
// Extracted from content.ts so it can be imported in tests: content.ts runs its
// bootstrap IIFE at module scope, so importing it has side effects.

import { USER_MESSAGE_SELECTOR, ASSISTANT_MESSAGE_SELECTOR } from "../extract";
import { SCROLL_CONTAINER_SELECTOR } from "../platform/arenaDom";

// ─── Pre-scroll: force-render all virtual-scrolled messages ────────────────────────────────

export function findScrollContainer(): HTMLElement | null {
	// The real scroll container is inside <main> with overscroll-none —
	// Arena renders only ~8 messages in DOM and progressively loads more as user scrolls.
	const c = document.querySelector(SCROLL_CONTAINER_SELECTOR);
	if (
		c &&
		(c as HTMLElement).scrollHeight > (c as HTMLElement).clientHeight * 3
	) {
		return c as HTMLElement;
	}
	// Fallback: largest scrollable element inside <main>
	const main = document.querySelector("main");
	if (!main) return null;
	let best: HTMLElement | null = null;
	let bestScore = 0;
	main.querySelectorAll("*").forEach((el) => {
		const e = el as HTMLElement;
		if (e.scrollHeight > e.clientHeight * 2) {
			const score = e.scrollHeight - e.clientHeight;
			if (score > bestScore) {
				bestScore = score;
				best = e;
			}
		}
	});
	return best;
}

let preScrollDone = false;
let preScrollInterval: ReturnType<typeof setInterval> | null = null;
let preScrollActive = false; // suppress observer work while forced-scrolling

// Lightweight container lookup for preScroll retries — avoids the full <main>
// fallback scan (querySelectorAll("*") + per-element scrollHeight forces reflow).
function peekScrollContainer(): HTMLElement | null {
	const c = document.querySelector(SCROLL_CONTAINER_SELECTOR);
	if (
		c &&
		(c as HTMLElement).scrollHeight > (c as HTMLElement).clientHeight * 3
	) {
		return c as HTMLElement;
	}
	return null;
}

/** Poll briefly for Arena's scroll container, which React mounts late. */
function retryUntilContainer(onDone: () => void): void {
	console.log("[AI Sidebar] preScroll: no scroll container yet, retrying...");
	let retries = 0;
	const retry = setInterval(() => {
		const c = peekScrollContainer();
		if (!c && ++retries <= 10) return;
		clearInterval(retry);
		if (!c) {
			console.log(
				"[AI Sidebar] preScroll: gave up, no container after retries",
			);
			preScrollDone = true;
			onDone();
			return;
		}
		startPreScroll(onDone);
	}, 200);
}

/**
 * Scroll in steps until Arena stops rendering new messages, then scroll back up.
 *
 * Stopping on stability rather than at the bottom matters: forcing the whole
 * conversation to render janks long chats.
 */
function scrollUntilStable(container: Element, onDone: () => void): void {
	const step = Math.max(container.clientHeight * 2, 1500);
	console.log(
		"[AI Sidebar] preScroll: totalH=",
		container.scrollHeight,
		"step=",
		step,
	);
	preScrollActive = true;
	let lastMsgCount = countRenderedMessages();
	let stableTicks = 0;
	const STABLE_LIMIT = 3;
	preScrollInterval = setInterval(() => {
		// Defense: if the interval was cleared externally, stop cleanly.
		if (!preScrollActive || !preScrollInterval) {
			if (preScrollInterval) clearInterval(preScrollInterval);
			preScrollInterval = null;
			preScrollActive = false;
			return;
		}
		container.scrollBy(0, step);
		const newCount = countRenderedMessages();
		if (newCount > lastMsgCount) {
			lastMsgCount = newCount;
			stableTicks = 0;
		} else {
			stableTicks++;
		}
		if (stableTicks < STABLE_LIMIT) return;
		clearInterval(preScrollInterval);
		preScrollInterval = null;
		preScrollActive = false;
		console.log("[AI Sidebar] preScroll: done, messages=" + lastMsgCount);
		setTimeout(() => {
			container.scrollTop = 0;
			preScrollDone = true;
			onDone();
		}, 600);
	}, 120);
}

export function startPreScroll(onDone: () => void) {
	if (preScrollDone) {
		onDone();
		return;
	}
	const container = findScrollContainer();
	if (!container) {
		// Arena's React renders the scroll container after the body exists, so
		// retry briefly (using the cheap peek) instead of giving up — a skipped
		// preScroll leaves long conversations partially extracted.
		retryUntilContainer(onDone);
		return;
	}
	// preScroll exists because Arena virtualizes (renders only ~8 messages) and we
	// need the full list extracted. If the container isn't virtualized (fits on
	// screen), skip entirely — no scroll, no extract, no signature burn.
	if (container.scrollHeight <= container.clientHeight * 2) {
		console.log("[AI Sidebar] preScroll: skipped, container not virtualized");
		preScrollDone = true;
		onDone();
		return;
	}
	scrollUntilStable(container, onDone);
}

// Count rendered message elements cheaply (querySelectorAll, no reflow).
function countRenderedMessages(): number {
	const main = document.querySelector("main");
	if (!main) return 0;
	let n = 0;
	try {
		n += main.querySelectorAll(USER_MESSAGE_SELECTOR).length;
	} catch {
		/* selector may throw on detached nodes */
	}
	try {
		n += main.querySelectorAll(ASSISTANT_MESSAGE_SELECTOR).length;
	} catch {
		/* selector may throw on detached nodes */
	}
	return n;
}

/** Whether a forced scroll is currently in flight. */
export function isPreScrollActive(): boolean {
	return preScrollActive;
}

/**
 * Clear pre-scroll state so the next route can scroll again.
 *
 * This is the fix for a real bug: preScrollDone was set once at bootstrap and
 * never cleared, and startPreScroll() was only ever called from bootstrap, so
 * navigating to another /c/{id} session never force-loaded its history.
 */
export function resetPreScroll(): void {
	if (preScrollInterval) {
		clearInterval(preScrollInterval);
		preScrollInterval = null;
	}
	preScrollActive = false;
	preScrollDone = false;
}
