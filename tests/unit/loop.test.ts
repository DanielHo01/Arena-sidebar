// app/loop.ts — the reactive half of the extension.
//
// This module had 0% coverage despite owning the route-change path where all
// four Phase 1 bugs lived. It is the only place that decides "something changed,
// re-render", so a regression here is invisible in every other test file.
//
// loop.ts keeps module-level state (lastRouteKey, isFirstRender, observer) with
// no reset export, so every test gets a fresh module instance via
// vi.resetModules(). Importing ../state from the same fresh registry is what
// lets a test flip panel.isDragging and have the loop actually see it.

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
	refreshStore: vi.fn(),
	extractMessages: vi.fn(() => []),
	pollCaptures: vi.fn(),
	isPreScrollActive: vi.fn(() => false),
	startPreScroll: vi.fn(),
	resetSessionState: vi.fn(),
	ensureArenaFolderEntry: vi.fn(),
	toggleArenaSessionLibrarySection: vi.fn(),
	setupHistoryContextMenu: vi.fn(),
	setupHistoryTitleEditing: vi.fn(),
	onStorageChanged: vi.fn((_key: string, _h: (change: unknown) => void) =>
		vi.fn(),
	),
}));

const store = vi.hoisted(() => ({
	messages: [] as { id: string }[],
	saveToStorage: vi.fn(async () => true),
}));

vi.mock("../../src/conversationStore", () => ({
	conversationStore: store,
	refreshStore: mocks.refreshStore,
}));
vi.mock("../../src/extract", () => ({
	extractMessages: mocks.extractMessages,
}));
vi.mock("../../src/capture", () => ({ pollCaptures: mocks.pollCaptures }));
vi.mock("../../src/features/prescroll", () => ({
	isPreScrollActive: mocks.isPreScrollActive,
	startPreScroll: mocks.startPreScroll,
}));
vi.mock("../../src/app/store", () => ({
	resetSessionState: mocks.resetSessionState,
}));
vi.mock("../../src/ui/arenaSidebar", () => ({
	ensureArenaFolderEntry: mocks.ensureArenaFolderEntry,
	toggleArenaSessionLibrarySection: mocks.toggleArenaSessionLibrarySection,
}));
vi.mock("../../src/ui/contextMenu", () => ({
	setupHistoryContextMenu: mocks.setupHistoryContextMenu,
}));
vi.mock("../../src/historyTitles", () => ({
	setupHistoryTitleEditing: mocks.setupHistoryTitleEditing,
}));
vi.mock("../../src/platform/storage", () => ({
	onStorageChanged: mocks.onStorageChanged,
}));

type Loop = typeof import("../../src/app/loop");
type State = typeof import("../../src/state");

let loop: Loop;
let state: State;

/** Run the callback the loop handed to startPreScroll. */
function finishPreScroll(): void {
	const cb = mocks.startPreScroll.mock.calls.at(-1)?.[0] as () => void;
	cb();
}

/** A DOM mutation plus the microtask flush jsdom needs to deliver it. */
async function mutate(): Promise<void> {
	document.body.appendChild(document.createElement("div"));
	await Promise.resolve();
	await Promise.resolve();
}

function hooks() {
	return { refreshUI: vi.fn(), rebuildForCurrentRoute: vi.fn(async () => {}) };
}

/**
 * Every disposer handed back by a loop, released after each test.
 *
 * This is load-bearing, not tidiness: the observer targets document.body, which
 * survives `document.body.innerHTML = ""`. vi.resetModules() gives the next test
 * a fresh module whose `observer` variable is null, so its own
 * `if (observer) observer.disconnect()` cannot clean up the previous test's
 * observer. Left connected, those stale observers all react to the next test's
 * mutation -- which is how a test expecting one call saw seven.
 */
const disposers: Array<() => void> = [];

function startDom(h: ReturnType<typeof hooks>) {
	const dispose = loop.startDomLoop(h);
	disposers.push(dispose);
	return dispose;
}

function startPeriodic(h: ReturnType<typeof hooks>) {
	const dispose = loop.startPeriodicLoop(h);
	disposers.push(dispose);
	return dispose;
}

beforeEach(async () => {
	vi.resetModules();
	vi.useFakeTimers();
	document.body.innerHTML = "";
	store.messages = [];
	for (const fn of Object.values(mocks)) fn.mockReset();
	store.saveToStorage.mockReset();
	store.saveToStorage.mockResolvedValue(true);
	mocks.isPreScrollActive.mockReturnValue(false);
	mocks.extractMessages.mockReturnValue([]);
	window.history.pushState({}, "", "/");

	loop = await import("../../src/app/loop");
	state = await import("../../src/state");
});

afterEach(() => {
	// Release every loop before the next test, or its observer stays attached to
	// document.body and silently joins in on the next test's mutation.
	while (disposers.length) disposers.pop()?.();
	vi.useRealTimers();
	vi.restoreAllMocks();
});

