import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { buildSidebar, quickNavOf } from "../__fixtures__/arenaDom";
import {
	ensureArenaFolderEntry,
	resetLibrarySection,
	setupFoldersStorageSync,
	toggleArenaSessionLibrarySection,
} from "../../src/ui/arenaSidebar";
import {
	createFolder,
	foldersState,
	INBOX_ID,
	SESSION_META_PREFIX,
} from "../../src/features/sessions";
import type { SessionMeta } from "../../src/types";

type StorageChange = { newValue?: unknown };

type StorageListener = (
	changes: Record<string, StorageChange>,
	areaName: string,
) => void;

let storageListeners: StorageListener[];
const disposers: Array<() => void> = [];

function session(
	sessionId: string,
	overrides: Partial<SessionMeta> = {},
): SessionMeta {
	return {
		sessionId,
		title: "Title " + sessionId,
		folderId: INBOX_ID,
		createdAt: 1,
		updatedAt: 0,
		...overrides,
	};
}

function installChromeStorage(): void {
	storageListeners = [];
	vi.stubGlobal("chrome", {
		storage: {
			local: {
				get: async () => ({}),
				set: async () => {},
				remove: async () => {},
			},
			onChanged: {
				addListener: (listener: StorageListener) => {
					storageListeners.push(listener);
				},
				removeListener: (listener: StorageListener) => {
					storageListeners = storageListeners.filter(
						(item) => item !== listener,
					);
				},
			},
		},
	});
}

function emitStorageChange(
	changes: Record<string, StorageChange>,
	areaName = "local",
): void {
	for (const listener of storageListeners) {
		listener(changes, areaName);
	}
}

/** Emit a change to one per-session meta key. */
function emitSessionMetaChange(
	sessionId: string,
	newValue: SessionMeta | undefined,
): void {
	emitStorageChange({ [SESSION_META_PREFIX + sessionId]: { newValue } });
}

function track(disposer: () => void): void {
	disposers.push(disposer);
}

function libraryEntry(root: HTMLElement): HTMLElement {
	return root.querySelector<HTMLElement>("[data-ai-sidebar-folder-entry]")!;
}

function librarySection(root: HTMLElement): HTMLElement {
	return root.querySelector<HTMLElement>(
		"[data-ai-sidebar-arena-library-section]",
	)!;
}

function openLibrary(): { wrapper: HTMLElement; quickNav: HTMLElement } {
	const wrapper = buildSidebar();
	const quickNav = quickNavOf(wrapper);
	ensureArenaFolderEntry(() => toggleArenaSessionLibrarySection());
	toggleArenaSessionLibrarySection();
	return { wrapper, quickNav };
}

beforeEach(() => {
	document.body.innerHTML = "";
	document.head.innerHTML = "";
	foldersState.reset();
	resetLibrarySection();
	installChromeStorage();
});

afterEach(() => {
	while (disposers.length > 0) disposers.pop()!();
	vi.unstubAllGlobals();
	foldersState.reset();
	resetLibrarySection();
	document.body.innerHTML = "";
	document.head.innerHTML = "";
});

describe("ensureArenaFolderEntry", () => {
	it("gracefully does nothing before Arena's sidebar exists", () => {
		const onToggle = vi.fn();

		ensureArenaFolderEntry(onToggle);

		expect(document.querySelector("[data-ai-sidebar-folder-entry]")).toBeNull();
		expect(onToggle).not.toHaveBeenCalled();
	});

	it("inserts the entry before existing quick-nav content and adds a section", () => {
		const wrapper = buildSidebar();
		const quickNav = quickNavOf(wrapper);
		const existing = document.createElement("span");
		quickNav.appendChild(existing);
		const onToggle = vi.fn();

		ensureArenaFolderEntry(onToggle);

		const entry = libraryEntry(wrapper);
		expect(quickNav.firstElementChild).toBe(entry);
		expect(entry.textContent).toContain("Session Library");
		expect(entry.querySelector("span")?.textContent).toBe("🗂");
		expect(librarySection(wrapper).className).toBe(
			"aria-session-library-section",
		);
		expect(quickNav.contains(existing)).toBe(true);
		expect(quickNav.lastElementChild).toBe(librarySection(wrapper));

		const event = new MouseEvent("click", {
			bubbles: true,
			cancelable: true,
		});
		entry.dispatchEvent(event);
		expect(event.defaultPrevented).toBe(true);
		expect(onToggle).toHaveBeenCalledTimes(1);
	});

	it("appends the entry when quick-nav is empty and remains idempotent", () => {
		const wrapper = buildSidebar();
		const quickNav = quickNavOf(wrapper);

		ensureArenaFolderEntry(() => {});
		ensureArenaFolderEntry(() => {});

		expect(
			quickNav.querySelectorAll("[data-ai-sidebar-folder-entry]"),
		).toHaveLength(1);
		expect(
			quickNav.querySelectorAll("[data-ai-sidebar-arena-library-section]"),
		).toHaveLength(1);
	});
});

