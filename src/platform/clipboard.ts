// platform/clipboard.ts — the only module allowed to touch navigator.clipboard.
//
// Why this exists: four call sites did
// `navigator.clipboard.writeText(x).then(() => {})` with no `.catch`. The
// Clipboard API rejects on denied permission, missing user activation, and any
// non-secure context, so every one of those was an unhandled rejection — and in
// the round-copy button the `.then` flipped the label to "✅", so a failed copy
// reported success.
//
// Same shape as platform/storage.ts: one seam for a browser API, never rejects,
// and injectable so the failure paths are testable. jsdom ships no
// navigator.clipboard at all, which is the honest worst case and is covered.

/** The slice of the Clipboard API this module needs. */
export interface ClipboardBackend {
	writeText: (text: string) => Promise<void>;
}

let backend: ClipboardBackend | null = null;

/**
 * Override the clipboard for tests. Pass null to go back to the ambient one.
 *
 * Unlike the old `contextValid` flag this replaces nothing global: it only
 * decides where `writeText` comes from, and a failure never disables a later
 * call.
 */
export function setClipboardBackend(fake: ClipboardBackend | null): void {
	backend = fake;
}

function ambient(): ClipboardBackend | null {
	const c = (navigator as Navigator & { clipboard?: ClipboardBackend })
		.clipboard;
	return c && typeof c.writeText === "function" ? c : null;
}

/**
 * Copy text to the clipboard.
 *
 * Resolves `true` only when the write actually succeeded, and `false` for every
 * failure — rejected promise, synchronous throw, missing API, or a backend that
 * does not return a promise. It never rejects, so callers cannot crash the
 * content script and can safely branch on the result to show real feedback.
 */
export async function copyText(text: string): Promise<boolean> {
	try {
		const impl = backend ?? ambient();
		if (!impl || typeof impl.writeText !== "function") return false;
		const result = impl.writeText(text);
		// A backend that does not return a thenable is broken, not successful.
		if (!result || typeof result.then !== "function") return false;
		await result;
		return true;
	} catch {
		return false;
	}
}
