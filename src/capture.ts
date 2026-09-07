// capture.ts — aggregation point for everything read off arena.ai's network
// traffic and page bootstrap data.
//
// The implementation lives in capture/*:
//   chatCapture.ts  request/response pairing -> canonical messages
//   rsc.ts          passive RSC stream listener (discovery only)
//   models.ts       model id -> display name resolution
//
// This file only re-exports, so every importer keeps using "./capture". Split in
// Phase 5; the single file had grown to 324 lines across three unrelated jobs.

export {
	chatRounds,
	pollCaptures,
	resetCaptureState,
} from "./capture/chatCapture";
export { resetRscState, setupRscCapture } from "./capture/rsc";
export {
	harvestModelNames,
	lookupModelName,
	modelNameById,
} from "./capture/models";