describe("Session Library toggle and rendering", () => {
	it("opens the section, marks the entry active, and shows the empty state", () => {
		const { wrapper } = openLibrary();
		const entry = libraryEntry(wrapper);
		const section = librarySection(wrapper);

		expect(section.style.display).toBe("block");
		expect(entry.getAttribute("data-ai-sidebar-lib-open")).toBe("1");
		expect(entry.classList.contains("bg-sidebar-accent/20")).toBe(true);
		expect(section.textContent).toContain("No sessions in this folder");
		expect(section.querySelector("input")?.placeholder).toBe("+ New folder…");
	});

	it("closes the section and removes the active entry state", () => {
		const { wrapper } = openLibrary();
		const entry = libraryEntry(wrapper);
		const section = librarySection(wrapper);

		toggleArenaSessionLibrarySection();

		expect(section.style.display).toBe("none");
		expect(entry.hasAttribute("data-ai-sidebar-lib-open")).toBe(false);
		expect(entry.classList.contains("bg-sidebar-accent/20")).toBe(false);
	});

	it("returns without throwing when the section is absent", () => {
		buildSidebar();
		ensureArenaFolderEntry(() => {});
		const section = document.querySelector(
			"[data-ai-sidebar-arena-library-section]",
		)!;
		section.remove();

		expect(() => toggleArenaSessionLibrarySection()).not.toThrow();
	});

	it("renders folder counts and session titles in the active folder", () => {
		foldersState.sessions.set("s1", session("s1", { updatedAt: 0 }));
		foldersState.sessions.set(
			"s2",
			session("s2", { customTitle: "Renamed", updatedAt: 1700000000000 }),
		);
		const { wrapper } = openLibrary();
		const section = librarySection(wrapper);
		const folderRows =
			section.querySelectorAll<HTMLElement>(".asl-folder-item");
		const sessionRows =
			section.querySelectorAll<HTMLAnchorElement>(".asl-session-item");

		expect(folderRows[0]?.textContent).toContain("Inbox");
		expect(folderRows[0]?.textContent).toContain("2");
		expect(sessionRows).toHaveLength(2);
		expect(sessionRows[1]?.querySelector("span")?.textContent).toBe("Renamed");
		expect(sessionRows[0]?.href).toContain("/c/s1");
	});

	it("switches the active folder and re-renders its sessions", () => {
		const created = createFolder("Work");
		expect(created).not.toBeNull();
		foldersState.sessions.set(
			"work-session",
			session("work-session", { folderId: created!.id }),
		);
		const { wrapper } = openLibrary();
		const section = librarySection(wrapper);
		const workRow = Array.from(
			section.querySelectorAll<HTMLElement>(".asl-folder-item"),
		).find((row) => row.textContent?.includes("Work"))!;

		workRow.click();

		expect(foldersState.activeFolderId).toBe(created!.id);
		expect(
			section.querySelector(".asl-folder-item.active")?.textContent,
		).toContain("Work");
		expect(section.querySelector(".asl-session-item")?.textContent).toContain(
			"work-session",
		);
	});

	it("creates a folder only for a non-empty Enter submission", () => {
		const { wrapper } = openLibrary();
		const section = librarySection(wrapper);
		const input = section.querySelector<HTMLInputElement>("input")!;
		const initialCount = foldersState.folders.length;

		input.value = "   ";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));
		expect(foldersState.folders).toHaveLength(initialCount);

		input.value = "ignored";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Tab" }));
		expect(foldersState.folders).toHaveLength(initialCount);

		input.value = "  New Work  ";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

		expect(foldersState.folders).toHaveLength(initialCount + 1);
		expect(foldersState.folders.at(-1)?.name).toBe("New Work");
		expect(section.querySelector("input")?.value).toBe("");
	});

	it("sets and clears the session hover background", () => {
		foldersState.sessions.set("s1", session("s1"));
		const { wrapper } = openLibrary();
		const item =
			librarySection(wrapper).querySelector<HTMLElement>(".asl-session-item")!;

		item.dispatchEvent(new MouseEvent("mouseenter"));
		expect(item.style.background).toBe("rgba(255, 255, 255, 0.05)");
		item.dispatchEvent(new MouseEvent("mouseleave"));
		expect(item.style.background).toBe("");
	});
});