describe("initRouteState", () => {
	it("seeds the route key so the current page is not read as a change", async () => {
		window.history.pushState({}, "", "/c/aaa");
		loop.initRouteState();
		const h = hooks();
		startDom(h);

		await mutate();
		vi.advanceTimersByTime(800);

		expect(mocks.resetSessionState).not.toHaveBeenCalled();
	});

	it("treats a different page as a change when it was never seeded", async () => {
		// Without initRouteState the key is "", so any route looks new. That is the
		// contract content.ts relies on at bootstrap.
		window.history.pushState({}, "", "/c/aaa");
		const h = hooks();
		startDom(h);

		await mutate();
		vi.advanceTimersByTime(800);

		expect(mocks.resetSessionState).toHaveBeenCalledWith("aaa");
	});
});

describe("startDomLoop", () => {
	it("refreshes on the first settled mutation without a second wait", async () => {
		const h = hooks();
		startDom(h);

		await mutate();
		expect(h.refreshUI).not.toHaveBeenCalled(); // still inside the debounce

		vi.advanceTimersByTime(800);
		expect(h.refreshUI).toHaveBeenCalledTimes(1);
	});

	it("coalesces a burst of mutations into one refresh", async () => {
		const h = hooks();
		startDom(h);

		await mutate();
		vi.advanceTimersByTime(300);
		await mutate();
		vi.advanceTimersByTime(300);
		await mutate();

		// Each mutation restarts the 800ms window, so nothing has fired yet.
		expect(h.refreshUI).not.toHaveBeenCalled();

		vi.advanceTimersByTime(800);
		expect(h.refreshUI).toHaveBeenCalledTimes(1);
	});

	it("rebinds title editing on every settled mutation", async () => {
		const h = hooks();
		startDom(h);

		await mutate();
		vi.advanceTimersByTime(800);
		await mutate();
		vi.advanceTimersByTime(1600);

		expect(mocks.setupHistoryTitleEditing).toHaveBeenCalledTimes(2);
	});

	it("does nothing while the user is dragging the FAB", async () => {
		const h = hooks();
		startDom(h);
		state.panel.isDragging = true;

		await mutate();
		vi.advanceTimersByTime(2000);

		expect(h.refreshUI).not.toHaveBeenCalled();
	});

	it("does nothing while a pre-scroll is running", async () => {
		// Otherwise the panel re-renders against a half-loaded history list.
		mocks.isPreScrollActive.mockReturnValue(true);
		const h = hooks();
		startDom(h);

		await mutate();
		vi.advanceTimersByTime(2000);

		expect(h.refreshUI).not.toHaveBeenCalled();
	});

	it("resets, re-injects and pre-scrolls before rebuilding on a route change", async () => {
		window.history.pushState({}, "", "/c/aaa");
		loop.initRouteState();
		const h = hooks();
		startDom(h);

		window.history.pushState({}, "", "/c/bbb");
		await mutate();
		vi.advanceTimersByTime(800);

		expect(mocks.resetSessionState).toHaveBeenCalledWith("bbb");
		expect(mocks.ensureArenaFolderEntry).toHaveBeenCalledTimes(1);
		expect(mocks.setupHistoryContextMenu).toHaveBeenCalledTimes(1);
		// Phase 1 bug: this path used to rebuild directly, so preScrollDone stayed
		// true from bootstrap and a switched-to session showed only what Arena had
		// already rendered. The rebuild must wait for the pre-scroll.
		expect(mocks.startPreScroll).toHaveBeenCalledTimes(1);
		expect(h.rebuildForCurrentRoute).not.toHaveBeenCalled();

		finishPreScroll();
		expect(h.rebuildForCurrentRoute).toHaveBeenCalledTimes(1);
		// refreshUI is chained after the (async) rebuild resolves, so it lands
		// a microtask later — never before the restore has completed.
		await Promise.resolve();
		await Promise.resolve();
		expect(h.refreshUI).toHaveBeenCalled();
	});

	it("does not re-render before the route change's rebuild has landed", async () => {
		// Found by the browser E2E: the callback used to call refreshUI()
		// synchronously next to the void rebuild, racing an empty store. On a
		// quiet page the next render was then 30s away.
		window.history.pushState({}, "", "/c/aaa");
		loop.initRouteState();
		const h = hooks();
		let release!: () => void;
		h.rebuildForCurrentRoute.mockImplementation(
			() =>
				new Promise<void>((resolve) => {
					release = resolve;
				}),
		);
		startDom(h);

		window.history.pushState({}, "", "/c/bbb");
		await mutate();
		vi.advanceTimersByTime(800);
		const before = h.refreshUI.mock.calls.length;
		finishPreScroll();
		await Promise.resolve();
		await Promise.resolve();

		expect(h.rebuildForCurrentRoute).toHaveBeenCalledTimes(1);
		expect(h.refreshUI.mock.calls.length).toBe(before);

		release();
		await Promise.resolve();
		await Promise.resolve();
		expect(h.refreshUI.mock.calls.length).toBe(before + 1);
	});

	it("re-subscribes hidden-round sync per route change", async () => {
		// The hidden-rounds storage key contains the session id, so each route
		// change must subscribe the NEW session's key and dispose the old one.
		window.history.pushState({}, "", "/c/aaa");
		loop.initRouteState();
		startDom(hooks());

		window.history.pushState({}, "", "/c/bbb");
		await mutate();
		vi.advanceTimersByTime(800);

		window.history.pushState({}, "", "/c/ccc");
		await mutate();
		vi.advanceTimersByTime(800);

		const keys = mocks.onStorageChanged.mock.calls.map((c) => c[0]);
		expect(keys).toEqual([
			"edge-ai-sidebar:hidden-rounds:bbb",
			"edge-ai-sidebar:hidden-rounds:ccc",
		]);
		const disposers = mocks.onStorageChanged.mock.results.map(
			(r) => r.value as ReturnType<typeof vi.fn>,
		);
		expect(disposers[0]).toHaveBeenCalled(); // bbb's listener dropped
		expect(disposers[1]).not.toHaveBeenCalled(); // ccc's still live
	});

	it("ignores query-string churn on a session route", async () => {
		// routeKey keys session pages on the id alone, so ?foo=1 is not navigation.
		window.history.pushState({}, "", "/c/aaa");
		loop.initRouteState();
		const h = hooks();
		startDom(h);

		window.history.pushState({}, "", "/c/aaa?foo=1");
		await mutate();
		vi.advanceTimersByTime(800);

		expect(mocks.resetSessionState).not.toHaveBeenCalled();
	});

	it("disconnects the previous observer when started twice", async () => {
		const first = hooks();
		startDom(first);
		const second = hooks();
		startDom(second);

		await mutate();
		vi.advanceTimersByTime(800);

		expect(first.refreshUI).not.toHaveBeenCalled();
		expect(second.refreshUI).toHaveBeenCalledTimes(1);
	});

	it("stops reacting once disposed", async () => {
		const h = hooks();
		const dispose = startDom(h);

		dispose();
		await mutate();
		vi.advanceTimersByTime(2000);

		expect(h.refreshUI).not.toHaveBeenCalled();
	});

	it("falls back to <main> when Arena's scroll container is absent", async () => {
		// The cascade precise -> main -> body is what keeps the loop alive when
		// Arena changes its markup.
		const main = document.createElement("main");
		document.body.appendChild(main);
		const h = hooks();
		startDom(h);

		main.appendChild(document.createElement("div"));
		await Promise.resolve();
		await Promise.resolve();
		vi.advanceTimersByTime(800);

		expect(h.refreshUI).toHaveBeenCalledTimes(1);
	});
});

