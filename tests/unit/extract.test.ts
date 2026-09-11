// Real-source tests for DOM extraction.
//
// This is the module scripts/test-content-extract.cjs claims to cover, but that
// mirror suite tests `data-message-author-role` / `data-role` selectors which
// production does not use at all. Production uses the two class-substring
// selectors below, so until now extract.ts had 2.34% coverage and its real
// behaviour was unverified.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	ASSISTANT_MESSAGE_SELECTOR,
	USER_MESSAGE_SELECTOR,
	extractMessages,
	extractText,
	generateStableId,
	getLastExtractStats,
	resetExtractState,
} from "../../src/extract";
import { cachedElements } from "../../src/state";

// jsdom reports every box as 0x0. extract.ts rejects elements narrower than
// 200px, so without this stub every message would be filtered out and the
// module would look "working" while testing nothing. (Worth noting as a design
// smell: the width gate couples pure extraction to layout.)
const BOX = {
	width: 600,
	height: 120,
	top: 0,
	left: 0,
	right: 600,
	bottom: 120,
	x: 0,
	y: 0,
	toJSON: () => ({}),
} as DOMRect;

function user(text: string, extraClass = ""): string {
	return `<div class="bg-surface-raised rounded-lg ${extraClass}"><p>${text}</p></div>`;
}
function assistant(text: string): string {
	return `<div class="bg-surface-primary flex-col overflow-hidden"><p>${text}</p></div>`;
}
const LONG =
	"This is a sufficiently long assistant reply that clears the 50 character minimum length filter.";

beforeEach(() => {
	resetExtractState();
	cachedElements.clear();
	document.body.innerHTML = "";
	vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue(BOX);
	vi.spyOn(console, "log").mockImplementation(() => {});
	vi.spyOn(console, "warn").mockImplementation(() => {});
});

afterEach(() => {
	vi.restoreAllMocks();
});

describe("selectors", () => {
	it("are the two class-substring selectors production actually uses", () => {
		expect(USER_MESSAGE_SELECTOR).toContain("bg-surface-raised");
		expect(ASSISTANT_MESSAGE_SELECTOR).toContain("bg-surface-primary");
	});
});