describe("folders storage sync", () => {
	it("applies a folder-list change and a per-session meta change, then re-renders", () => {
		foldersState.sessions.set("local-session", session("local-session"));
		const { wrapper } = openLibrary();
		const section = librarySection(wrapper);
		expect(section.textContent).toContain("local-session");
		track(setupFoldersStorageSync());
		const nextFolder = {
			id: "remote",
			name: "Remote",
			createdAt: 2,
			updatedAt: 2,
		};
		const nextSession = session("remote-session", {
			folderId: "remote",
			customTitle: "Remote title",
		});

		emitStorageChange({
			"edge-ai-sidebar:folders": { newValue: [nextFolder] },
			[SESSION_META_PREFIX + "remote-session"]: { newValue: nextSession },
		});

		expect(foldersState.folders).toEqual([nextFolder]);
		expect(foldersState.sessions.get("remote-session")).toEqual(nextSession);
		// Unlike the old whole-index replace, a session not named in the change
		// survives — the active folder still shows the local session.
		expect(foldersState.sessions.get("local-session")).toEqual(
			session("local-session"),
		);
		expect(section.textContent).toContain("local-session");
	});

	it("a remote rename applies only the changed session, keeping others intact", () => {
		// The per-session guarantee: a change to one session's key must not
		// rebuild the whole index, so an unrelated session stays as-is.
		const localSession = session("local");
		foldersState.sessions.set("local", localSession);
		track(setupFoldersStorageSync());

		emitSessionMetaChange("aaa", session("aaa", { customTitle: "New title" }));

		expect(foldersState.sessions.get("aaa")?.customTitle).toBe("New title");
		expect(foldersState.sessions.get("local")).toEqual(localSession);
	});

	it("deletes a session from memory when its key is removed remotely", () => {
		foldersState.sessions.set("aaa", session("aaa"));
		track(setupFoldersStorageSync());

		emitSessionMetaChange("aaa", undefined);

		expect(foldersState.sessions.has("aaa")).toBe(false);
	});

	it("keeps existing folders when the folders change has no value", () => {
		const existingFolder = foldersState.folders[0]!;
		track(setupFoldersStorageSync());

		emitStorageChange({ "edge-ai-sidebar:folders": { newValue: undefined } });

		expect(foldersState.folders).toEqual([
			existingFolder,
			foldersState.folders[1],
		]);
	});

	it("does not re-render a closed section and disposer unregisters both listeners", () => {
		track(setupFoldersStorageSync());
		expect(storageListeners).toHaveLength(2);

		const original = document.body.innerHTML;
		emitStorageChange({
			"edge-ai-sidebar:folders": {
				newValue: [
					{
						id: "replacement",
						name: "Replacement",
						createdAt: 3,
						updatedAt: 3,
					},
				],
			},
		});
		expect(document.body.innerHTML).toBe(original);

		disposers.pop()!();
		expect(storageListeners).toHaveLength(0);
	});

	it("repaints history-link titles on a remote rename (#11)", () => {
		// The full cross-tab rename loop: tab A writes the session-meta key,
		// tab B's memory reloads — and B's visible history links must follow
		// without waiting for the next DOM mutation on an idle page.
		document.body.insertAdjacentHTML(
			"beforeend",
			'<a href="/c/aaa"><span>Old title</span></a>',
		);
		track(setupFoldersStorageSync());

		emitSessionMetaChange(
			"aaa",
			session("aaa", { title: "Arena title", customTitle: "New title" }),
		);

		const link = document.body.querySelector('a[href="/c/aaa"]')!;
		expect(link.querySelector("span")!.textContent).toBe("New title");
	});
});
