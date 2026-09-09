// historyTitles: custom titles are restored onto Arena's /c/ links, every link
// advertises the rename entry in its tooltip, and (#17) double-click is not a
// rename path — the right-click menu is the single entry.
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { setupHistoryTitles } from "../../src/historyTitles";
import { foldersState, INBOX_ID } from "../../src/features/sessions";
import type { SessionMeta } from "../../src/types";

function meta(overrides: Partial<SessionMeta> = {}): SessionMeta {
	return {
		sessionId: "aaa",
		title: "Arena title",
		folderId: INBOX_ID,
		createdAt: 10,
		updatedAt: 10,
		...overrides,
	};
}

function renderLink(href = "/c/aaa", text = "placeholder"): HTMLAnchorElement {
	document.body.innerHTML = `<a href="${href}"><span>${text}</span></a>`;
	return document.querySelector("a")!;
}

beforeEach(() => {
	foldersState.reset();
	document.body.innerHTML = "";
});

afterEach(() => {
	foldersState.reset();
	document.body.innerHTML = "";
});

describe("setupHistoryTitles", () => {
	it("restores the custom title onto the matching link", () => {
		foldersState.sessions.set("aaa", meta({ customTitle: "My Name" }));
		const link = renderLink();
		setupHistoryTitles();
		expect(link.querySelector("span")!.textContent).toBe("My Name");
	});

	it("leaves links without metadata alone", () => {
		const link = renderLink();
		setupHistoryTitles();
		expect(link.querySelector("span")!.textContent).toBe("placeholder");
	});

	it("advertises the right-click rename entry in the tooltip", () => {
		const link = renderLink();
		setupHistoryTitles();
		expect(link.title).toContain("Right-click to rename");
	});

	it("does not stack the hint when re-run on every DOM mutation", () => {
		const link = renderLink();
		setupHistoryTitles();
		setupHistoryTitles();
		setupHistoryTitles();
		expect(link.title.match(/Right-click to rename/g)).toHaveLength(1);
	});

	it("replaces the retired double-click hint after an upgrade", () => {
		const link = renderLink();
		link.title = "Old title | Double-click to rename";
		setupHistoryTitles();
		expect(link.title).toBe("Old title | Right-click to rename");
	});

	it("#17: double-click does not start an inline rename", () => {
		foldersState.sessions.set("aaa", meta({ customTitle: "My Name" }));
		const link = renderLink();
		setupHistoryTitles();
		link.dispatchEvent(
			new MouseEvent("dblclick", { bubbles: true, cancelable: true }),
		);
		expect(link.querySelector("input")).toBeNull();
		expect(link.querySelector("span")!.textContent).toBe("My Name");
	});

	it("skips links without a session id", () => {
		const link = renderLink("/new", "New chat");
		setupHistoryTitles();
		expect(link.title).toBe("");
		expect(link.querySelector("span")!.textContent).toBe("New chat");
	});

	it("returns a disposer that can be registered like every setup", () => {
		renderLink();
		expect(() => setupHistoryTitles()()).not.toThrow();
	});
});
