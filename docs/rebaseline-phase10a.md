# Re-baseline: phase10a current architecture

> 生成于 checkpoint `14b63f2`（tag `phase10a-build-green`）之后。
> 目标读者：开发者。用途：固化当前真实架构，作为后续功能/清理/文档工作的基线。
> 结论均来自对 src/ 全量源码的静态取证（无运行态验证）。

---

## 1. Supported page modes

| 路由 | 模式 | 行为差异 |
| --- | --- | --- |
| `/c/{sessionId}` | **loaded mode**（历史会话） | panel 默认打开；先 `loadFromStorage` 恢复再 DOM 重建；preScroll 强制滚动虚拟列表；header 有 ⤒ Scan 按钮；无 ✨ summarize 按钮；点击 round 不收起 panel |
| `/?mode=direct` 或其余页面 | **capture mode**（新对话） | panel 默认关闭（只显示 FAB）；有 ✨ summarize；无 Scan 按钮；点击 round 收起 panel |
| 非 arena.ai 域名 | 不支持 | manifest matches 已限定 |

判定函数：`isCharacterChatRoute()` = `location.pathname.startsWith("/c/")`（content.ts）。

## 2. Data flow

```
bootstrap(__NEXT_DATA__ / script 扫描)
capture(inject-hook 拦截的 API/WS/RSC dataset)
dom extract(extractMessages)
persisted restore(loadFromStorage, 仅 /c/)
        │  优先级合并(bootstrap > capture > dom) + 指纹去重
        ▼
conversationStore.messages  ←── 唯一 source of truth
        ▼
computeRounds() → conversationStore.rounds
        ▼
refreshUI() → fab / panel (Shadow DOM) 或 注入 Arena 原生侧边栏
```

- **触发链**：SPA 路由变化 → reset + rebuild；preScroll 完成 → rebuild；MutationObserver（800ms debounce，仅 chat 容器）；轮询 2s（capture）+ 30s（DOM 全量 refresh + 条件持久化）。
- **锚点绑定**：extract 给元素打 `data-ai-sidebar-id` → `cachedElements` → `bindDomAnchors` 按指纹反查绑定 `domId` → `scrollToRound` 滚动+闪烁。
- **持久化时机**：仅当消息数变化（30s 周期）或 rebuild 后（内容变更才写，避免 idle 时 storage churn）。

## 3. Storage schema（chrome.storage.local）

| Key | 内容 | 写者 | 读者 | 生命周期 |
| --- | --- | --- | --- | --- |
| `edge-ai-sidebar:session:{sessionId}` | `{messages, rounds, lastSavedAt, sessionId}` | conversationStore.saveToStorage（消息变更时） | loadFromStorage（/c/ 启动） | 永不过期，按 sessionId 累积 |
| `edge-ai-sidebar:folders` | `{folders: SessionFolder[], sessions: [id, SessionMeta][]}` | folders.saveToStorage（upsertSessionMetaFromStore / addSessionToFolder / createFolder） | initFolders + storage.onChanged 跨 tab 同步 | 永不过期 |
| `historyTitle_{sid}` | `string`（自定义标题） | historyTitles.ts 双击改名保存 | loadTitleCache（一次性全量）+ restoreTitle | 永不过期 |
| `fabPosition` | `{x, y}` | fab.ts saveFabPosition（拖动结束） | content.ts 本地 loadFabPosition（bootstrap） | 永不过期 |

### ⚠️ 已知不一致：标题存在**双写 + 三源**

可见标题由 3 个互不同步的来源决定：

1. `historyTitle_{sid}` —— 双击重命名写入，**只有这里能改 Arena 侧栏可见标题**（restoreTitle 只读这个 key）；
2. `sessionMeta.title`（folders key 内）—— 由 `conversationStore.saveToStorage()` 用 `document.title` 派生写入，或右键菜单 Rename 写入；
3. round title（store 内）—— 面板显示用。

**实际后果**：

