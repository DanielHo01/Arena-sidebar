// ui/styles/arenaSidebar.ts — style strings for the Session Library section
// injected into Arena's own sidebar.
//
// These stay inline rather than becoming a stylesheet on purpose. The section is
// appended into Arena's LIGHT DOM, not this extension's shadow root, so a
// class-based rule would have to out-specify whatever Arena ships; inline styles
// cannot be overridden. Grouping them under one namespace keeps the consumer's
// import to a single symbol without taking that risk.

export const ASL = {
	/** Folder list wrapper. */
	foldersList: "margin-bottom: 6px;",

	/** One folder row. */
	folderRow:
		"display: flex; align-items: center; justify-content: space-between;" +
		"padding: 5px 6px; border-radius: 5px; cursor: pointer;" +
		"font-size: 12px; color: var(--ai-sidebar-fg, #000000);" +
		"transition: background 0.08s;",

	/** Appended to a folder row when it is the active folder. */
	folderRowActive: "background: rgba(77,124,255,0.15); color: #7aa3ff;",

	/** Folder name label. */
	folderName:
		"flex: 1; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",

	/** Session count badge on a folder row. */
	folderCount:
		"font-size: 10px; color: var(--ai-sidebar-muted, #374151); margin-left: 4px; flex-shrink: 0;",

	/** Wrapper around the new-folder input. */
	newFolderWrap: "margin-bottom: 6px;",

	/** The "+ New folder…" input. */
	newFolderInput:
		"width: 100%; box-sizing: border-box;" +
		"padding: 4px 8px; border: 1px solid rgba(255,255,255,0.08);" +
		"border-radius: 5px; background: rgba(255,255,255,0.05);" +
		"color: var(--ai-sidebar-fg, #000000); font-size: 11px; outline: none;",

	/** Scrollable session list. */
	sessionsWrap: "max-height: 200px; overflow-y: auto;",

	/** Empty-state message. */
	sessionsEmpty:
		"padding: 8px 6px; font-size: 11px; color: var(--ai-sidebar-muted, #374151); text-align: center;",

	/** One session row. */
	sessionItem:
		"display: flex; flex-direction: column; gap: 1px;" +
		"padding: 6px 6px; border-radius: 5px; text-decoration: none;" +
		"cursor: pointer; transition: background 0.08s;",

	/** Session title line. */
	sessionTitle:
		"font-size: 12px; color: var(--ai-sidebar-fg, #000000); overflow: hidden; text-overflow: ellipsis; white-space: nowrap;",

	/** Session date line. */
	sessionMeta: "font-size: 10px; color: var(--ai-sidebar-muted, #374151);",

	/**
	 * Tailwind classes for the 🗂 Session Library entry, copied from Arena's own
	 * sidebar anchors so the injected entry is visually indistinguishable from
	 * its neighbours. Long on purpose: it must match Arena's markup exactly.
	 */
	folderEntryClass:
		"peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md border border-transparent pr-2 text-sidebar-foreground shadow-none transition-[color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground group-data-[active=true]:bg-sidebar-accent group-data-[active=true]:text-sidebar-accent-foreground group-data-[active=true]:hover:bg-sidebar-accent/90",

	/** Icon cell inside the entry. */
	folderEntryIconClass:
		"flex aspect-square h-[32px] flex-shrink-0 items-center justify-center rounded-md p-1.5 text-base leading-none",
} as const;
