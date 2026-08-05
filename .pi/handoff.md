<!-- pi-handoff: auto-generated. Safe to edit or delete. -->
# Session Handoff
- Generated: 2026-08-05T14:51:12.219Z
- Reason: auto: context 83%
- Session: 019fcc5b-22e0-769e-88c3-db68f3e09965
- Conversation model: MiniMax-M2.7-highspeed
- Summarizer: MiniMax-M3
- Context at generation: 83% (169.4k tokens)
---
## Goal
Complete the `feat/slim-bookmark-nav` refactor (Sprint A/B/C done) + investigate performance bottleneck using perf-instrumentation logs; user wants a narrow, evidence-based fix proposal for the `refreshUI` observer storm and `hydrateFromStorage` cost.

## Current State

**Branch:** `feat/slim-bookmark-nav` (cut from `main` HEAD `2951896`, tagged `pre-slim-v0.2.0` is NOT in repo but tag attempt was made).

**Commits on branch** (oldest first → newest):
1. `02cf8c2` A1: feat(slim): remove export/summary buttons from panel header
2. `51e5025` A2: refactor(slim): remove folders/arenaLibrary/contextMenu — titles now use `historyTitle_<sid>`
3. `ced77c1` A3: refactor(slim): remove export and summary modal pipeline
4. `a4d4f98` A4: refactor(slim): detach non-core capture pipeline
5. `3e05705` A6: chore(slim): align types/tests/timer state
6. `2fa8c2f` (already on branch, pre-existing): trim capture types, simplify conversationStore
7. `66ef100` (already on branch, pre-existing): confirm Sprint B — historyTitles direct storage
8. `ff44877` B1-B4: refactor(ui): redesign panel as minimal bookmark navigator (192px, ghost close, hover opacity)
9. `08fdc7f` C1-C5: perf(slim): immediate hydration from cache, lazy DOM extraction
10. `observer-route-fix`: fix(observer): re-enable hydration on SPA route changes (reset `hydrationDone`)
11. `perf-instrumentation`: perf(slim): add perf instrumentation for startup investigation
12. `preScroll-fix`: fix(preScroll): always extract DOM on give-up — prevents empty panel on cold start

**Files final state** (`src/`):
- `content.ts` (~700+ lines) — bootstrap + observer + perf helpers (`PERF`, `t0`, `t1` at top, lines ~10-25)
- `conversationStore.ts` — data layer; `loadFromStorage` has inline perf log (no `t1` helper, uses raw `performance.now()`)
- `extract.ts` — DOM extraction (no perf instrumentation yet)
- `historyTitles.ts` — `historyTitle_<sid>` direct storage model
- `state.ts` — `panel`, `fab`, `timers` (no `pollInterval`, no `capture` state)
- `types.ts` — `SidebarMessage`, `SidebarRound`, `MessageOrigin = "bootstrap" | "dom"`
- `rounds.ts` — `hiddenRoundIds` Set
- `background.ts` — service worker stub

**Files deleted:** `folders.ts`, `foldersStore.ts`, `arenaLibrary.ts`, `historyContextMenu.ts`, `titleResolver.ts`, `capture.ts`, `ui/modals.ts`

**Build:** `npm run build` → `content.ts-*.js` ~29 KB / gzip 9 KB
**Tests:** 17 assertions across 4 test scripts all green

**Perf helpers added (content.ts top):**
```ts
const PERF = true;
function t0(label: string): number {
  if (!PERF) return 0;
  console.log('[Perf] ' + label + ' ->');
  return performance.now();
}
function t1(label: string, start: number, extra = ''): void {
  if (!PERF) return;
  const ms = (performance.now() - start).toFixed(1);
  console.log('[Perf] ' + label + ' <- ' + ms + 'ms' + (extra ? ' | ' + extra : ''));
}
```

**Instrumented functions:**
- `hydrateFromStorage()` — logs entry/exit with `msgs`, `rounds`, and skip reasons
- `refreshUI()` — t0 at first real statement after early-return guards; t1 before every `return` and at end (BUT: `return` count is artificially high because `t1` was inserted before ALL `return` keywords including those inside inner callbacks in `setupObserver` — works because TypeScript scope allows unused, but log noise is huge)
- `startPreScroll()` — reason logging: "skipped (already done)", "looking for scroll container...", "skipped, container not virtualized — calling rebuild anyway", "gave up, no container — extracting from DOM", "done"
- `rebuildForCurrentRoute()` — entry/exit with `bootstrap`, `dom`, `total` counts
- `loadFromStorage()` in `conversationStore.ts` — manual `performance.now()` (no `t1` import, raw console)