- 双击改名 → 只写 `historyTitle_`，`sessionMeta.title` 不变 → Session Library 里显示的仍是旧标题；
- 右键 Rename → 只写 `sessionMeta.title`，但 Arena 侧栏可见标题来自 `historyTitle_` → **改完可见标题不变**（该功能实际是坏的）；
- 下次 store 持久化会用 `document.title` 再次覆盖 `sessionMeta.title`。

## 4. UI injection points

| 位置 | 内容 | 归属 |
| --- | --- | --- |
| Shadow DOM host `#__edge_ai_sidebar_host`（fixed 0×0, z-index max, closed shadow） | .fab / .panel / .summary-modal（导出、摘要） | ui/fab.ts, ui/panel.ts, ui/modals.ts |
| Arena 原生侧边栏 quick-nav 容器（`[class*=sidebar-wrapper]` child0→1→0→child2） | 🗂 Session Library 入口 + 内联展开区（asl-* 内联样式） | folders.ts |
| body 顶层 | 右键菜单 `.ai-sidebar-ctx` + `<style id="ai-sidebar-ctx-style">` | folders.ts |
| Arena 历史链接 `a[href*="/c/"]` | 双击改名（原地改 textContent / 最长 span） | historyTitles.ts |
| MAIN world（document_start） | inject-hook.js：fetch tee 旁路 RSC 流 → `__aiSidebarRsc` CustomEvent + dataset 写入 | public/inject-hook.js |

## 5. Module responsibilities（现状 vs 设计）

| 文件 | 行数 | 设计职责 | 当前真实职责 | 漂移 |
| --- | --- | --- | --- | --- |
| content.ts | 643 | bootstrap/route/observer | + preScroll 虚拟滚动强制加载（~120 行）、键盘、host debug attr、perf 埋点（TEMP-PERF-INSTRUMENT 标记"验收后删除"）、**本地重复的 loadFabPosition** | **漂移重** |
| conversationStore.ts | 560 | 单一数据源 | + rounds 计算（computeRounds）、指纹、persist、anchor 绑定、bootstrap 提取 | 可接受（内聚） |
| folders.ts | 702 | 文件夹 CRUD | + Arena 原生侧边栏注入（入口+内联区渲染）、右键菜单（自带 70 行 CSS）、storage.onChanged 监听 | **漂移最重** |
| historyTitles.ts | 209 | 双击改名 | + 标题缓存（loadTitleCache 一次性全量）、保守 textContent 改写（防 React 重渲循环） | 小幅漂移（重构合理） |
| extract.ts | 222 | DOM 提取 | 现状：只有 **2 个** selector（USER/ASSISTANT_MESSAGE_SELECTOR），README 声称 12 策略已过时；含 DOM 签名防重复扫描 | 漂移（文档） |
| capture.ts | 352 | API/WS/RSC 捕获 | + 模型名收割（harvestModelNames）；RSC 只探测不解析（Sprint 2.5 遗留） | 部分遗留 |
| rounds.ts | 14 | 用户态（摘要/隐藏） | roundSummaries **从未被写入**（死状态）；hiddenRoundIds 有 UI 但**不持久化** | 漂移（半死） |
| ui/panel.ts | 411 | rounds 列表 UI | 纯列表，Session Library 已全部移出（phase10a） | 干净 |
| ui/styles.ts | 482 | 样式常量 | 含 ~160 行 `.slm-*` **孤儿 CSS**（Sprint 9 overlay modal 已删） | 漂移（死代码） |

## 6. Known drift / technical debt（已取证）

