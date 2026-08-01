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

// ─── Persistence ─────────────────────────────────────────────────────────────────

export interface PersistedConversation {
	sessionId: string;
	savedAt: number;
	messages: SidebarMessage[];
	rounds: SidebarRound[];
}

// ─── Store shape ─────────────────────────────────────────────────────────────────

export interface ConversationStoreState {
	messages: SidebarMessage[];
	rounds: SidebarRound[];
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

// ─── Panel state ─────────────────────────────────────────────────────────────────

export interface PanelState {
	isOpen: boolean;
	reverseOrder: boolean;
	searchQuery: string;
	currentRoundIdx: number;
	highlightInitialized: boolean;
	isDragging: boolean;
	isSummarizing: boolean;
}

// ─── Sprint 2.5: history capture from inject-hook ─────────────────────────────────

export interface HistoryPayload {
	url: string;
	status: number;
	ts: number;
	body: string;
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
	customTitle?: string;
	folderId: string;
	roundCount?: number;
	messageCount?: number;
	createdAt: number;
	updatedAt: number;
	url?: string;
}

// ─── Backward-compatible aliases ──────────────────────────────────────────────────
// These let us migrate files one at a time without breaking existing imports.
// Prefer the new names above in new code; remove aliases in Sprint 8+.

/** @deprecated use SidebarMessage */
export type CanonicalMessage = SidebarMessage;

/** @deprecated use SidebarMessage */
export type ExtractedMessage = SidebarMessage;

/** @deprecated use SidebarRound */
export type Round = SidebarRound;

/** @deprecated use MessageOrigin */
export type MessageSource = MessageOrigin;