## Next Steps

1. **Wait for user's decision on perf fix priority** (they asked: option 1 = remove `setupPeriodicPush`, option 2 = add mutation filter, option 3 = do nothing since 458ms is the only real cost).
2. **Remove `PERF = true` instrumentation once investigation is complete** — user's stated exit criteria. Currently `PERF = true` at line ~10 of `content.ts` causes console spam in production.
3. **Clean up `refreshUI` t1 placement** — t1 was inserted before EVERY `return` keyword, including returns inside `setupObserver`'s inner callback. This produces hundreds of "returns early" lines that don't correspond to actual `refreshUI` returns. Needs regex-aware re-instrumentation limited to `refreshUI`'s top-level function body only.
4. **Extend perf instrumentation** (if user wants more evidence before deciding) — add to `extractMessages()`, `refreshStore()`, `bindDomAnchors()`, `computeRounds()` in `conversationStore.ts` + `extract.ts`.
5. **If user picks option 1 (drop `setupPeriodicPush`)**: remove the call in bootstrap; verify refreshUI still updates via observer-only path; commit.
6. **If user picks option 2 (mutation filter)**: inspect `setupObserver` (line ~190), narrow `observer.observe(target, {childList: true, subtree: true})` to `subtree: true, attributes: false, characterData: true` and add filter callback.
7. **Collect Performance profile** (Chrome DevTools → Performance tab) — user needs to do this in browser, can't automate. Ask them for: longest main-thread task, scripting/rendering/painting weight, observer callback count.

## Open Questions & Blockers

1. **User preference on perf fix direction** — pending. Three options offered, waiting on answer.
2. **`refreshUI` perf log noise** — currently logs hundreds of "returns early" per session due to naive t1 insertion. Even when `PERF = false` it's silent, but during perf-investigation this floods the console and obscures signal. Should re-instrument using function-scoped guards before next evidence collection.
3. **`.pi-lens` advisories blocking edits** — multiple times during Sprint C, auto-fix on oxlint renamed `observer` → `_observer` and removed the `let observer: MutationObserver | null = null;` declaration entirely; had to manually re-add. Same issue will likely recur on next edit. **Always re-read file after every edit** that triggers 🔴 STOP.
4. **Stale `setupPeriodicPush` may not exist anymore on this branch** — current `content.ts` no longer has a `setupPeriodicPush` definition (it was removed in A4 capture-pipeline cleanup). The "remove setupPeriodicPush" option-1 fix therefore may already be in place — need to verify with `grep -n "setupPeriodicPush\|refreshInterval" src/content.ts`.
5. **Em-dash character matching** — `edit` tool failed multiple times when `oldText` contained `—` (em-dash) in comments. Workaround used: Python `replace` via `bash` for any edits spanning em-dash comments. **Prefer `python3` script for multi-line edits** to avoid drift.
6. **`rebuildForCurrentRoute` was missing during edits** — got accidentally removed during Sprint C cleanup; re-added with full timer instrumentation. Make sure that when removing perf instrumentation, the function definition itself remains intact.
7. **Two-hydrate pattern in user logs** — user observed `hydrateFromStorage` firing twice (once good, once zero). Root cause unverified; may be (a) SPA route change resetting `hydrationDone`, or (b) the second call from observer triggering re-hydration. The recent `observer-route-fix` commit added `hydrationDone = false` reset on route change — needs verification that this is the cause.

## Key Facts & Conventions

### Project paths
- Root: `D:/edge-ai-sidebar`
- Branch: `feat/slim-bookmark-nav`
- Current HEAD commit: `08fdc7f` + 4 subsequent (`observer-route-fix`, `perf-instrumentation`, `preScroll-fix`, possibly uncommitted)
- Origin: `https://github.com/DanielHo01/Arena-sidebar`
- Build output: `dist/assets/content.ts-*.js` ~29 KB gzip 9 KB