1. **测试是镜像拷贝，不测真实代码**（最严重）：
   - 三个 test-*.cjs 全部内嵌自己的逻辑副本（注释自认 "Mirrors production behavior"），**不 import src/**；
   - `test-round-grouping.cjs` 测的 `groupIntoRounds` 已从生产代码删除（WIP 迁到 computeRounds）→ **测一个不存在的函数**；
   - `test-content-extract.cjs` 测 12 个 selector，生产只剩 2 个；
   - 结论：20/20 PASS 只能证明"镜像逻辑"，不能防生产回归。
2. **标题三源不同步**（见 §3）：右键 Rename 实际无效；双击改名不反映到 Session Library。
3. **`capture.apiConfig` / `capture.wsEvents` 只写不读**：accumulate 但无任何 UI 消费（Sprint 2.5 遗留）。
4. **`revision` 计数器只写不读**：TEMP-PERF-INSTRUMENT 埋点（"验收后删除"标记仍在代码里）。
5. **preScroll 复杂度集中在 content.ts**：retry/peek/stable-tick 三套机制 + preScrollActive 与 observer 的互斥耦合，无测试。
6. **`contextValid` 全局失效开关**：一处 lastError 永久杀死所有后续存储调用（historyTitles 故意绕过它 —— 注释自述这个矛盾）。
7. **README 已显著过时**：结构图指向不存在的 `src/service-worker/`、`scripts/cdp-smoke.cjs`；12 策略 vs 实际 2；未提 Session Library/右键菜单/文件夹。

## 7. Immediate cleanup candidates

**可立即删除（无 caller 或孤儿，已取证）：**

- `ui/styles.ts`：`.session-library-modal` + 全部 `.slm-*`（~160 行）
- `fab.ts` 的 `loadFabPosition` 导出（content.ts 有本地副本）→ 或反向：删 content.ts 本地副本统一用 fab.ts 版
- `capture.ts`：`teardownRscCapture`（无 caller）
- `folders.ts`：`renameFolder`、`deleteFolder`（无 caller；删除文件夹路径已无 UI）
- `rounds.ts`：`roundSummaries`（从未写入）
- `state.ts`：`historyState`（完全无引用）
- `types.ts`：`PersistedConversation`、`ConversationStoreState`、`PanelState`、`HistoryPayload`（仅自引用）
- `content.ts`：TEMP-PERF-INSTRUMENT 埋点（`__refreshCount`/`revision.*` 写不读）

**需确认后处理：**

- `capture.apiConfig` / `capture.wsEvents`：确认无未来 UI 计划后删
- `.final-evidence.json` / `.e2e-fab-evidence.json` / `.notepad.md`：验收遗留物，是否入库待定
- `tests/arena-mock.html`：用途待确认（无脚本引用）

**保留为 fallback（勿删）：**

- preScroll 的 peek 快速路径（Arena React 渲染时序依赖它）
- contextMenu/内联区的样式内联（避免再引入孤儿 CSS 文件）

## 8. Open questions

1. **标题模型最终形态**？建议收敛为单一来源（如：sessionMeta.title 为权威，historyTitle_ 迁移为 legacy 兼容读）—— 这是功能可见的坏点，优先级最高。
2. **测试策略**：是否把 test-*.cjs 改为真正 import src/（需要 TS 加载方案，如 tsx/ts-node 或把被测逻辑抽成纯模块）？否则测试继续是"纸面绿灯"。
3. **rounds.ts 去留**：roundSummaries 若无恢复计划，rounds.ts 只剩 hiddenRoundIds（不持久化）—— 是否并入 state.ts？
4. **RSC capture**（capture.ts setupRscCapture）：只探测不解析，Sprint 2.5 验收后未继续。留还是删？
5. **perf 埋点**：TEMP-PERF-INSTRUMENT 是否已过验收期，可整体移除？
6. **docs 同步顺序**：README 重写应在 §8.1（标题模型）定稿后做，避免二次返工。

---

### 推荐清理顺序（≤5 项）

1. 统一标题模型（§8.1）—— 功能坏点，用户可见
2. 删除 §7"可立即删除"全部死代码 + 孤儿 CSS
3. 测试改为 import 真实源码（或明确标注"镜像测试"的局限）
4. 移除 TEMP-PERF-INSTRUMENT 埋点
5. 基于定稿后的架构重写 README
