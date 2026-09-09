// The content-script assembler.
//
// src/content.ts was the last non-barrel module at 0% coverage. It is an IIFE
// that runs on import, so the only way to test it is to mock every dependency
// and re-import it fresh per test.
//
// What matters here is not line coverage of the wiring -- it is the two
// orderings that Phase 1 turned on:
//
//   1. rebuildForCurrentRoute must restore from storage BEFORE re-extracting
//      from the DOM, or a switched-to session shows only what Arena has
//      already rendered.
//   2. bootstrap must be idempotent, because three separate triggers race to
//      call it (immediate, DOMContentLoaded, MutationObserver).

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const m = vi.hoisted(() => {
	const order: string[] = [];
	const store = {
		sessionId: "",
		messages: [] as unknown[],
		rounds: [] as unknown[],
		loadFromStorage: vi.fn(async (_sid: string) => {
			order.push("loadFromStorage");
			return null;
		}),
		saveToStorage: vi.fn(async () => {
			order.push("saveToStorage");
		}),
		reset: vi.fn(),
	};
	return {
		order,
		store,
		extractMessages: vi.fn(() => {
			order.push("extractMessages");
			return [];
		}),
		extractBootstrapMessages: vi.fn(() => {
			order.push("extractBootstrapMessages");
			return [];
		}),
		refreshStore: vi.fn(
			(_opts: {
				bootstrap: unknown[];
				dom: unknown[];
				bindAnchors?: boolean;
			}) => {
				order.push("refreshStore");
			},
		),
		getSessionId: vi.fn(() => ""),
		isSessionRoute: vi.fn(() => false),
		storageGet: vi.fn(async (): Promise<unknown> => undefined),
		loadHiddenRounds: vi.fn(async () => {
			order.push("loadHiddenRounds");
		}),
		setupHiddenRoundsSync: vi.fn(() => vi.fn()),
		registerDisposer: vi.fn((d: () => void) => d),
		disposeAll: vi.fn(),
		initRouteState: vi.fn(),
		startDomLoop: vi.fn(
			(_hooks: {
				refreshUI: () => void;
				rebuildForCurrentRoute: () => Promise<void>;
			}) => vi.fn(),
		),
		startPeriodicLoop: vi.fn(() => vi.fn()),
		setupKeyboardShortcuts: vi.fn(() => vi.fn()),
		setupTheme: vi.fn(() => vi.fn()),
		renderUI: vi.fn(),
		startPreScroll: vi.fn(),
		setupRscCapture: vi.fn(() => vi.fn()),
		initFolders: vi.fn(async () => {}),
		migrateHistoryTitles: vi.fn(async () => {}),
		setupSessionMetaSync: vi.fn(() => vi.fn()),
		setupFoldersStorageSync: vi.fn(() => vi.fn()),
		ensureArenaFolderEntry: vi.fn(),
		toggleArenaSessionLibrarySection: vi.fn(),
		setupHistoryContextMenu: vi.fn(() => vi.fn()),
		setupHistoryTitles: vi.fn(() => vi.fn()),
		panel: { isOpen: false, isDragging: false },
		fab: { position: null as { x: number; y: number } | null },
	};
});

vi.mock("../../src/extract", () => ({ extractMessages: m.extractMessages }));
vi.mock("../../src/features/bootstrapExtract", () => ({
	extractBootstrapMessages: m.extractBootstrapMessages,
}));
vi.mock("../../src/conversationStore", () => ({
	conversationStore: m.store,
	refreshStore: m.refreshStore,
}));
vi.mock("../../src/state", () => ({ panel: m.panel, fab: m.fab }));
vi.mock("../../src/capture", () => ({ setupRscCapture: m.setupRscCapture }));
vi.mock("../../src/features/sessions", () => ({
	initFolders: m.initFolders,
	migrateHistoryTitles: m.migrateHistoryTitles,
	setupSessionMetaSync: m.setupSessionMetaSync,
}));
vi.mock("../../src/ui/arenaSidebar", () => ({
	ensureArenaFolderEntry: m.ensureArenaFolderEntry,
	setupFoldersStorageSync: m.setupFoldersStorageSync,
	toggleArenaSessionLibrarySection: m.toggleArenaSessionLibrarySection,
}));
vi.mock("../../src/ui/contextMenu", () => ({
	setupHistoryContextMenu: m.setupHistoryContextMenu,
}));
vi.mock("../../src/historyTitles", () => ({
	setupHistoryTitles: m.setupHistoryTitles,
}));
vi.mock("../../src/platform/route", () => ({
	getSessionId: m.getSessionId,
	isSessionRoute: m.isSessionRoute,
}));
vi.mock("../../src/platform/storage", () => ({ storageGet: m.storageGet }));
vi.mock("../../src/rounds", () => ({
	loadHiddenRounds: m.loadHiddenRounds,
	setupHiddenRoundsSync: m.setupHiddenRoundsSync,
}));
vi.mock("../../src/app/store", () => ({
	registerDisposer: m.registerDisposer,
	disposeAll: m.disposeAll,
}));
vi.mock("../../src/app/loop", () => ({
	initRouteState: m.initRouteState,
	startDomLoop: m.startDomLoop,
	startPeriodicLoop: m.startPeriodicLoop,
}));
vi.mock("../../src/ui/keyboard", () => ({
	setupKeyboardShortcuts: m.setupKeyboardShortcuts,
}));
vi.mock("../../src/features/theme", () => ({ setupTheme: m.setupTheme }));
vi.mock("../../src/ui/render", () => ({ renderUI: m.renderUI }));
vi.mock("../../src/features/prescroll", () => ({
	startPreScroll: m.startPreScroll,
}));

