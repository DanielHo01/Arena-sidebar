// tests/__fixtures__/arenaDom.ts — Arena's sidebar skeleton, built by test code.
//
// Replaces the old tests/arena-mock.html (deleted in Phase 6): that file carried
// stale selectors, was referenced by nothing, and could only be driven by an
// e2e script that could not run on any machine. Building the tree in code keeps
// it in lockstep with the selectors under test.
//
// Shape as of 2026-09-09 (#20): shadcn Sidebar, semantic attributes, no
// child-index path.
//
//     [data-sidebar="sidebar"]
//       button[data-side="rail"]
//       [data-side="container"]   ← Session Library injects here
//         ul[data-sidebar="menu"]
//         button
//
// Not a *.test.ts file, so Vitest's include glob does not pick it up as a suite.

export interface SidebarOptions {
	/** When false, omit the [data-sidebar=sidebar] root entirely. */
	sidebar?: boolean;
	/** When false, omit [data-side=container] inside the sidebar. */
	container?: boolean;
	/** When false, omit ul[data-sidebar=menu] inside the container. */
	menu?: boolean;
	/**
	 * Also stamp the legacy class-substring so fallback-finder tests have
	 * something to match without a data-sidebar attribute.
	 */
	legacyWrapperClass?: boolean;
}

/**
 * Build the skeleton and attach it to document.body.
 *
 * Callers are expected to clear the body themselves (usually
 * `document.body.innerHTML = ""` in a beforeEach).
 */
export function buildSidebar({
	sidebar = true,
	container = true,
	menu = true,
	legacyWrapperClass = false,
}: SidebarOptions = {}): HTMLElement {
	const root = document.createElement("div");
	if (sidebar) root.setAttribute("data-sidebar", "sidebar");
	if (legacyWrapperClass) root.className = "x sidebar-wrapper y";

	const rail = document.createElement("button");
	rail.setAttribute("data-side", "rail");
	root.appendChild(rail);

	if (container) {
		const host = document.createElement("div");
		host.setAttribute("data-side", "container");
		host.dataset.slot = "container";
		if (menu) {
			const list = document.createElement("ul");
			list.setAttribute("data-sidebar", "menu");
			host.appendChild(list);
			host.appendChild(document.createElement("button"));
		}
		root.appendChild(host);
	}

	document.body.appendChild(root);
	return root;
}

/** The injection container inside a tree built by buildSidebar. */
export function quickNavOf(wrapper: HTMLElement): HTMLElement {
	return wrapper.querySelector('[data-side="container"]') as HTMLElement;
}
