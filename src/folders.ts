// folders.ts — facade / backward-compatibility re-export.
//
// Architecture (Phase 10A refactor):
//   foldersStore        — pure data layer (foldersState, storage, CRUD)
//   arenaLibrary       — Arena left sidebar injection (Session Library section)
//   historyContextMenu — right-click rename + folder-move menu
//   folders.ts         — thin facade: re-exports the above three so existing callers
//                        (content.ts, conversationStore.ts, historyTitles.ts) need no
//                        import-path changes.
//
// New code should import directly from the split files above.

export {
	foldersState,
	INBOX_ID,
	ARCHIVE_ID,
	FOLDERS_KEY,
	initFolders,
	addSessionToFolder,
	createFolder,
	getSessionsInFolder,
	getSessionMeta,
	setSessionCustomTitle,
	upsertSessionMetaFromStore,
	migrateHistoryTitles,
	setupFoldersStorageSync,
} from "./foldersStore";

export {
	ensureArenaFolderEntry,
	ensureArenaFolderEntryWithRetry,
	toggleArenaSessionLibrarySection,
} from "./arenaLibrary";

export { setupHistoryContextMenu } from "./historyContextMenu";
