// ui/panel.ts — aggregation point for the panel UI.
//
// The implementation lives in ui/panel/*:
//   highlight.ts  which round is in view
//   list.ts       diffing the round list against the DOM
//   roundItem.ts  rendering one row
//   skeleton.ts   the panel shell and style injection
//
// This file only re-exports, so every importer keeps using "ui/panel". Split in
// Phase 5; the single file had grown to 413 lines mixing all four concerns.

export {
	refreshCurrentHighlight,
	setupScrollHighlight,
} from "./panel/highlight";
export { reconcileList } from "./panel/list";
export { ensurePanelSkeleton, ensureStyles } from "./panel/skeleton";
