# 后续推进路线（Roadmap）

> 活文档：每完成一个 Track 就更新状态。数字以实测为准，估算会明确标注。
> 架构现状见 [docs/architecture.md](./architecture.md)（唯一架构文档）。

## 0. 当前位置（2026-10-08 快照）

- **PR #35（Track C）**：✅ 已合入 `main`（merge commit `5f85f69`）。
- **本分支**：`5f85f69` 之上的单 commit（Track A + 本文档，44 files）。
  中间出过一次沙箱回收（和 `docs/archive/handoff-2026-09-07.md` §1.1
  预言的一样）：`.git` 历史丢失，工作树验证完整后先压成单 commit，
  #35 合并后再把 Track A 部分提成 patch 重放到新 `main` 上——
  所以本 PR 的 diff 是干净的 A-only。之前所有中间 commit 的 hash 全部失效，
  以 §2 步骤清单为准，不再引用 hash。
- **环境**：`node_modules` 已重装；`/tmp/chromium` 丢失，本地 e2e 需重跑
  `node tests/e2e/setup-browser.mjs`（网络受限跑不起来就以 CI 的 e2e 为准）。
- 约束：本会话固定在 `arena/e469509e-arena-sidebar` 单分支上，PR 只能一个接一个从这条分支开。

## 1. 合并顺序（Runbook）

1. ~~merge #35~~ ✅ done（`5f85f69`，merge-commit 方式，与 #34 一致）。
2. Track A PR：本分支已重放到新 `main` 之上（单 commit，可直接 push）→
   开 PR（base `main`，diff = A 的改动 + 本文档，44 files）→ 等 CI → merge。
3. 开工 **Track E**（独立 PR，见 §3）。
4. **Track B / D 拍板范围**（见 §4）后再排期。

## 2. Track A PR（随本 commit 开出，base 新 `main`）

| 步骤 | 内容 |
| --- | --- |
| A0–A1 |删 `console.log` tracing（~46 行，warn/error 全留）；命名 loop 超时 / 截断宽度 / prescroll 常量；`HOST_ELEMENT_ID`、`isSessionSnapshot` guard、`SESSION_SNAPSHOT_PREFIX` 复用；删 `ui/panel.ts` + `ui/styles.ts` 两个 barrel |
| A2 |`storage.ts` → +`storageWrites.ts`（读/写分离，经 `getStorageBackend()` 单向取 backend，无环） |
| A3 |`conversationStore.ts` → +`conversationSync.ts`；render-cache 重置搬进 `ui/panel/roundItem`（UI 的缓存自己清） |
| A4 |`extract.ts` → +`extractCollect.ts`（生产侧零改线） |
| A5 |图标 `public/icons` → `icons`（`dist/public/` 整层消失，省 3,505 B）；天花板 420→315、预算 75k/25k→73.5k/24k；文档全部重测 |

Gates 快照：format ✓ · lint 0/0 ✓ · typecheck ✓ · arch
`168 edges · 45/45 · 310/315` ✓ · 测试 750/750 ✓ ·
覆盖率 95.23/86.4/96.49/96.9（地板全过）· e2e 13/13 真 Chromium ✓。

刻意保留（评审时不用问）：`"（开场助手消息）"` 留在 `core/rounds.ts`
（搬走要加 API 面，零收益）；hook/WAR 一点没碰（归 Track E）。

## 3. Track E：删除休眠的抓取子系统（已决策，独立 PR）

### 3.1 为什么删：休眠证据链（已实测）

1. `public/inject-hook.js` 只写 `__aiSidebarRsc` + `aiSideHookReady`，**从不写**
   `aiSideRequest` / `aiSideResponse`——而那正是 `chatCapture` 唯一的数据源。
2. `aiSideHookReady` 在 `src/` 里**零读取**。
3. `pollCaptures` 每 2 秒空转：`chatRounds` 恒为空。
4. `harvestModelNames` 生产**零调用** → 模型名 map 恒空 →
   `lookupModelName` 经 `modals` → `serialize` 传进去也永远返回 `""`。
5. `rsc.ts` 是纯日志脚手架（`setupRscCapture` 注册的监听只记日志）。
6. 代价：~440 行生产代码 + ~370 行测试 + hook + WAR，零线上效果，
   还带着一条没人用的 `web_accessible_resources`（含 `localhost:8000` 开发 origin）。

### 3.2 删什么（整文件）

| 文件 | 行数 | 说明 |
| --- | --- | --- |
| `public/inject-hook.js` | 76 行 / 1,883 B | MAIN world 注入脚本 |
| `src/capture/chatCapture.ts` | 131 | request/response 配对（数据源恒空） |
| `src/capture/models.ts` | 119 | 模型名 harvest（零调用） |
| `src/capture/rsc.ts` | 91 | RSC 监听（纯日志） |
| `src/capture.ts` | 22 | barrel |
| `tests/unit/capture.test.ts` | 192 | 整文件删 |
| `tests/unit/rsc.test.ts` | 176 | 整文件删 |

合计：生产 **439 行**，测试整文件 **368 行**（另有 7 个测试文件需修剪，见 §3.4）。

### 3.3 改什么（接线拆除）