/** Import the assembler fresh, so its module-level state starts clean. */
async function loadContent() {
	vi.resetModules();
	return import("../../src/content");
}

describe("content.ts assembler", () => {
	let originalPathname: string;

	beforeEach(() => {
		document.body.innerHTML = "";
		m.order.length = 0;
		m.store.sessionId = "";
		m.panel.isOpen = false;
		m.fab.position = null;
		m.getSessionId.mockReturnValue("");
		m.isSessionRoute.mockReturnValue(false);
		m.storageGet.mockResolvedValue(undefined);
		for (const fn of Object.values(m)) {
			if (typeof (fn as { mockClear?: () => void }).mockClear === "function") {
				(fn as { mockClear: () => void }).mockClear();
			}
		}
		// Silence the assembler's boot logging.
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		originalPathname = location.pathname;
	});

	afterEach(() => {
		history.pushState({}, "", originalPathname);
		vi.useRealTimers();
		// The deferred-bootstrap tests remove <body>; restore it so the next
		// test's `document.body.innerHTML = ""` has something to clear.
		if (!document.body) {
			document.documentElement.appendChild(document.createElement("body"));
		}
		vi.restoreAllMocks();
	});

	it("boots once when the body is already present", async () => {
		await loadContent();

		expect(m.initRouteState).toHaveBeenCalledTimes(1);
		expect(m.renderUI).toHaveBeenCalled();
	});

	it("opens the panel by default on a session route", async () => {
		m.isSessionRoute.mockReturnValue(true);

		await loadContent();

		expect(m.panel.isOpen).toBe(true);
	});

	it("subscribes to cross-tab hidden-round changes on a session route", async () => {
		m.getSessionId.mockReturnValue("sess-7");

		await loadContent();

		expect(m.setupHiddenRoundsSync).toHaveBeenCalledWith(
			"sess-7",
			expect.any(Function),
		);
	});

	it("does not subscribe to hidden-round changes off a session route", async () => {
		m.getSessionId.mockReturnValue("");

		await loadContent();

		expect(m.setupHiddenRoundsSync).not.toHaveBeenCalled();
	});

	it("keeps the panel closed off a session route", async () => {
		m.isSessionRoute.mockReturnValue(false);

		await loadContent();

		expect(m.panel.isOpen).toBe(false);
	});

	it("creates the host element and attaches a shadow root to it", async () => {
		await loadContent();

		const host = document.getElementById("__edge_ai_sidebar_host");
		expect(host).not.toBeNull();
		expect(document.body.contains(host)).toBe(true);
		// A closed root is not reachable from the host, but the host is in the
		// document and renderUI was handed a ShadowRoot.
		const root = m.renderUI.mock.calls[0]![0];
		expect(root).toBeInstanceOf(ShadowRoot);
	});

	it("does not boot twice when bootstrap is triggered again", async () => {
		// Three triggers race in production: the immediate call, DOMContentLoaded,
		// and the documentElement observer. A second boot would double-register
		// every listener.
		await loadContent();
		const domLoops = m.startDomLoop.mock.calls.length;

		document.dispatchEvent(new Event("DOMContentLoaded"));

		expect(m.startDomLoop).toHaveBeenCalledTimes(domLoops);
		expect(m.initRouteState).toHaveBeenCalledTimes(1);
	});

	it("hands every teardown to the disposer registry", async () => {
		await loadContent();

		// folders sync, session meta sync, context menu, title editing, keyboard,
		// dom loop, periodic loop, rsc capture.
		expect(m.registerDisposer.mock.calls.length).toBeGreaterThanOrEqual(8);
	});

	it("installs a one-shot pagehide teardown", async () => {
		const add = vi.spyOn(window, "addEventListener");
		await loadContent();

		const call = add.mock.calls.find(([t]) => t === "pagehide");
		expect(call).toBeDefined();
		expect(call![2]).toEqual({ once: true });
	});

	describe("rebuildForCurrentRoute", () => {
		/** Pull the hook the assembler passed to the DOM loop. */
		async function hooks() {
			await loadContent();
			return m.startDomLoop.mock.calls[0]![0] as {
				refreshUI: () => void;
				rebuildForCurrentRoute: () => Promise<void>;
			};
		}

		it("restores from storage before extracting from the DOM", async () => {
			// This ordering is the Phase 1 fix. Extracting first would overwrite
			// the restored history with whatever Arena had rendered so far.
			m.getSessionId.mockReturnValue("sess-1");
			const h = await hooks();
			m.order.length = 0;

			await h.rebuildForCurrentRoute();

			const load = m.order.indexOf("loadFromStorage");
			const extract = m.order.indexOf("extractMessages");
			expect(load).toBeGreaterThanOrEqual(0);
			expect(extract).toBeGreaterThan(load);
		});

		it("restores hidden-round flags before extracting from the DOM", async () => {
			// Same ordering rule as the message record: the hidden flags must be
			// in place before the first post-route render, not applied after it.
			m.getSessionId.mockReturnValue("sess-1");
			const h = await hooks();
			m.order.length = 0;

			await h.rebuildForCurrentRoute();

			const load = m.order.indexOf("loadHiddenRounds");
			const extract = m.order.indexOf("extractMessages");
			expect(m.loadHiddenRounds).toHaveBeenCalledWith("sess-1");
			expect(load).toBeGreaterThanOrEqual(0);
			expect(extract).toBeGreaterThan(load);
		});

		it("skips the hidden-round load with no session id", async () => {
			m.getSessionId.mockReturnValue("");
			const h = await hooks();

			await h.rebuildForCurrentRoute();

			expect(m.loadHiddenRounds).not.toHaveBeenCalled();
		});

		it("binds the session id onto the store", async () => {
			m.getSessionId.mockReturnValue("sess-42");
			const h = await hooks();

			await h.rebuildForCurrentRoute();

			expect(m.store.sessionId).toBe("sess-42");
			expect(m.store.loadFromStorage).toHaveBeenCalledWith("sess-42");
		});

		it("skips the storage round-trip with no session id", async () => {
			m.getSessionId.mockReturnValue("");
			const h = await hooks();

			await h.rebuildForCurrentRoute();

			expect(m.store.loadFromStorage).not.toHaveBeenCalled();
		});

		it("merges both extract sources and persists afterwards", async () => {
			const h = await hooks();
			m.order.length = 0;

			await h.rebuildForCurrentRoute();

			expect(m.order.indexOf("refreshStore")).toBeGreaterThan(
				m.order.indexOf("extractMessages"),
			);
			expect(m.order.indexOf("saveToStorage")).toBeGreaterThan(
				m.order.indexOf("refreshStore"),
			);
			expect(m.refreshStore).toHaveBeenCalledWith(
				expect.objectContaining({ bindAnchors: true }),
			);
		});

		it("feeds the bootstrap source through the same merge", async () => {
			const h = await hooks();

			await h.rebuildForCurrentRoute();

			const arg = m.refreshStore.mock.calls[0]![0] as {
				bootstrap: unknown[];
				dom: unknown[];
			};
			expect(arg.bootstrap).toEqual([]);
			expect(arg.dom).toEqual([]);
		});
	});

	describe("loadFabPosition", () => {
		it("warms the position from storage", async () => {
			m.storageGet.mockResolvedValue({ x: 30, y: 400 });

			await loadContent();
			// loadFabPosition is fire-and-forget; let its await settle.
			await Promise.resolve();
			await Promise.resolve();

			expect(m.storageGet).toHaveBeenCalledWith("fabPosition");
			expect(m.fab.position).toEqual({ x: 30, y: 400 });
		});

		it("does not overwrite a position already set", async () => {
			m.fab.position = { x: 1, y: 2 };
			m.storageGet.mockResolvedValue({ x: 30, y: 400 });

			await loadContent();
			await Promise.resolve();
			await Promise.resolve();

			expect(m.fab.position).toEqual({ x: 1, y: 2 });
		});

		it("leaves the position null when nothing is saved", async () => {
			await loadContent();
			await Promise.resolve();
			await Promise.resolve();

			expect(m.fab.position).toBeNull();
		});
	});

	describe("pre-scroll handoff", () => {
		it("rebuilds and re-renders once the pre-scroll finishes", async () => {
			await loadContent();
			const onDone = m.startPreScroll.mock.calls[0]![0] as () => void;

			onDone();
			// The real rebuild awaits several mocked async deps before the
			// chained render fires; flush the microtask queue generously.
			for (let i = 0; i < 10; i++) await Promise.resolve();

			expect(m.refreshStore).toHaveBeenCalled();
			expect(m.renderUI.mock.calls.length).toBeGreaterThan(1);
		});
	});

	it("still boots when there is no host to reuse", async () => {
		// ensureUI reuses an existing #__edge_ai_sidebar_host if one is present;
		// this is the create-it-from-scratch path.
		expect(document.getElementById("__edge_ai_sidebar_host")).toBeNull();

		await loadContent();

		expect(document.getElementById("__edge_ai_sidebar_host")).not.toBeNull();
	});

	it("reuses a host element that is already in the page", async () => {
		const existing = document.createElement("div");
		existing.id = "__edge_ai_sidebar_host";
		document.body.appendChild(existing);

		await loadContent();

		// Not duplicated.
		expect(document.querySelectorAll("#__edge_ai_sidebar_host")).toHaveLength(
			1,
		);
	});
});