### Final source layout (post-Sprint A/B/C)
```
src/
├── background.ts        service worker stub
├── content.ts           bootstrap / observer / preScroll / hydration / perf
├── conversationStore.ts messages+rounds+fingerprint+load/save (with inline perf)
├── extract.ts           DOM message extraction (no perf yet)
├── historyTitles.ts     historyTitle_<sid> direct storage
├── rounds.ts            hiddenRoundIds Set
├── state.ts             panel/fab/timers (no pollInterval, no capture state)
├── types.ts             SidebarMessage, SidebarRound, MessageOrigin="bootstrap"|"dom"
ui/
├── fab.ts               FAB
├── panel.ts             bookmark navigator (192px, ghost close, hover opacity)
└── styles.ts            slim CSS
scripts/
├── e2e-floating.cjs            14.3K
├── test-content-extract.cjs    5.8K
├── test-conversation-store.cjs 14.9K
├── test-round-grouping.cjs     3.1K
├── test-src-rounds.ts          4.0K (10 assertions)
└── test-src-store.ts           4.3K (7 assertions)
```

### Perf instrumentation state
- All perf logs prefix `[Perf] ` — easy to filter in console
- `PERF = true` at content.ts top, single toggle
- `refreshUI` log pattern shows `<- Xms | msgs=N rounds=N` at function end and `<- Xms | returns early` at early returns
- **Warning:** t1 insertion was regex-blind — `return` inside `setupObserver`'s inner closure also got a t1. Filter console for only `[Perf] hydrateFromStorage` and `[Perf] rebuildForCurrentRoute` for clean signal; ignore the `refreshUI` churn lines during initial session.

### Critical function signatures
- `hydrateFromStorage(): Promise<void>` — loads from `edge-ai-sidebar:session:<sid>`, gated by `hydrationDone`. Called from bootstrap AND from observer's route-change branch (after `hydrationDone = false` reset).
- `rebuildForCurrentRoute(): void` — extracts from DOM (`extractBootstrapMessages() + extractMessages()`), merges via `refreshStore({bootstrap, dom, bindAnchors: true})`, saves to storage only if `domMsgs.length > 0`. Called from `startPreScroll` "gave up" branch, "not virtualized" branch, and observer debounce.
- `extractMessages(): SidebarMessage[]` — DOM scan via 12 selectors; **no perf logging yet**.
- `refreshStore(opts)` — in conversationStore.ts; merges into `conversationStore.messages[]`; `bindDomAnchors()` always called when `bindAnchors: true`; **no perf logging yet**.
- `loadFromStorage(sessionId)` — chrome.storage.local.get with raw perf log using `performance.now()` (no `t1` helper because `t1` not exported).

### npm scripts
- `npm run build` — tsc + vite build
- `npm test` — 17 assertions across 4 test files (mirror cjs + source ts)

### Edit tool gotchas (Sprint-crucial)
1. **Em-dash (—) in comments breaks `edit` tool** — use Python `replace` via `bash` instead for any edit crossing a `──` or `—` boundary
2. **Linter auto-fixes during edits** — oxlint renames unused vars → `_`, sometimes deletes declarations entirely. Re-read file after every 🔴 STOP.
3. **Tab indentation** — files use tabs; preserve in all new code.
4. **CRLF line endings** — git `core.autocrlf=true` per project policy.

### Recent user diagnostic evidence
- Cold-start (cached): `hydrateFromStorage 458.9ms`, `refreshUI 6.3ms`, `startPreScroll gave up`. 243 msgs, 92 rounds restored.
- Cold-start (no cache): `hydrateFromStorage 0.8ms, msgs=0 rounds=0`, then DOM extraction eventually yields ~29 msgs / 10 rounds.
- Ongoing session: hundreds of `refreshUI <- 0.1-5.6ms returns early` per second during first few seconds; settles to near-zero thereafter.
- CSP report-only violations on `https://help.arena.ai/articles/...?_rsc=...` — unrelated to extension; harmless.
- "Autofocus processing was blocked" — also harmless unrelated warning.

### Investigation conclusion written to user
Only one real perceived bottleneck: `hydrateFromStorage` 458ms (chrome.storage API inherent). `refreshUI` even at hundreds of calls takes sub-ms each via fast-path. User asked which of 3 options to pick: (a) remove `setupPeriodicPush`, (b) add mutation filter, (c) do nothing.

### Things explicitly NOT to do
- Don't `git checkout refactor/folders-split` — different scope; stale P0-P3 splits
- Don't merge `feat/slim-bookmark-nav` into anything — `main` is the stable line, user asked for new branch from main
- Don't add `revalidateContext`, `ensureArenaFolderEntry`, `SessionFolder`, `SessionMeta` — they were deliberately deleted in Sprint A
- Don't re-introduce `capture.ts` — removed in A4
- Don't add `isFirstRender` flag — was removed in bootstrap race-fix; SPA route change now uses `hydrationDone` reset instead
