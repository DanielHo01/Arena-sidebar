import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { foldersState } from "../../src/features/sessions";
import {
	setStorageBackend,
	type StorageBackend,
} from "../../src/platform/storage";
import { setupHistoryContextMenu } from "../../src/ui/contextMenu";
import type { Disposer, SessionMeta } from "../../src/types";

const backend: StorageBackend = {
	get: async () => ({}),
	set: async () => {},
	remove: async () => {},
};

let rafCallbacks: FrameRequestCallback[];
const disposers: Disposer[] = [];

function addLink(
	sessionId = "abc123",
	title = "Chat A",
	withSpan = false,
): HTMLAnchorElement {
	const link = document.createElement("a");
	link.href = "/c/" + sessionId;
	if (withSpan) {
		const span = document.createElement("span");
		span.textContent = title;
		link.appendChild(span);
	} else {
		link.textContent = title;
	}
	document.body.appendChild(link);
	return link;
}

function install(): Disposer {
	const disposer = setupHistoryContextMenu();
	if (!disposers.includes(disposer)) disposers.push(disposer);
	return disposer;
}

function openMenu(link: HTMLAnchorElement): HTMLElement {
	const event = new MouseEvent("contextmenu", {
		bubbles: true,
		cancelable: true,
		clientX: 37,
		clientY: 49,
	});
	link.dispatchEvent(event);
	expect(event.defaultPrevented).toBe(true);
	return document.querySelector<HTMLElement>(".ai-sidebar-ctx")!;
}

function flushAnimationFrames(): void {
	const pending = rafCallbacks.splice(0);
	for (const callback of pending) callback(0);
}

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		sessionId: "abc123",
		title: "Original title",
		folderId: "inbox",
		createdAt: 1,
		updatedAt: 1,
		...overrides,
	};
}

beforeEach(() => {
	document.body.innerHTML = "";
	document.head.innerHTML = "";
	foldersState.reset();
	setStorageBackend(backend);
	rafCallbacks = [];
	vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
		rafCallbacks.push(callback);
		return rafCallbacks.length;
	});
});

afterEach(() => {
	while (disposers.length > 0) disposers.pop()!();
	setStorageBackend(null);
	vi.unstubAllGlobals();
	foldersState.reset();
	document.body.innerHTML = "";
	document.head.innerHTML = "";
	rafCallbacks = [];
});

describe("opening and closing the context menu", () => {
	it("opens at the pointer position and renders rename and move actions", () => {
		const link = addLink();
		install();

		const menu = openMenu(link);

		expect(menu.style.left).toBe("37px");
		expect(menu.style.top).toBe("49px");
		expect(menu.querySelectorAll(".ai-sidebar-ctx-item")).toHaveLength(2);
		expect(menu.querySelector(".ai-sidebar-ctx-sep")).not.toBeNull();
	});

	it("clamps a menu that overflows both viewport edges", () => {
		const link = addLink();
		install();
		const menu = openMenu(link);
		Object.defineProperty(menu, "getBoundingClientRect", {
			configurable: true,
			value: () =>
				({
					right: window.innerWidth + 1,
					bottom: window.innerHeight + 1,
					width: 100,
					height: 80,
				}) as DOMRect,
		});

		flushAnimationFrames();

		expect(menu.style.left).toBe(window.innerWidth - 108 + "px");
		expect(menu.style.top).toBe(window.innerHeight - 88 + "px");
	});

	it("keeps a click inside the menu from closing it", () => {
		const link = addLink();
		install();
		const menu = openMenu(link);

		menu.dispatchEvent(new MouseEvent("click", { bubbles: true }));

		expect(document.querySelector(".ai-sidebar-ctx")).toBe(menu);
	});

	it("closes on an outside click and on Escape", () => {
		const link = addLink();
		install();
		openMenu(link);
		document.body.dispatchEvent(new MouseEvent("click", { bubbles: true }));
		expect(document.querySelector(".ai-sidebar-ctx")).toBeNull();

		openMenu(link);
		document.dispatchEvent(
			new KeyboardEvent("keydown", { key: "Escape", bubbles: true }),
		);
		expect(document.querySelector(".ai-sidebar-ctx")).toBeNull();
	});

	it("replaces an existing menu when another history link is opened", () => {
		const first = addLink("first", "First");
		const second = addLink("second", "Second");
		install();
		openMenu(first);
		openMenu(second);

		expect(document.querySelectorAll(".ai-sidebar-ctx")).toHaveLength(1);
	});
});

