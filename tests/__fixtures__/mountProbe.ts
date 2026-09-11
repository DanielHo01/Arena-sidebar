// Rebuild a jsdom document from an ArenaProbeSnapshot so production
// functions (not a second copy of the detector) can replay a live page.

import { buildSidebar } from "./arenaDom";
import type { ArenaProbeSnapshot } from "./probeSnapshot";

const DEFAULT_WIDTH = 600;

function modeButton(spec: {
	text: string;
	role?: string;
	ariaSelected?: string;
	ariaPressed?: string;
	dataState?: string;
}): HTMLElement {
	const el = document.createElement(spec.role === "tab" ? "div" : "button");
	if (spec.role) el.setAttribute("role", spec.role);
	if (spec.ariaSelected) el.setAttribute("aria-selected", spec.ariaSelected);
	if (spec.ariaPressed) el.setAttribute("aria-pressed", spec.ariaPressed);
	if (spec.dataState) el.setAttribute("data-state", spec.dataState);
	el.textContent = spec.text;
	return el;
}

function messageEl(role: "user" | "assistant", text: string, width: number) {
	const el = document.createElement("div");
	el.className =
		role === "user"
			? "bg-surface-raised rounded-lg"
			: "bg-surface-primary flex-col overflow-hidden";
	el.textContent = text;
	el.dataset.probeWidth = String(width);
	return el;
}

/**
 * Replace document.body with the snapshot. Callers that need layout must
 * stub getBoundingClientRect to honour `data-probe-width` (see the contract
 * tests); jsdom reports 0×0 otherwise.
 */
export function mountProbeSnapshot(snap: ArenaProbeSnapshot): void {
	document.body.innerHTML = "";

	const sidebar = snap.dom.sidebar ?? "none";
	if (sidebar === "shadcn") {
		buildSidebar();
	} else if (sidebar === "legacy") {
		const wrap = document.createElement("div");
		wrap.className = "sidebar-wrapper";
		document.body.appendChild(wrap);
	}

	const nav = document.createElement("nav");
	for (const spec of snap.dom.modeButtons ?? []) {
		nav.appendChild(modeButton(spec));
	}
	if (nav.childElementCount > 0) document.body.appendChild(nav);

	const main = document.createElement("main");
	const scroll = snap.dom.scroll ?? "none";
	let host: HTMLElement = main;
	if (scroll === "radix") {
		const vp = document.createElement("div");
		vp.setAttribute("data-radix-scroll-area-viewport", "");
		main.appendChild(vp);
		host = vp;
	} else if (scroll === "overscroll") {
		const box = document.createElement("div");
		box.className = "overscroll-none";
		main.appendChild(box);
		host = box;
	} else if (scroll === "legacy-and") {
		const outer = document.createElement("div");
		const inner = document.createElement("div");
		inner.className = "h-full w-full overscroll-none";
		outer.appendChild(inner);
		main.appendChild(outer);
		host = inner;
	}

	for (const text of snap.dom.voteButtons ?? []) {
		const btn = document.createElement("button");
		btn.textContent = text;
		host.appendChild(btn);
	}

	for (const msg of snap.dom.messages ?? []) {
		host.appendChild(messageEl(msg.role, msg.text, msg.width ?? DEFAULT_WIDTH));
	}
	document.body.appendChild(main);

	const links = snap.dom.historyLinks ?? [];
	if (links.length > 0) {
		const menu =
			document.querySelector('ul[data-sidebar="menu"]') ?? document.body;
		for (const href of links) {
			const a = document.createElement("a");
			a.href = href;
			a.textContent = href;
			menu.appendChild(a);
		}
	}
}

/** Honour data-probe-width; default 600px so the 200px extract floor passes. */
export function rectForProbeEl(el: Element): DOMRect {
	const raw = (el as HTMLElement).dataset.probeWidth;
	const width = raw ? Number(raw) : DEFAULT_WIDTH;
	return {
		width,
		height: 120,
		top: 0,
		left: 0,
		right: width,
		bottom: 120,
		x: 0,
		y: 0,
		toJSON: () => ({}),
	} as DOMRect;
}
