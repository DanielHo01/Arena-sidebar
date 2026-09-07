import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	addSessionToFolder,
	createFolder,
	FOLDERS_KEY,
	foldersState,
	getSessionMeta,
	getSessionsInFolder,
	initFolders,
	migrateHistoryTitles,
	setSessionCustomTitle,
	setupSessionMetaSync,
	upsertSessionMetaFromStore,
	INBOX_ID,
} from "../../src/features/sessions";
import { conversationStore } from "../../src/conversationStore";
import {
	setStorageBackend,
	type StorageBackend,
} from "../../src/platform/storage";
import type { Disposer, SessionFolder, SessionMeta } from "../../src/types";

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		sessionId: "session-1",
		title: "Original title",
		folderId: INBOX_ID,
		createdAt: 10,
		updatedAt: 10,
		...overrides,
	};
}

function folder(overrides: Partial<SessionFolder> = {}): SessionFolder {
	return {
		id: "folder-1",
		name: "Work",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

function memoryBackend(initial: Record<string, unknown> = {}) {
	const data = new Map<string, unknown>(Object.entries(initial));
	const calls = {
		set: [] as Array<Record<string, unknown>>,
		remove: [] as string[][],
	};
	const state = { failRemove: false };
	const backend: StorageBackend = {
		get: async (keys) => {
			if (keys === null) return Object.fromEntries(data);
			const list = Array.isArray(keys) ? keys : [keys];
			const result: Record<string, unknown> = {};
			for (const key of list) {
				if (data.has(key)) result[key] = data.get(key);
			}
			return result;
		},
		set: async (items) => {
			calls.set.push(items);
			for (const [key, value] of Object.entries(items)) data.set(key, value);
		},
		remove: async (keys) => {
			const list = Array.isArray(keys) ? keys : [keys];
			calls.remove.push(list);
			if (state.failRemove) throw new Error("remove failed");
			for (const key of list) data.delete(key);
		},
	};
	return { backend, calls, data, state };
}

let storage: ReturnType<typeof memoryBackend>;
const disposers: Disposer[] = [];

function track(disposer: Disposer): void {
	disposers.push(disposer);
}

beforeEach(() => {
	foldersState.reset();
	conversationStore.reset();
	conversationStore.sessionId = "";
	storage = memoryBackend();
	setStorageBackend(storage.backend);
	document.title = "";
});

afterEach(() => {
	while (disposers.length > 0) disposers.pop()!();
	setStorageBackend(null);
	foldersState.reset();
	conversationStore.reset();
	vi.restoreAllMocks();
});

describe("foldersState and session CRUD", () => {
	it("reset restores the default folders and clears session state", () => {
		foldersState.folders.push(folder());
		foldersState.sessions.set("old", meta({ sessionId: "old" }));
		foldersState.activeFolderId = "folder-1";
		foldersState.visible = true;

		foldersState.reset();

		expect(foldersState.folders.map((item) => item.id)).toEqual([
			"inbox",
			"archive",
		]);
		expect(foldersState.sessions.size).toBe(0);
		expect(foldersState.activeFolderId).toBe(INBOX_ID);
		expect(foldersState.visible).toBe(false);
	});

	it("adds a new session with defaults and persists the index", () => {
		vi.spyOn(Date, "now").mockReturnValue(100);

		addSessionToFolder("s1", "", "folder-1");

		const saved = foldersState.sessions.get("s1");
		expect(saved).toMatchObject({
			sessionId: "s1",
			title: "Untitled",
			folderId: "folder-1",
			createdAt: 100,
			updatedAt: 100,
		});
		expect(storage.data.get(FOLDERS_KEY)).toEqual({
			folders: foldersState.folders,
			sessions: [["s1", saved]],
		});
	});

	it("updates an existing session without losing its custom title or creation time", () => {
		foldersState.sessions.set(
			"s1",
			meta({
				sessionId: "s1",
				customTitle: "Pinned name",
				createdAt: 10,
			}),
		);
		vi.spyOn(Date, "now").mockReturnValue(200);

		addSessionToFolder("s1", "Latest title", "archive");

		expect(foldersState.sessions.get("s1")).toMatchObject({
			title: "Latest title",
			customTitle: "Pinned name",
			folderId: "archive",
			createdAt: 10,
			updatedAt: 200,
		});
	});

	it("rejects blank folder names and truncates long valid names", () => {
		expect(createFolder("   ")).toBeNull();
		expect(foldersState.folders).toHaveLength(2);

		vi.spyOn(Date, "now").mockReturnValue(300);
		vi.spyOn(Math, "random").mockReturnValue(0.5);
		const created = createFolder(
			"  A folder name that is intentionally longer than forty characters  ",
		);

		expect(created).not.toBeNull();
		expect(created!.id).toMatch(/^folder-300-/);
		expect(created!.name).toHaveLength(40);
		expect(created!.createdAt).toBe(300);
		expect(foldersState.folders).toContainEqual(created);
		expect(storage.calls.set).toHaveLength(1);
	});

	it("keeps a short folder name trimmed", () => {
		vi.spyOn(Date, "now").mockReturnValue(301);
		const created = createFolder("  Short  ");

		expect(created?.name).toBe("Short");
	});

	it("filters sessions by folder and reads one metadata entry", () => {
		foldersState.sessions.set("a", meta({ sessionId: "a", folderId: "work" }));
		foldersState.sessions.set(
			"b",
			meta({ sessionId: "b", folderId: INBOX_ID }),
		);

		expect(getSessionsInFolder("work").map((item) => item.sessionId)).toEqual([
			"a",
		]);
		expect(getSessionMeta("a")?.sessionId).toBe("a");
		expect(getSessionMeta("missing")).toBeUndefined();
	});
});

describe("title writes and loading", () => {
	it("sets and trims a custom title while preserving existing metadata", () => {
		foldersState.sessions.set(
			"s1",
			meta({
				sessionId: "s1",
				customTitle: "Old custom",
				folderId: "work",
				roundCount: 3,
				messageCount: 8,
				createdAt: 11,
				url: "https://arena.ai/c/s1",
			}),
		);
		vi.spyOn(Date, "now").mockReturnValue(400);

		setSessionCustomTitle("s1", "  New custom  ");

		expect(foldersState.sessions.get("s1")).toEqual({
			sessionId: "s1",
			title: "Original title",
			customTitle: "New custom",
			folderId: "work",
			roundCount: 3,
			messageCount: 8,
			createdAt: 11,
			updatedAt: 400,
			url: "https://arena.ai/c/s1",
		});
	});

	it("turns an empty custom title into undefined and supplies new-session defaults", () => {
		vi.spyOn(Date, "now").mockReturnValue(401);

		setSessionCustomTitle("new", "   ");

		expect(foldersState.sessions.get("new")).toEqual({
			sessionId: "new",
			title: "未命名会话",
			customTitle: undefined,
			folderId: INBOX_ID,
			roundCount: undefined,
			messageCount: undefined,
			createdAt: 401,
			updatedAt: 401,
			url: undefined,
		});
	});

	it("loads persisted folders and sessions", async () => {
		const savedFolder = folder({ id: "saved", name: "Saved" });
		const savedMeta = meta({ sessionId: "saved-session", folderId: "saved" });
		storage.data.set(FOLDERS_KEY, {
			folders: [savedFolder],
			sessions: [["saved-session", savedMeta]],
		});

		await initFolders();

		expect(foldersState.folders).toEqual([savedFolder]);
		expect(foldersState.sessions.get("saved-session")).toEqual(savedMeta);
	});

	it("keeps defaults when persisted collections are empty", async () => {
		storage.data.set(FOLDERS_KEY, { folders: [], sessions: [] });

		await initFolders();

		expect(foldersState.folders.map((item) => item.id)).toEqual([
			"inbox",
			"archive",
		]);
		expect(foldersState.sessions.size).toBe(0);
	});

	it("upserts store metadata and preserves session-owned fields", () => {
		foldersState.sessions.set(
			"s1",
			meta({
				sessionId: "s1",
				customTitle: "User name",
				folderId: "work",
				createdAt: 12,
			}),
		);
		vi.spyOn(Date, "now").mockReturnValue(500);

		upsertSessionMetaFromStore("s1", "", 4, 9, "https://arena.ai/c/s1");

		expect(foldersState.sessions.get("s1")).toMatchObject({
			title: "未命名会话",
			customTitle: "User name",
			folderId: "work",
			roundCount: 4,
			messageCount: 9,
			createdAt: 12,
			updatedAt: 500,
			url: "https://arena.ai/c/s1",
		});
	});
});

describe("conversation store subscription", () => {
	function seedStore(title = "Round title") {
		conversationStore.sessionId = "session-1";
		conversationStore.messages = [
			{ id: "m1", role: "user", content: "Question" },
		];
		conversationStore.rounds = [
			{
				id: "m1",
				title,
				messageCount: 1,
				index: 0,
				hasAnchor: false,
			},
		];
	}

	it("derives a cleaned page title on a successful store save", async () => {
		track(setupSessionMetaSync());
		document.title = "Arena question - Arena";
		seedStore();

		await conversationStore.saveToStorage();

		expect(foldersState.sessions.get("session-1")).toMatchObject({
			title: "Arena question",
			roundCount: 1,
			messageCount: 1,
			url: location.href,
		});
	});

	it("falls back from a one-character page title to the round title", async () => {
		track(setupSessionMetaSync());
		document.title = "A";
		seedStore("First round");

		await conversationStore.saveToStorage();

		expect(foldersState.sessions.get("session-1")?.title).toBe("First round");
	});

	it("falls back to the unnamed title when both page and round titles are empty", async () => {
		track(setupSessionMetaSync());
		document.title = "";
		seedStore("");

		await conversationStore.saveToStorage();

		expect(foldersState.sessions.get("session-1")?.title).toBe("未命名会话");
	});

	it("stops syncing after its disposer runs", async () => {
		const dispose = setupSessionMetaSync();
		document.title = "First";
		seedStore("Round");
		await conversationStore.saveToStorage();
		dispose();

		document.title = "Second";
		conversationStore.rounds[0]!.title = "Other round";
		await conversationStore.saveToStorage();

		expect(foldersState.sessions.get("session-1")?.title).toBe("First");
	});
});

describe("legacy history title migration", () => {
	it("does nothing when storage is unavailable", async () => {
		setStorageBackend(null);

		await expect(migrateHistoryTitles()).resolves.toBeUndefined();
		expect(foldersState.sessions.size).toBe(0);
	});

	it("migrates valid titles and leaves invalid or unrelated keys alone", async () => {
		storage.data.set("historyTitle_alpha", "  Alpha custom  ");
		storage.data.set("historyTitle_blank", "   ");
		storage.data.set("historyTitle_number", 123);
		storage.data.set("other-key", "untouched");

		await migrateHistoryTitles();

		expect(foldersState.sessions.get("alpha")?.customTitle).toBe(
			"Alpha custom",
		);
		expect(storage.data.has("historyTitle_alpha")).toBe(false);
		expect(storage.data.has("historyTitle_blank")).toBe(true);
		expect(storage.data.has("historyTitle_number")).toBe(true);
		expect(storage.data.has("other-key")).toBe(true);
		expect(storage.calls.remove).toEqual([["historyTitle_alpha"]]);
	});

	it("does not remove anything when no valid legacy title exists", async () => {
		storage.data.set("historyTitle_blank", " ");
		storage.data.set("historyTitle_number", 1);

		await migrateHistoryTitles();

		expect(storage.calls.remove).toHaveLength(0);
	});

	it("keeps migrated titles but warns when legacy key removal fails", async () => {
		storage.data.set("historyTitle_alpha", "Alpha");
		storage.state.failRemove = true;
		const warn = vi.spyOn(console, "warn").mockImplementation(() => {});

		await migrateHistoryTitles();

		expect(foldersState.sessions.get("alpha")?.customTitle).toBe("Alpha");
		expect(storage.data.has("historyTitle_alpha")).toBe(true);
		expect(warn).toHaveBeenCalledWith(
			"[AI Sidebar] migrateHistoryTitles: failed to remove old keys",
		);
	});
});
