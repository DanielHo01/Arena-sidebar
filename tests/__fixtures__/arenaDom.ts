// tests/__fixtures__/arenaDom.ts — Arena's sidebar skeleton, built by test code.
//
// Replaces the old tests/arena-mock.html (deleted in Phase 6): that file carried
// stale selectors, was referenced by nothing, and could only be driven by an
// e2e script that could not run on any machine. Building the tree in code keeps
// it in lockstep with the selectors under test.
//
// The shape encodes Arena's real structure, which the production code indexes
// positionally — wrapper > [0] floating > [1] bg-sidebar > [0] floatingRoot >
// [2] quick-nav. Children at other indices are deliberate decoys: the whole
// point is that the finder must pick the right one among siblings.
//
// Not a *.test.ts file, so Vitest's include glob does not pick it up as a suite.

export interface SidebarOptions {
	/** Class list on the outermost wrapper; must match SIDEBAR_WRAPPER_SELECTOR. */
	wrapperClass?: string;
	/** How many children the floating wrapper has. The LAST one is the bg-sidebar. */
	floatingChildren?: number;
	/** 0 leaves the bg-sidebar childless, to test the empty-branch guards. */
	bgChildren?: number;
	/** How many children the floatingRoot has. Index 2 is the quick-nav. */
	rootChildren?: number;
	/** Tag for the quick-nav node; production requires a DIV. */
	navTag?: string;
}

/**
 * Build the skeleton and attach it to document.body.
 *
 * Callers are expected to clear the body themselves (usually
 * `document.body.innerHTML = ""` in a beforeEach).
 */
export function buildSidebar({
	wrapperClass = "x sidebar-wrapper y",
	floatingChildren = 2,
	bgChildren = 1,
	rootChildren = 3,
	navTag = "div",
}: SidebarOptions = {}): HTMLElement {
	const wrapper = document.createElement("div");
	wrapper.className = wrapperClass;

	const floating = document.createElement("div");
	wrapper.appendChild(floating);

	// children[0] is an unrelated sibling; children[1] IS the bg-sidebar.
	for (let i = 0; i < floatingChildren - 1; i++) {
		floating.appendChild(document.createElement("span"));
	}
	const bgSidebar = document.createElement("div");
	floating.appendChild(bgSidebar);

	const floatingRoot = document.createElement("div");
	if (bgChildren > 0) bgSidebar.appendChild(floatingRoot);

	for (let i = 0; i < rootChildren; i++) {
		const child =
			i === 2 ? document.createElement(navTag) : document.createElement("span");
		child.dataset.slot = "nav" + i;
		floatingRoot.appendChild(child);
	}

	document.body.appendChild(wrapper);
	return wrapper;
}

/** The quick-nav node inside a tree built by buildSidebar (floatingRoot[2]). */
export function quickNavOf(wrapper: HTMLElement): HTMLElement {
	return wrapper.firstElementChild!.children[1].firstElementChild!
		.children[2] as HTMLElement;
}
