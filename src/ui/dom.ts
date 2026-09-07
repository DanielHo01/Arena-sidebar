// ui/dom.ts — the h() element helper.
//
// Vanilla DOM building reads as ceremony: createElement, assign className,
// assign textContent, addEventListener, appendChild — five statements where one
// carries information. h() collapses that to one expression and returns the
// element, so a nested tree reads at the depth it actually has instead of as a
// flat sequence of imperatives.
//
// This is deliberately the whole framework. No reactivity, no diffing, no
// component model: the extension rebuilds small trees on demand and the
// reconciler in content.ts decides when that is necessary.

export type Child = Node | string | number | null | undefined | false | Child[];

interface HBaseProps {
	/** Sets className. */
	class?: string;
	/** Sets textContent. Ignored if children are also given. */
	text?: string;
	/** Raw attributes, for anything without a matching DOM property. */
	attrs?: Record<string, string>;
	/** Inline styles. */
	style?: Partial<CSSStyleDeclaration>;
	/** click handler. */
	onClick?: (e: MouseEvent) => void;
	/** Register onClick in the capture phase (used by the context menu). */
	capture?: boolean;
}

/**
 * Base props plus any direct property of the element, so `{ type: "text" }` on an
 * input or `{ disabled: true }` on a button need no special casing.
 */
// Omit the base keys so this module's `class` / `text` / `style` / `onClick`
// win over the native properties of the same name; intersecting without the
// Omit makes `style` require a full CSSStyleDeclaration.
export type HProps<K extends keyof HTMLElementTagNameMap> = HBaseProps &
	Omit<Partial<HTMLElementTagNameMap[K]>, keyof HBaseProps>;

/** Create an element, apply props, append children, return it. */
export function h<K extends keyof HTMLElementTagNameMap>(
	tag: K,
	props?: HProps<K> | null,
	...children: Child[]
): HTMLElementTagNameMap[K] {
	const el = document.createElement(tag);
	if (props) {
		const { class: cls, text, attrs, style, onClick, capture, ...rest } = props;
		if (cls !== undefined) el.className = cls;
		if (text !== undefined) el.textContent = String(text);
		if (attrs) {
			for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
		}
		if (style) Object.assign(el.style, style);
		// Cast: the handler is typed MouseEvent for ergonomics at call sites,
		// while addEventListener declares the wider EventListener signature.
		if (onClick)
			el.addEventListener("click", onClick as EventListener, !!capture);
		for (const [k, v] of Object.entries(rest)) {
			if (v !== undefined) (el as unknown as Record<string, unknown>)[k] = v;
		}
	}
	append(el, children);
	return el;
}

/** Append children, flattening arrays and skipping falsy values. */
function append(parent: Element, children: Child[]): void {
	for (const child of children) {
		if (child === null || child === undefined || child === false) continue;
		if (Array.isArray(child)) {
			append(parent, child);
		} else if (typeof child === "string" || typeof child === "number") {
			parent.appendChild(document.createTextNode(String(child)));
		} else {
			parent.appendChild(child);
		}
	}
}
