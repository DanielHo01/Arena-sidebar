// ui/toast.ts — transient bottom toast inside the shadow root.
//
// The only in-panel notification channel. Used for failures the user must know
// about but that have no home in the round list (currently: storage writes
// that failed even after quota eviction, #22). One toast at a time; an
// identical message while one is visible is a no-op so a failing periodic
// save cannot stack toasts.

const TOAST_VISIBLE_MS = 4000;

/** Text of the currently visible toast, if any. Module-level on purpose: there
 * is exactly one shadow root per page, so a second toast can only be a dupe. */
let activeText: string | null = null;

export function showToast(shadowRoot: ShadowRoot, text: string): void {
	const trimmed = text.trim();
	if (!trimmed) return;
	if (activeText === trimmed && shadowRoot.querySelector(".ai-toast")) return;
	shadowRoot.querySelector(".ai-toast")?.remove();
	activeText = trimmed;
	const el = document.createElement("div");
	el.className = "ai-toast";
	el.textContent = trimmed;
	(shadowRoot.querySelector(".panel") ?? shadowRoot).appendChild(el);
	window.setTimeout(() => {
		el.remove();
		if (activeText === trimmed) activeText = null;
	}, TOAST_VISIBLE_MS);
}
