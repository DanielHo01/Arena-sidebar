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
	/** DOM anchor id (set by bindDomAnchors pass) */
	domId?: string;
	/** Zero-based round index this message belongs to */
	roundIndex?: number;
	/** Where this message was first observed */
	origin?: MessageOrigin;
	/** Timestamp from capture source */
	capturedAt?: number;
	/** Session id from capture source */
	sessionId?: string;
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
	/** ── Sprint 8: role-aware preview fields ── */
	userPreview?: string;
	assistantPreview?: string;
	assistantCount?: number;
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