describe("extractMessages", () => {
	it("extracts user and assistant messages in document order", () => {
		document.body.innerHTML = `<main>
			${user("What is a transformer?")}
			${assistant(LONG)}
			${user("And attention?")}
			${assistant(LONG + " second")}
		</main>`;
		const msgs = extractMessages();
		expect(msgs.map((m) => m.role)).toEqual([
			"user",
			"assistant",
			"user",
			"assistant",
		]);
		expect(msgs[0].content).toContain("What is a transformer?");
		expect(msgs.every((m) => m.origin === "dom")).toBe(true);
	});

	it("ignores elements outside <main>", () => {
		document.body.innerHTML = `${user("outside main")}`;
		expect(extractMessages()).toHaveLength(0);
	});

	it("skips aria-hidden subtrees", () => {
		document.body.innerHTML = `<main>
			${user("real question here")}
			<div aria-hidden="true">${user("hidden ui chrome")}</div>
		</main>`;
		const msgs = extractMessages();
		expect(msgs).toHaveLength(1);
		expect(msgs[0].content).toContain("real question here");
	});

	it("excludes w-4 and inline-flex lookalikes from the user selector", () => {
		document.body.innerHTML = `<main>
			${user("real question here")}
			${user("avatar badge", "w-4")}
			${user("icon button", "inline-flex")}
		</main>`;
		expect(extractMessages()).toHaveLength(1);
	});

	it("rejects assistant text below the 50-char minimum", () => {
		document.body.innerHTML = `<main>${assistant("too short")}</main>`;
		expect(extractMessages()).toHaveLength(0);
	});

	it("rejects user text below the 3-char minimum", () => {
		document.body.innerHTML = `<main>${user("hi")}</main>`;
		expect(extractMessages()).toHaveLength(0);
	});

	it("tags elements with data-ai-sidebar-id and caches them", () => {
		document.body.innerHTML = `<main>${user("a real question")}</main>`;
		const msgs = extractMessages();
		expect(msgs[0].id).toBeTruthy();
		expect(cachedElements.get(msgs[0].id)).toBeDefined();
		const el = cachedElements.get(msgs[0].id)!;
		expect(el.getAttribute("data-ai-sidebar-id")).toBe(msgs[0].id);
	});

	// ── The double-meaning contract (documented, not endorsed) ────────────
	it("returns [] when the DOM has not changed since the last call", () => {
		document.body.innerHTML = `<main>${user("a real question")}${assistant(LONG)}</main>`;
		expect(extractMessages()).toHaveLength(2);
		// Same DOM -> the signature matches -> [] rather than the 2 messages.
		// Callers rely on this to mean "nothing new", but it is indistinguishable
		// from "there are no messages". Flagged in the plan as P5.
		expect(extractMessages()).toHaveLength(0);
	});

	it("re-extracts after resetExtractState", () => {
		document.body.innerHTML = `<main>${user("a real question")}</main>`;
		expect(extractMessages()).toHaveLength(1);
		resetExtractState();
		expect(extractMessages()).toHaveLength(1);
	});

	it("detects a change in text even when the element count is the same", () => {
		document.body.innerHTML = `<main>${user("first question here")}</main>`;
		expect(extractMessages()).toHaveLength(1);
		document.body.innerHTML = `<main>${user("second question here")}</main>`;
		expect(extractMessages()).toHaveLength(1);
	});

	it("keeps a user bubble wider than 1000px (#28)", () => {
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
			...BOX,
			width: 1400,
			right: 1400,
		} as DOMRect);
		document.body.innerHTML = `<main>${user("a real question")}</main>`;
		expect(extractMessages()).toHaveLength(1);
		expect(getLastExtractStats().kept).toBe(1);
		expect(getLastExtractStats().dropped.tooNarrow).toBe(0);
	});

	it("records filter reasons when selector hits are dropped", () => {
		vi.spyOn(Element.prototype, "getBoundingClientRect").mockReturnValue({
			...BOX,
			width: 50,
			right: 50,
		} as DOMRect);
		document.body.innerHTML = `<main>${user("a real question")}${assistant(LONG)}</main>`;
		expect(extractMessages()).toHaveLength(0);
		const stats = getLastExtractStats();
		expect(stats.userHits).toBe(1);
		expect(stats.asstHits).toBe(1);
		expect(stats.kept).toBe(0);
		expect(stats.unchanged).toBe(false);
		expect(stats.dropped.tooNarrow).toBe(2);
	});

	it("counts tooShort assistant hits without keeping them", () => {
		document.body.innerHTML = `<main>${assistant("too short")}</main>`;
		expect(extractMessages()).toHaveLength(0);
		expect(getLastExtractStats().asstHits).toBe(1);
		expect(getLastExtractStats().dropped.tooShort).toBe(1);
	});

	it("marks unchanged when the signature matches", () => {
		document.body.innerHTML = `<main>${user("a real question")}${assistant(LONG)}</main>`;
		expect(extractMessages()).toHaveLength(2);
		expect(getLastExtractStats().unchanged).toBe(false);
		expect(extractMessages()).toHaveLength(0);
		expect(getLastExtractStats().unchanged).toBe(true);
		expect(getLastExtractStats().kept).toBe(0);
		expect(getLastExtractStats().userHits).toBe(1);
	});

	it("resetExtractState clears the last stats snapshot", () => {
		document.body.innerHTML = `<main>${user("a real question")}</main>`;
		extractMessages();
		expect(getLastExtractStats().kept).toBe(1);
		resetExtractState();
		expect(getLastExtractStats()).toEqual({
			userHits: 0,
			asstHits: 0,
			kept: 0,
			unchanged: false,
			dropped: {
				tag: 0,
				ariaHidden: 0,
				tooShort: 0,
				tooManyLines: 0,
				tooNarrow: 0,
				emptyText: 0,
				nestedDupe: 0,
			},
		});
	});
});

describe("extractText", () => {
	it("joins text nodes and collapses whitespace", () => {
		document.body.innerHTML = `<div id="t"><p>hello</p>   <p>world</p></div>`;
		expect(extractText(document.getElementById("t")!)).toBe("hello world");
	});

	it("excludes text inside buttons, nav and aria-hidden", () => {
		document.body.innerHTML = `<div id="t">
			<p>the answer</p>
			<button>Copy</button>
			<nav>menu</nav>
			<span aria-hidden="true">tooltip</span>
		</div>`;
		expect(extractText(document.getElementById("t")!)).toBe("the answer");
	});
});

describe("generateStableId", () => {
	it("reuses an existing data-ai-sidebar-id when the element has no id", () => {
		// el.id is checked first, so the element must not carry one.
		document.body.innerHTML = `<div data-ai-sidebar-id="kept-1">x</div>`;
		const el = document.querySelector("div")!;
		expect(generateStableId(el, 0)).toBe("kept-1");
	});

	it("prefers the element's own id", () => {
		document.body.innerHTML = `<div id="real-id">x</div>`;
		expect(generateStableId(document.getElementById("real-id")!, 0)).toBe(
			"el-real-id",
		);
	});

	it("is stable across repeated calls for the same element", () => {
		document.body.innerHTML = `<div>x</div>`;
		const el = document.querySelector("div")!;
		const first = generateStableId(el, 0);
		expect(generateStableId(el, 1)).toBe(first);
	});
});
