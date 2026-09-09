// Shared types across all modules — imported with `import type` where only a type is needed.
//
// ┌─────────────────────────────────────────────────────────────────┐
// │  Sprint 7 type unification — guiding principles:                 │
// │                                                                 │
// │  SidebarMessage  ≈ current CanonicalMessage (renamed)          │
// │  SidebarRound    ≈ current Round       (renamed + Sprint 8)    │
// │  All other types  — kept as-is, no semantic change              │
// └─────────────────────────────────────────────────────────────────┘

// ─── Core primitive types ────────────────────────────────────────────────────────────

/** Chat role — aligns with arena.ai's user/assistant model. */
export type ChatRole = "user" | "assistant" | "system";

/** Where a message originated in the extension pipeline. */
export type MessageOrigin = "bootstrap" | "capture" | "dom";

// ─── Unified message type ──────────────────────────────────────────────────────────
// Used everywhere a message appears: extract → store → panel → modals.
// Supersedes: CanonicalMessage, ExtractedMessage (now aliases below).

export interface SidebarMessage {
	id: string;
	role: ChatRole;
	/** Full message text content */
	content: string;
	/** Stable content fingerprint for deduplication across sources */
	fingerprint?: string;
	/**
	 * Which repeat of this content this message is, within its own source
	 * stream (0-based). Without it, a user who sends the same short message
	 * twice has both turns collapsed into one — see tests/unit/dedup.test.ts.
	 * Re-extracting the same DOM renumbers identically, so it stays idempotent.
	 */
	occurrence?: number;
	/**
	 * DOM anchor id (set by bindDomAnchors pass).
	 *
	 * `| undefined` is deliberate, not noise: bindDomAnchors CLEARS this field
	 * (`msg.domId = undefined`) once the element is recycled out of the DOM.
	 * Under exactOptionalPropertyTypes a bare `?:` would forbid exactly that.
	 */
	domId?: string | undefined;
	/** Where this message was first observed */
	origin?: MessageOrigin;
	/** Timestamp from capture source. Copied through on merge, so it may be undefined. */
	capturedAt?: number | undefined;
	/** Session id from capture source */
	sessionId?: string;
	/**
	 * Local edit (#15): user-corrected content lives in `content`; the
	 * fingerprint still keys the DOM original so re-extracts merge into this
	 * message (and lose to the overlay) instead of duplicating it.
	 * Extension-visible only — arena.ai itself is never touched.
	 */
	edited?: boolean;
	/** The pre-edit content, kept so the overlay is inspectable. */
	editedFrom?: string;
	/** When the user made the edit (Date.now()). */
	editedAt?: number;
}

// ─── Unified round type ─────────────────────────────────────────────────────────────
// Groups a user turn + following assistant turns into one navigable item.

export interface SidebarRound {
	id: string;
	title: string;
	/** Total messages in this round */
	messageCount: number;
	/** Position in the rounds array */
	index: number;
	/** Whether any message in this round has a DOM anchor */
	hasAnchor: boolean;
	/**
	 * ── Sprint 8: role-aware preview fields ──
	 *
	 * `| undefined` is deliberate: computeRounds builds lead rounds with these
	 * explicitly undefined and pushRound fills them with `??=`, which must not
	 * clobber a value a caller set on purpose.
	 */
	userPreview?: string | undefined;
	assistantPreview?: string | undefined;
	assistantCount?: number | undefined;
	/**
	 * ── #15: local message curation ──
	 *
	 * `edited` marks a round with a user-corrected message (the row shows a
	 * badge); `hasUserTurn` is false only for lead-assistant rounds (the row
	 * hides its ✏️ button). Both are computed in core/rounds.ts so the row
	 * renderer never scans messages itself — per-row scans would turn every
	 * render into O(rows × messages).
	 */
	edited?: boolean | undefined;
	hasUserTurn?: boolean | undefined;
}

// ─── Capture types (unchanged — written by inject-hook.js in main world) ───────────

export interface ChatRequest {
	kind: "chat-request";
	url: string;
	sessionId: string;
	mode: string;
	modality: string;
	modelAId: string;
	modelBId: string;
	userMessageId: string;
	content: string;
	attachmentCount: number;
	ts: number;
}

export interface ChatResponse {
	kind: "chat-response";
	aText: string;
	aReasoning: string;
	aFinished: boolean;
	aError: string;
	bText: string;
	bReasoning: string;
	bFinished: boolean;
	bError: string;
	ts: number;
}

export interface CapturedRound {
	sessionId: string;
	request: ChatRequest;
	response: ChatResponse;
	completed: boolean;
}

// ─── Sprint 9: session folder management ──────────────────────────────────────────────────

/** A folder that groups sessions. Default folder is "inbox". */
export interface SessionFolder {
	id: string;
	name: string;
	createdAt: number;
	updatedAt: number;
}

/** Lightweight metadata for a persisted session — stored in the session-meta index. */
export interface SessionMeta {
	sessionId: string;
	/** Title shown in the UI — from round title or custom rename */
	title: string;
	/** Custom rename set by user (overrides title) */
	customTitle?: string | undefined;
	folderId: string;
	roundCount?: number | undefined;
	messageCount?: number | undefined;
	createdAt: number;
	updatedAt: number;
	url?: string | undefined;
}

// ─── Lifecycle ──────────────────────────────────────────────────────────────────────

/**
 * Undo a `setup*` registration: remove listeners, disconnect observers, drop
 * references. Every setup function returns one so the entry point can tear the
 * whole extension down on SPA navigation instead of leaking registrations.
 */
export type Disposer = () => void;
