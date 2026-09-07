// ui/styles.ts — aggregation point for the extension's stylesheets.
//
// The concrete CSS lives in ui/styles/*; this file only concatenates them so
// every importer keeps using a single UI_STYLES string. Split in Phase 5: the
// single file had grown to 386 lines of interleaved CSS for four unrelated
// surfaces (panel, list, context menu, icons).

import { PANEL_BASE_CSS } from "./styles/base";
import { PANEL_LIST_CSS } from "./styles/list";

/** Every style the shadow-DOM panel and FAB need, in one string. */
export const UI_STYLES = PANEL_BASE_CSS + PANEL_LIST_CSS;

export { CONTEXT_MENU_CSS } from "./styles/contextMenu";
export { ICON_MESSAGE_SVG, ICON_X_SVG } from "./icons";
