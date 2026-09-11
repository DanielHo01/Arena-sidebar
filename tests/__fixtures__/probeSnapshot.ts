// Shape of tests/__fixtures__/probes/*.json — a compact, remountable
// recording of an arena.ai page. The pasteable console probe emits the
// same object as `out.snapshot`. CI mounts it and runs production
// detectBattleMode / extract / sidebar / scroll against it.

export type ProbePageKind = "direct" | "battle" | "max" | "agent" | "home";

export type SidebarKind = "shadcn" | "legacy" | "none";

export type ScrollKind = "radix" | "overscroll" | "legacy-and" | "none";

export interface ProbeModeButton {
	text: string;
	role?: string;
	ariaSelected?: string;
	ariaPressed?: string;
	dataState?: string;
}

export interface ProbeMessage {
	role: "user" | "assistant";
	text: string;
	/** Layout width in px. Live #28 user cards were > 1000. Default 600. */
	width?: number;
}

export interface ProbeExpect {
	battle: boolean;
	/** inspectArenaQuickNav: ok, the failedAt level, or skip. */
	sidebar: "ok" | "sidebar" | "container" | "skip";
	scrollFound: boolean;
	extractKeptMin?: number;
	extractUserHitsMin?: number;
	extractAsstHitsMin?: number;
}

export interface ProbeDom {
	sidebar?: SidebarKind;
	scroll?: ScrollKind;
	historyLinks?: string[];
	modeButtons?: ProbeModeButton[];
	voteButtons?: string[];
	messages?: ProbeMessage[];
}

export interface ArenaProbeSnapshot {
	schema: 1;
	id: string;
	source: string;
	capturedAt: string;
	page: ProbePageKind;
	url?: string;
	liveNotes?: string;
	expect: ProbeExpect;
	dom: ProbeDom;
}
