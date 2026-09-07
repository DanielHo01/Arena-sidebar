// arena.ai route parsing — the single source of truth for "/c/{sessionId}".
//
// Why this module exists: the same regex was duplicated across 4 files in 3
// variants. Two of them used /\/c\/([^/?]+)/ — the exclusion class was missing
// `#`, so a history link href of "/c/abc#section" resolved to "abc#section".
// See tests/unit/route.test.ts.
//
// Every function takes a string rather than reading `location`, so the whole
// module is testable with no DOM and reusable from either world.

/** Session id at the start of a pathname: /c/{id}. Anchored, excludes ? and #. */
const SESSION_PATHNAME_RE = /^\/c\/([^/?#]+)/;

/**
 * Session id anywhere in a string (an <a href>, which may be absolute).
 * Deliberately unanchored: hrefs look like "/c/abc" or "https://arena.ai/c/abc".
 */
const SESSION_HREF_RE = /\/c\/([^/?#]+)/;

/**
 * Extract the session id from `location.pathname`.
 * Returns "" when the current page is not a session page.
 */
export function getSessionId(pathname: string): string {
	return SESSION_PATHNAME_RE.exec(pathname)?.[1] ?? "";
}

/**
 * Extract the session id from a history link's href.
 * Returns "" when the href does not point at a session.
 */
export function sessionIdFromHref(href: string): string {
	return SESSION_HREF_RE.exec(href)?.[1] ?? "";
}

/** True on /c/... pages ("loaded mode"); false on the new-chat pages. */
export function isSessionRoute(pathname: string): boolean {
	return pathname.startsWith("/c/");
}

/**
 * Identity of the current route, used to detect SPA navigation.
 * Session routes key on the id alone so that query-string churn does not look
 * like a route change; everything else keys on path + search.
 */
export function routeKey(pathname: string, search: string): string {
	const sid = getSessionId(pathname);
	return sid ? "c:" + sid : pathname + search;
}