describe("startPeriodicLoop", () => {
	it("polls captures every 2s", () => {
		startPeriodic(hooks());

		vi.advanceTimersByTime(2000);
		expect(mocks.pollCaptures).toHaveBeenCalledTimes(1);

		vi.advanceTimersByTime(4000);
		expect(mocks.pollCaptures).toHaveBeenCalledTimes(3);
	});

	it("re-scans the DOM and refreshes every 30s", () => {
		const h = hooks();
		startPeriodic(h);

		vi.advanceTimersByTime(30000);

		expect(mocks.extractMessages).toHaveBeenCalledTimes(1);
		expect(mocks.refreshStore).toHaveBeenCalledWith({
			dom: [],
			bindAnchors: false,
		});
		expect(h.refreshUI).toHaveBeenCalledTimes(1);
	});

	it("persists only when the message count actually changed", () => {
		// Writing the full session payload every 30s while idle was avoidable churn.
		startPeriodic(hooks());

		vi.advanceTimersByTime(30000);
		expect(store.saveToStorage).not.toHaveBeenCalled();

		mocks.refreshStore.mockImplementation(() => {
			store.messages = [...store.messages, { id: "m1" }];
		});
		vi.advanceTimersByTime(30000);
		expect(store.saveToStorage).toHaveBeenCalledTimes(1);
	});

	it("skips both timers while the user is dragging", () => {
		startPeriodic(hooks());
		state.panel.isDragging = true;

		vi.advanceTimersByTime(30000);

		expect(mocks.pollCaptures).not.toHaveBeenCalled();
		expect(mocks.extractMessages).not.toHaveBeenCalled();
	});

	it("is idempotent: a second start does not double the intervals", () => {
		startPeriodic(hooks());
		startPeriodic(hooks());

		vi.advanceTimersByTime(2000);
		expect(mocks.pollCaptures).toHaveBeenCalledTimes(1);
	});

	it("clears both intervals on disposal", () => {
		const dispose = startPeriodic(hooks());
		dispose();

		vi.advanceTimersByTime(60000);

		expect(mocks.pollCaptures).not.toHaveBeenCalled();
		expect(mocks.extractMessages).not.toHaveBeenCalled();
	});

	it("lets a fresh loop start after the previous one was disposed", () => {
		// The idempotency guard keys on timers being non-null, so disposal has to
		// null them out or the loop is dead for the rest of the session.
		startPeriodic(hooks())();
		startPeriodic(hooks());

		vi.advanceTimersByTime(2000);
		expect(mocks.pollCaptures).toHaveBeenCalledTimes(1);
	});
});
