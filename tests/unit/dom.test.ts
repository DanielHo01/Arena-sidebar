// The h() element helper.
//
// Building a menu row used to read:
//   const item = document.createElement("div");
//   item.className = "ai-sidebar-ctx-item";
//   item.textContent = "Rename";
//   item.addEventListener("click", fn);
//   parent.appendChild(item);
// Five statements where one is information and four are ceremony. h() collapses
// that to `h("div", { class: "ai-sidebar-ctx-item", text: "Rename", onClick: fn })`
// and returns the element, so nested trees stay readable at the depth they
// actually have.
import { describe, expect, it } from "vitest";
import { h } from "../../src/ui/dom";

describe("h", () => {
	it("creates the requested tag", () => {
		expect(h("div").tagName).toBe("DIV");
		expect(h("span").tagName).toBe("SPAN");
		expect(h("a").tagName).toBe("A");
	});

	it("sets className from `class`", () => {
		expect(h("div", { class: "a b" }).className).toBe("a b");
	});

	it("sets textContent from `text`", () => {
		expect(h("div", { text: "hello" }).textContent).toBe("hello");
	});

	it("appends string children as text", () => {
		const el = h("div", {}, "one", "two");
		expect(el.textContent).toBe("onetwo");
		expect(el.childNodes).toHaveLength(2);
	});

	it("appends element children in order", () => {
		const el = h("div", {}, h("span", { text: "a" }), h("b", { text: "c" }));
		expect(el.children).toHaveLength(2);
		expect(el.children[0].tagName).toBe("SPAN");
		expect(el.children[1].tagName).toBe("B");
	});

	it("skips null and undefined children so conditionals read naturally", () => {
		const maybe = null;
		const el = h("div", {}, h("span", { text: "a" }), maybe, undefined);
		expect(el.children).toHaveLength(1);
	});

	it("flattens arrays of children", () => {
		const items = [h("li", { text: "1" }), h("li", { text: "2" })];
		const el = h("ul", {}, items);
		expect(el.children).toHaveLength(2);
	});

	it("sets arbitrary attributes via `attrs`", () => {
		const el = h("a", { attrs: { href: "/c/abc", "data-x": "1" } });
		expect(el.getAttribute("href")).toBe("/c/abc");
		expect(el.dataset.x).toBe("1");
	});

	it("sets inline style from `style`", () => {
		const el = h("div", { style: { left: "10px", top: "20px" } });
		expect(el.style.left).toBe("10px");
		expect(el.style.top).toBe("20px");
	});

	it("wires an onClick handler", () => {
		let clicked = 0;
		const el = h("button", { onClick: () => clicked++ });
		el.click();
		expect(clicked).toBe(1);
	});

	it("wires a capture-phase handler when asked", () => {
		const seen: string[] = [];
		const child = h("span", {
			onClick: () => seen.push("child"),
		});
		const parent = h(
			"div",
			{ onClick: () => seen.push("parent"), capture: true },
			child,
		);
		document.body.appendChild(parent);
		child.click();
		expect(seen).toEqual(["parent", "child"]);
		parent.remove();
	});

	it("returns the element so it can be assigned and further mutated", () => {
		const el = h("div", { class: "x" });
		el.id = "later";
		expect(el.id).toBe("later");
		expect(el.className).toBe("x");
	});
});