| 位置 | 拆除内容 |
| --- | --- |
| `src/manifest.json` | MAIN `content_scripts[0]` 整项 + `web_accessible_resources` 整条 |
| `src/app/loop.ts` | `pollCaptures`：import、`CAPTURE_POLL_MS`、`pollInterval` 整块 |
| `src/state.ts` | `timers.pollInterval` 字段 |
| `src/content.ts` | `setupRscCapture`：import + `registerDisposer` |
| `src/app/store.ts` | `resetCaptureState` / `resetRscState`：import + 调用 |
| `src/ui/modals.ts` | `chatRounds` / `lookupModelName` 输入 |
| `src/core/serialize.ts` | `captured` / `resolveModelName` 输入、`indexCapturedByUser` |
| `src/types.ts` | `CapturedRound`、`MessageOrigin` 的 `"capture"` |
| `src/conversationSync.ts` | `addCapturedMessage`（唯一生产调用方是 chatCapture）→ 删；`refreshStore` 的 `capture` 参数 → 删；`upsert` 里的 capture-优先分支 → 简化 |

`content_scripts` 里 `localhost` / `127.0.0.1` 的 matches **不动**
（本地开发用，不属于 WAR 问题）。

### 3.4 测试与 e2e 同步

- 整文件删：`capture.test.ts`、`rsc.test.ts`。
- 修剪：`lifecycle.test.ts`（capture/rsc 状态用例）、`content.test.ts` / `loop.test.ts`
  （capture mock + `polls captures every 2s` 用例）、`modals.test.ts` / `serialize.test.ts`
  （capture 输入）、`dedup.test.ts` / `store.test.ts`（`addCapturedMessage` / capture 参数）。
- **e2e 必须同步改**：`tests/e2e/run.mjs:184-197` 从 `dist/assets` 读 hook 包注入，
  hook 没了 harness 会先挂。改完跑全量 13 步。
- `layer-rules.test.ts` 的 `src/capture/rsc.ts` fixture 是自包含 synthetic 数据，
  不受影响；`UNLAYERED` 名单去掉 `src/capture.ts`。

### 3.5 文档与棘轮（E 落定后）

- `docs/architecture.md`：§5 的 hook 段落（`dist/inject-hook.js` + 896 B hash 产物消失）、
  §2 的 edges 样本行重测；`README.md`：构建大小行、capture 相关描述以 grep 为准修正。
- 棘轮重测：`ROOT_IN_EDGE_MAX`（`capture.ts` 当前 4 条入边消失，预计 41，实测为准）、
  bundle budget（content 包预计再小**数 KB**，实测后下调；`FILE_LINES_MAX` 不动——E 不碰大文件）。
- 本文档状态更新为 done。

### 3.6 验收

全门禁（format/lint/typecheck/arch/test/coverage 地板）+ e2e 13/13 +
`grep -rn "aiSideRequest\|aiSideResponse\|chatRounds\|CaptureState\|RscState" src public`
（`contextMenu` 的 `aiSidebarCtxBound` 是扩展自己的 dataset 标记，**不在删除范围**，grep 时排除）。

## 4. Track B / D（待拍板，开工前需确认范围）

> 诚实声明：最早四轨道审计里 B、D 的原始定义在会话压缩中丢失了，
> 下面是基于**当前实测状态**重建的提案，不是已定事项。开工前用 ask_user 拍板。

现状弹药（2026-10-08 实测）：

- 超 300 行文件只剩 2 个：`ui/arenaSidebar.ts`（310）、`features/sessions.ts`（306）。
- `UNLAYERED` 还剩 7 个（E 之后剩 6）：state、rounds、extract、conversationStore、
  historyTitles、titleResolver（+ capture.ts，E 删）。
- `ROOT_IN_EDGE_MAX` = 45（state 14、rounds 9、store 8、extract/capture 各 4…）。
- `KNOWN_DEBT` 3 对：`ui/panel/{keyboard,modals,roundItem}.ts → app/lifecycle.ts`。

### Track B（提案）：分层收尾

`arenaSidebar` / `sessions` 拆分评估 + `UNLAYERED` 迁移 +
`KNOWN_DEBT` 3 对退役，把 `ROOT_IN_EDGE_MAX` 从 45 继续往下压。
这是 A 的自然延续：A 拆了三个巨头，B 收尾剩下的。

### Track D（提案·方向待定）

候选（三选一或组合，需用户定）：

1. 覆盖率地板上推（当前 95.23/86.4/96.49/96.9，地板 94/85/95/96——余量最小的是分支覆盖）；
2. e2e 扩面（13 步之外的高价值行为，或 mock-arena  fidelity 提升）；
3. 复杂度热点打磨（以实测为准，不预设文件）。

## 5. 不做清单（防回潮，评审/开工时对照）

- `renderUI` 快速路径的 `data-ai-sidebar-mode` 滞后：**有意保留**，
  `render.test.ts` 的 `leaves host attributes stale on the fast path` 用例钉住并写明了理由。
- 侧栏注入的 feature-matching 另一半：**已明确拒绝**（无法针对真实 arena.ai DOM 验证）。
- `"（开场助手消息）"` 留 `core/rounds.ts`（§2，理由同上）。
- `public/` 里不放非扩展资产（`docs/assets/pelican-bicycle.svg` 的教训）。
- 天花板只许往下调：`ROOT_IN_EDGE_MAX`、`FILE_LINES_MAX`、bundle budget、覆盖率地板。
