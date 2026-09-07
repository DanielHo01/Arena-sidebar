// Single source of truth for "what title does this session display".
//
// Problem 2: titles came from three independent sources (historyTitle_ storage
// keys, sessionMeta.title, round.title) that never synced. Resolution rule:
//
//   customTitle (user rename, double-click / context menu)  →  highest priority
//   title       (Arena's original title, written on first capture) → fallback
//   sessionId prefix → last resort
//
// round.title is deliberately NOT part of this chain — it is a per-round preview,
// not a session title.

/**
 * Input shape — customTitle/title are optional; sessionId is required.
 *
 * `| undefined` on both is required, not decorative: every real caller passes a
 * `SessionMeta`, whose own optional fields are explicitly-undefined-able, and
 * under exactOptionalPropertyTypes a bare `?:` here would reject that argument.
 */
export type SessionTitleInput = {
	customTitle?: string | undefined;
	title?: string | undefined;
	sessionId: string;
};

/** Resolve the display title for a session. Never returns an empty string. */
export function resolveSessionTitle(meta: SessionTitleInput): string {
	if (meta.customTitle && meta.customTitle.trim()) {
		return meta.customTitle.trim();
	}
	if (meta.title && meta.title.trim()) {
		return meta.title.trim();
	}
	return meta.sessionId.slice(0, 8);
}