describe("content.ts deferred bootstrap (no body at import time)", () => {
	// The whole point of the polling branch: DOMContentLoaded fires only on a
	// full page load, never on SPA navigation, so at document_start the body
	// may not exist yet. Three separate triggers then race to call bootstrap.
	let originalPathname: string;

	beforeEach(() => {
		m.order.length = 0;
		m.store.sessionId = "";
		m.panel.isOpen = false;
		m.fab.position = null;
		m.getSessionId.mockReturnValue("");
		m.isSessionRoute.mockReturnValue(false);
		for (const fn of Object.values(m)) {
			if (typeof (fn as { mockClear?: () => void }).mockClear === "function") {
				(fn as { mockClear: () => void }).mockClear();
			}
		}
		vi.spyOn(console, "log").mockImplementation(() => {});
		vi.spyOn(console, "error").mockImplementation(() => {});
		originalPathname = location.pathname;
	});

	afterEach(() => {
		history.pushState({}, "", originalPathname);
		vi.useRealTimers();
		if (!document.body) {
			document.documentElement.appendChild(document.createElement("body"));
		}
		vi.restoreAllMocks();
	});

	it("waits for the body instead of booting immediately", async () => {
		document.documentElement.removeChild(document.body);
		vi.useFakeTimers();

		await loadContent();

		expect(m.initRouteState).not.toHaveBeenCalled();
		expect(m.renderUI).not.toHaveBeenCalled();
	});

	it("boots once the body appears", async () => {
		document.documentElement.removeChild(document.body);
		vi.useFakeTimers();
		await loadContent();

		document.documentElement.appendChild(document.createElement("body"));
		vi.advanceTimersByTime(100);

		expect(m.initRouteState).toHaveBeenCalledTimes(1);
		expect(m.renderUI).toHaveBeenCalled();
	});

	it("boots only once when all three triggers fire", async () => {
		// This is the guard the mutation probe exposed as untested: remove
		// `if (bootstrapDone) return` and every listener is registered twice,
		// which no assertion in the immediate-boot tests could see.
		document.documentElement.removeChild(document.body);
		vi.useFakeTimers();
		await loadContent();

		document.documentElement.appendChild(document.createElement("body"));
		vi.advanceTimersByTime(100); // the polling interval
		document.dispatchEvent(new Event("DOMContentLoaded")); // the safety net
		vi.advanceTimersByTime(100); // interval again
		await Promise.resolve(); // let the documentElement observer settle

		expect(m.initRouteState).toHaveBeenCalledTimes(1);
		expect(m.startDomLoop).toHaveBeenCalledTimes(1);
		expect(m.startPeriodicLoop).toHaveBeenCalledTimes(1);
	});

	it("boots from DOMContentLoaded alone", async () => {
		document.documentElement.removeChild(document.body);
		vi.useFakeTimers();
		await loadContent();

		document.documentElement.appendChild(document.createElement("body"));
		document.dispatchEvent(new Event("DOMContentLoaded"));

		expect(m.initRouteState).toHaveBeenCalledTimes(1);
	});
});
