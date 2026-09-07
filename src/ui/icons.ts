// ui/icons.ts — inline SVG for the FAB and the panel close button.

export const ICON_MESSAGE_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="hsl(222, 89%, 55%)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/></svg>';

export const ICON_X_SVG =
	'<svg viewBox="0 0 24 24" fill="none" stroke="hsl(0, 0%, 45%)" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>';

/**
 * Styles for the Arena history-link context menu (ui/contextMenu.ts).
 *
 * Moved out of the setup function in Phase 5: it was a 58-line template literal
 * inline in the middle of a 222-line function, which made both unreadable.
 */