describe("rename action", () => {
	it("starts inline rename with the resolved custom title and persists the commit", () => {
		const link = addLink("abc123", "Visible title", true);
		foldersState.sessions.set(
			"abc123",
			meta({ customTitle: "Existing custom" }),
		);
		install();
		const menu = openMenu(link);

		menu.querySelectorAll<HTMLElement>(".ai-sidebar-ctx-item")[0]!.click();
		const input = link.querySelector<HTMLInputElement>("input")!;
		expect(input.value).toBe("Existing custom");

		input.value = "  Renamed session  ";
		input.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" }));

		expect(foldersState.sessions.get("abc123")?.customTitle).toBe(
			"Renamed session",
		);
		expect(link.title).toBe("Renamed session");
		expect(link.querySelector("span")?.textContent).toBe("Renamed session");
		expect(document.querySelector(".ai-sidebar-ctx")).toBeNull();
	});

	it("uses the session id as the initial title when metadata is absent", () => {
		const link = addLink("missing-meta", "Visible title");
		install();
		const menu = openMenu(link);

		menu.querySelectorAll<HTMLElement>(".ai-sidebar-ctx-item")[0]!.click();

		expect(link.querySelector<HTMLInputElement>("input")?.value).toBe(
			"missing-",
		);
	});
});

describe("move-to-folder action", () => {
	it("fills folders, marks the active folder, and moves the session", () => {
		const link = addLink();
		foldersState.folders.push({
			id: "work",
			name: "Work",
			createdAt: 2,
			updatedAt: 2,
		});
		foldersState.sessions.set("abc123", meta());
		install();
		const menu = openMenu(link);
		const move = menu.querySelectorAll<HTMLElement>(".ai-sidebar-ctx-item")[1]!;

		move.click();
		const folders = menu.querySelectorAll<HTMLElement>(
			".ai-sidebar-ctx-sub-item",
		);
		expect(folders).toHaveLength(3);
		expect(folders[0]!.classList.contains("active")).toBe(true);
		expect(folders[0]!.textContent).toContain("Inbox");
		expect(folders[2]!.classList.contains("active")).toBe(false);

		folders[2]!.click();

		expect(foldersState.sessions.get("abc123")?.folderId).toBe("work");
		expect(document.querySelector(".ai-sidebar-ctx")).toBeNull();
	});

	it("toggles the folder submenu closed on a second click", () => {
		const link = addLink();
		install();
		const menu = openMenu(link);
		const move = menu.querySelectorAll<HTMLElement>(".ai-sidebar-ctx-item")[1]!;
		const sub = move.querySelector<HTMLElement>(".ai-sidebar-ctx-sub")!;

		move.click();
		expect(sub.style.display).toBe("block");
		move.click();
		expect(sub.style.display).toBe("none");
	});

	it("creates metadata with Untitled when moving an unknown session", () => {
		const link = addLink("new-session", "Native title");
		foldersState.folders.push({
			id: "work",
			name: "Work",
			createdAt: 2,
			updatedAt: 2,
		});
		install();
		const menu = openMenu(link);
		const move = menu.querySelectorAll<HTMLElement>(".ai-sidebar-ctx-item")[1]!;
		move.click();
		menu.querySelectorAll<HTMLElement>(".ai-sidebar-ctx-sub-item")[2]!.click();

		expect(foldersState.sessions.get("new-session")).toMatchObject({
			title: "Untitled",
			folderId: "work",
		});
	});
});

describe("dynamic history links", () => {
	it("binds a link added after setup while leaving the original bound once", async () => {
		const first = addLink("first", "First");
		install();
		expect(first.dataset.aiSidebarCtxBound).toBe("1");

		const second = addLink("second", "Second");
		await new Promise<void>((resolve) => setTimeout(resolve, 0));

		expect(first.dataset.aiSidebarCtxBound).toBe("1");
		expect(second.dataset.aiSidebarCtxBound).toBe("1");
	});
});
