# 系统性重构方案（Architecture Refactor Plan）

> 生成于 `2951896`。所有结论均来自对 `src/` 的静态取证 + 真实源码运行验证，**无推测**。
> 配套基线文档：[rebaseline-phase10a.md](./rebaseline-phase10a.md)（架构快照）、[plan.md](./plan.md)（v0.1 已废弃）。
>
> **本文档回答四个问题**：架构怎么分层、技术路线怎么选、CI/测试规范怎么定、按什么顺序做。

---

## 0. 现状度量（取证基线）

| 指标 | 数值 | 取证方式 |
| --- | --- | --- |
| `src/` 代码量 | **4114 行** / 16 个 `.ts` + 1 个 `.js` | `wc -l` |
| 模块级可变状态 | **27 处** | `grep '^export let\|^let\|^export const .*new (Map\|Set)'` |
| 循环依赖 | **0**（依赖图是 DAG，这是唯一的结构好消息） | AST 级 import 图 + DFS |
| 被依赖最多 | `state.ts` ← 7 个模块 | 入度统计 |
| 依赖最多 | `content.ts` → 8 个模块 | 出度统计 |
| 最长函数 | `setupHistoryContextMenu` **206 行** | 括号配平扫描 |
| `chrome.storage` 手写样板 | **14 处** + `lastError` 8 处 + `typeof chrome` 2 处 | grep |
| 测试 | mirror 20 assertions（**不 import 生产代码**）+ real-source 24 assertions | 读脚本首行注释 |
| CI / formatter | **均无** | `ls .github` / `ls -a` |

**验证命令与结果**（本次重构前基线，后续每阶段都要复跑）：

```
npm test   → mirror 20/20 PASS，real-source 24/24 PASS
npm run lint → 20 warnings / 0 errors
npm run build → content.ts 53.75 kB │ gzip 16.53 kB；inject-hook 0.89 kB │ gzip 0.51 kB
```

---

## 1. 七类系统性病灶（按严重度）

### P1 — 状态散落：27 处模块级可变全局，且无生命周期 ⭐ 最严重

`state.ts` 是个 god module（`panel`/`fab`/`capture`/`timers`/`cachedElements`/`contextValid`），另外 6 个模块各自藏私有 `let`：

```
content.ts      7 个：lastRouteKey isFirstRender observer shadowRoot
                     preScrollDone preScrollInterval preScrollActive
capture.ts      5 个：lastRequestTs lastResponseTs pendingRequests _rscHandler _lastRscTs
                      （+ chatRounds / modelNameById 两个导出 Map）
extract.ts      1 个：lastExtractSig
folders.ts      1 个：librarySectionOpen
historyTitles.ts 2 个：titleCache cacheLoaded
ui/fab.ts       2 个：fabDragX fabDragY
```

**已验证的直接后果**：`resetSessionState()` 只重置了 5 项，下面 8 项在 SPA 路由切换后**全部残留**：

| 残留状态 | 后果 |
| --- | --- |
| `capture.lastRequestTs` / `lastResponseTs` | 新会话首个 capture 事件可能被当成"旧时间戳"丢弃 |
| `capture.pendingRequests` / `chatRounds` | 跨会话污染：上一个会话的未完成请求会绑到新会话的响应上 |
| `historyTitles.titleCache` / `cacheLoaded` | 标题缓存跨会话不刷新 |
| `folders.librarySectionOpen` | 内联区开合状态串台 |
| `fab.prevRoundIds` | 首个会话的轮次 id 被当成新会话的"上一帧"，`refreshUI` 快速路径可能误判"无变化"而跳过渲染 |
| `panel.searchQuery` | 上个会话的搜索词带进新会话 |

**另一个已验证 bug**：`preScrollDone` 从不重置，而 `startPreScroll()` **只在 bootstrap 调用一次**（`content.ts:599`）。
→ SPA 切到另一个 `/c/{id}` 会话后，preScroll 永不重跑，新会话的虚拟化历史消息不会被强制加载。

> 这也是 mirror test 存在的**根因**：状态是隐式全局，测试无法隔离，只能复制一份逻辑自己测。

---

### P2 — 分层倒置：数据层依赖 UI 注入层

```
conversationStore.ts (数据层)
        └── import → folders.ts (760 行：文件夹 CRUD + Arena 侧边栏 DOM 注入
                                  + 右键菜单 + 70 行内联 CSS + storage 同步)
```

`conversationStore.saveToStorage()` 内部直接：
1. 读 `document.title`
2. 用 `/\s*[-_] Arena.*$/i` 剥离站点后缀
3. 兜底拼中文字面量 `"未命名会话"`
4. 调 `upsertSessionMetaFromStore(...)`

→ 数据层知道 DOM、知道页面标题格式、知道 UI 层的会话索引。**store 无法脱离浏览器测试**。

---

### P3 — 平台知识散落，同一件事有 N 个版本

| 知识 | 重复位置 | 变体差异 |
| --- | --- | --- |
| 滚动容器 selector | `content.ts` **3 处**（L218 / L259 / L293） | 完全相同的长字符串抄了 3 遍 |
| `/c/` 路由解析 | **6 处 / 4 个文件** | **3 种正则变体** |
| 历史链接 selector | `folders.ts` + `historyTitles.ts` **2 处** | — |
| `chrome.storage` 防御样板 | **14 处** | 每处都自己写 `typeof chrome` + try/catch + lastError |

**正则变体不一致（潜在正确性 bug）**：

```
content.ts:140,161 / folders.ts:556   →  /^\/c\/([^/?#]+)/   ← 排除 #
historyTitles.ts:110,124 / modals.ts:269 →  /\/c\/([^/?]+)/  ← 未排除 #
```

对 `/c/abc#section` 这类 href，后三个会把 sessionId 解析成 `abc#section`。

---

### P4 — 生命周期与泄漏（已用真实源码实测）

`setupHistoryContextMenu()` **非幂等**，且无任何 teardown。它被调用两次：
`content.ts:589`（bootstrap）+ `content.ts:199`（**每次 SPA 路由变化**）。

实测（jsdom + 真实 `src/folders.ts`）：

```
第1次调用后 → document click=1  keydown=1  MutationObserver=1
第2次调用后 → document click=2  keydown=2  MutationObserver=2
第3次调用后 → document click=3  keydown=3  MutationObserver=3
期望 1/1/1，实际 3/3/3
```

每个 MutationObserver 都 `observe(document.body, { subtree: true })`，回调里执行 `document.querySelectorAll('a[href*="/c/"]')`。
→ **N 次路由切换后，每次 DOM 变动触发 N 次全 body 扫描**。这是随使用时长恶化的复合性能 bug。

全仓库**没有任何** `dispose()` / `destroy()` / `removeEventListener` 概念。

---

### P5 — 契约含糊 / 死状态

| 问题 | 证据 |
| --- | --- |
| `extractMessages()` 用 `[]` 同时表示"DOM 没变"和"没有消息" | `extract.ts:206 if (!domChanged(all)) return []` → 非幂等，连续调用两次结果不同 |
| `roundIndex` **写 8 处、读 0 处** | `types.ts:33` 声明；`capture.ts` 3 处、`conversationStore.ts` 4 处写 `-1`；`rebuildRounds` 每次全量 O(n) 赋值 —— **无任何读取者**，还被持久化进 storage 白占空间 |
| `fingerprint()` 只按「长度 + 前 80 字符」 | 见下 |
| `CONFIG` 死配置 | 全仓仅出现 1 次（定义处），`content.ts` 把 800/2000/30000 硬编码在 L210/213/233/246 |
| `EXTRACT_COOLDOWN_MS` 有两个矛盾定义 | `state.ts:7` = **500**，`extract.ts:11` = **800**，**两者都无读取者** |
| `addDomMessages` | 只有定义，**0 caller** |

**fingerprint 实测（真实 `refreshStore` + `computeRounds`）**：

```
输入 6 条（用户连发 3 次「继续」+ 3 段不同回答）
→ store.messages.length = 4      (应为 6)
→ computeRounds().length = 1     (应为 3)
```

跨源去重本身是设计（dom 与 capture 抓同一条要合并），但指纹**没有位置/轮次维度**，
用户真的重复发同一句话时轮次就塌了 → 面板少显轮次、跳转/复制/导出跟着错。

---

### P6 — 测试策略倒置

| 测试 | 是否 import 生产代码 | 实测问题 |
| --- | --- | --- |
| `test-content-extract.cjs` | ❌ 首行自认 "does NOT import src/" | 测 `data-message-author-role` / `data-role`，**生产用的是 `bg-surface-raised` / `bg-surface-primary`** |
| `test-round-grouping.cjs` | ❌ | 测的 `groupIntoRounds` 是**它自己文件第 14 行定义的**，生产代码 0 处 |
| `test-conversation-store.cjs` | ❌ | 内嵌 `upsertMessage` / `bindDomAnchors` 的副本 |
| `test-src-*.ts` ×3 | ✅ | 仅覆盖 `computeRounds` / `conversationStore` / `resolveSessionTitle` 三个纯函数 |

**零覆盖的模块**：`content.ts`、`folders.ts`、`extract.ts`、`ui/*`、`historyTitles.ts`、`capture.ts`
—— 也就是**所有碰 DOM 和生命周期的部分，恰好是 bug 最密集的部分**（P1/P3/P4 全在这里）。

其他：`tests/arena-mock.html` 用旧 selector 已脱节；`e2e-floating.cjs` 硬编码 `D:/edge-ai-sidebar` + `msedge.exe` 且 `require('ws')` 而 `package.json` 无 `ws` 依赖 → 任何机器上都跑不起来。

---

### P7 — 复杂度热点

```
206 行  folders.ts      setupHistoryContextMenu          ← 含 70 行 CSS 字符串
141 行  ui/panel.ts     ensurePanelSkeleton
110 行  folders.ts      renderArenaSessionLibrarySection
104 行  ui/modals.ts    showSummaryModal
 98 行  ui/panel.ts     createRoundEl
 94 行  conversationStore.ts  computeRounds
 88 行  content.ts      refreshUI                        ← 手写 reconciler
```

`content.ts:refreshUI` 用 `fab.prevRoundIds` / `panel.prevIsOpen` / `panel.prevSearchActive`
三个缓存字段手搓了一个"上一帧对比"快速路径 —— 等于手写 reconciler，且这三个字段正是 P1 里路由切换不重置的残留源。

---

## 2. 目标架构

### 2.1 分层与依赖规则

**唯一规则：依赖只能向下，同层不互相 import。**

```
┌─────────────────────────────────────────────────────────────┐
│ entry      content.ts                                       │
│            只做装配：建 store → 接 adapter → 启动 loop       │
│            持有 disposers[]，路由切换时统一 dispose + 重建    │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ ui         shadowHost / panel/* / fab / modals / styles     │
│            只读 store，只发意图（intent），不碰业务逻辑        │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌─────────────────────────────────────────────────────────────┐
│ features   capture / extract / prescroll / sessions /       │
│            titles / navigate                                │
│            有副作用的流程编排；每个 setup* 返回 Disposer       │
└───────────────────────────┬─────────────────────────────────┘
                            ↓
┌──────────────────────────┬──────────────────────────────────┐
│ app                      │ platform                          │
│  store.ts  单一状态容器   │  storage.ts  唯一 chrome.storage  │
│  config.ts 唯一 CONFIG    │  route.ts    唯一 /c/ 正则        │
│  loop.ts   定时器/observer│  arenaDom.ts 唯一 Arena selector  │
│  （可被 ui/features 读）  │  （可被任意上层用；不反向依赖）    │
└───────────┬──────────────┴──────────────────────────────────┘
            ↓
┌─────────────────────────────────────────────────────────────┐
│ core       types / fingerprint / rounds / merge /           │
│            titles / serialize                               │
│            纯函数：零 DOM、零 chrome、零 import 上层          │
│            → 100% 可在 node 里单测，无需 jsdom               │
└─────────────────────────────────────────────────────────────┘
```

### 2.2 目标目录

```
src/
├── core/                       # 纯逻辑，零副作用
│   ├── types.ts                # 现 types.ts，删掉 roundIndex
│   ├── fingerprint.ts          # 修复版（含轮次维度）
│   ├── rounds.ts               # computeRounds（从 conversationStore 抽出）
│   ├── merge.ts                # upsert / 三源优先级合并（纯函数版）
│   ├── titles.ts               # 现 titleResolver.ts
│   └── serialize.ts            # buildJson / buildMarkdown / buildSummaryPrompt
├── platform/                   # 唯一允许碰 chrome / location / Arena DOM 的地方
│   ├── storage.ts              # get/set/remove + 错误策略 + 可注入 fake
│   ├── route.ts                # getSessionId() / isSessionRoute() / routeKey()
│   └── arenaDom.ts             # 所有 selector 常量 + 容器查找
├── app/
│   ├── store.ts                # AppStore：唯一状态 + reset(sid) + dispose() + subscribe()
│   ├── config.ts               # 唯一 CONFIG（含 800/2000/30000）
│   └── loop.ts                 # observer + 定时器，返回 Disposer
├── features/
│   ├── capture/                # chatCapture.ts / rscProbe.ts / models.ts
│   ├── extract.ts
│   ├── prescroll.ts            # 从 content.ts 抽出，含 preScrollDone 归位
│   ├── sessions.ts             # folders 的纯 CRUD（不含 DOM）
│   ├── titles.ts               # historyTitles 的 DOM 改写
│   └── navigate.ts             # scrollToRound
├── ui/
│   ├── shadowHost.ts           # host + closed shadow 生命周期
│   ├── panel/{skeleton,roundItem,list,highlight}.ts
│   ├── fab.ts
│   ├── modals/{export,summary}.ts
│   └── styles.ts
└── content.ts                  # 装配层，目标 < 120 行
```

### 2.3 三个关键结构性改动

**① 斩断 `conversationStore → folders`（P2）**
store 不再 import folders。改为 store 发事件，由 `app` 层订阅后写 sessionMeta：

```ts
// app/store.ts —— 只发意图，不认识 folders
onChange(cb: (s: StoreSnapshot) => void): Disposer

// content.ts —— 装配时才把两者接起来
store.onChange((s) => sessions.upsertMeta(s.sessionId, s.title, s.roundCount, s.messageCount));
```

**② 状态收敛为单一 AppStore（P1）**
27 处模块级 `let` → 全部进 store 或闭包。`reset(sessionId)` 一次清干净（消灭 P1 的 8 项残留 + preScrollDone bug）：

```ts
class AppStore {
  reset(sessionId: string): void   // 所有会话相关状态一次清空
  dispose(): void                  // 所有 timer / observer / listener
}
```

**③ 所有 `setup*` 返回 Disposer（P4）**

```ts
type Disposer = () => void;
function setupHistoryContextMenu(): Disposer   // 幂等 + 可卸载
```

`content.ts` 维护 `disposers: Disposer[]`，路由切换时 `disposers.forEach(d => d())` 再重建。
→ 泄漏在结构上不可能发生，且**可被测试断言**（见 §4.4）。

---

## 3. 技术路线选型

| 议题 | 现状 | 建议 | 理由 |
| --- | --- | --- | --- |
| UI 框架 | Vanilla DOM + closed shadow | **保持 vanilla，但加一个 ~30 行 `h()` helper** | 53 kB / 0 运行时依赖是扩展的真实优势。现有代码的问题不是"没用框架"，是"没有分层"。引 Preact/lit 只增加供应链风险，不解决 P1–P4 |
| 测试 runner | 自写 assert 脚本 + 散装 `node`/`tsx` 调用 | **Vitest** | 与 Vite 同源；内置 jsdom 环境（P6 的 DOM 测试正好需要）；内置覆盖率；watch 模式；`describe/it` 比手写 assert 列表可维护 |
| 格式化 | 无 | **Prettier + .editorconfig** | 现有风格已不一致：`background.ts` 用单引号无分号，其余双引号带分号。oxlint 只 lint 不 format |
| Lint | oxlint（开着 react 插件） | **保留 oxlint，移除 react 插件** | 项目无 React；`jsx: "react-jsx"` 也应从 tsconfig 删掉 |
| 类型严格度 | tsconfig 未写 `strict` | **显式写 `strict: true`** | 实测 TS 6.0.3 默认已启用 strict 族检查（探针文件在无 flag 时也触发 TS7006/TS18047），且**全仓 0 错误通过** → 显式化是零成本的，能防止未来版本行为漂移 |
| 构建 | Vite 8 + @crxjs | **不变** | 构建 68 ms，无需动 |
| E2E | `e2e-floating.cjs`（Windows 硬编码 + 缺依赖） | **移到 `scripts/manual/` 并标注，或删除** | 不可运行；真正的自动化交给 Vitest + jsdom |

---

## 4. 分阶段路线图

> 原则：**每阶段独立可交付、可回滚、有明确验收**。禁止跨阶段大爆炸式重写。

### Phase 0 — 安全网与地基（不改任何行为） ✅ 已完成

先建防护，再动刀。

- [x] GitHub Actions：`install → format:check → lint → typecheck → test → build`
- [x] Prettier + `.editorconfig`，全仓格式化（**独立 commit**，与逻辑改动分离便于 review）
- [x] `.oxlintrc.json` 移除 react 插件；tsconfig 移除 `jsx: "react-jsx"`、显式加 `strict: true`
- [x] 删死代码：`CONFIG`、`addDomMessages`、`EXTRACT_COOLDOWN_MS`（两处）、`INBOX_ID`/`ARCHIVE_ID` 导出、`roundIndex`（含 `rebuildRounds` 的空转循环）、`src/background.ts`
- [x] **计划外但必须做**：修锁文件 —— 28 条 `resolved` 指向已死的 `registry.npmmirror.com`，`npm ci` 直接 ECONNRESET，CI 根本跑不起来
- **验收结果**：

| 项 | 结果 |
| --- | --- |
| CI 全链路 | **ALL GREEN，11.94 s**（install 3.4 / format 1.5 / lint 0.2 / typecheck 2.6 / test 1.3 / build 3.0） |
| 纯格式化证明 | **bundle 哈希逐字节相同** `content.ts-Bv-vwOyh.js`（格式化前后同一个 hash） |
| 死代码清理 | 净 **−60 行**；`CONFIG` / `addDomMessages` / `EXTRACT_COOLDOWN_MS` / `roundIndex` 在 `src/` 中出现次数均为 **0** |
| bundle | 53.75 → **53.53 kB**；gzip 16.53 → **16.48 kB** |
| 测试 | 断言数不变（mirror 20/20，real-source 10+8+6）→ 未删到被测逻辑 |
| lint | 20 warnings / 0 errors（移除 react 插件前后一致，说明那两条规则从未触发） |

**Phase 0 提交序列**（每步独立可回滚）：

```
a5dccca refactor: remove dead code (net -60 lines)
8f44c72 chore: pin strict mode explicitly, drop React leftovers from config
693e455 ci: add GitHub Actions pipeline (format/lint/typecheck/test/build)
987beef style: add Prettier + EditorConfig, format codebase (pure formatting)
73afdb5 fix(ci): repoint 28 lockfile entries off dead npmmirror registry
f3d511d docs: add systematic refactor plan (Phase 0-6)
```

**Phase 0 期间发现的两处新事实**（已写入后续阶段的输入）：

1. **`strict` 其实早就生效** —— TS 6.0.3 默认启用 strict 族。`--showConfig` 里看不到 `strict`，但往 `src/` 放一个含隐式 any + null 解引用的探针文件，**不带任何 flag 也触发 TS7006 / TS18047**。全仓 0 错误 → 显式化是零成本，且能防止未来编译器默认值漂移。
2. **Prettier 的 `tabWidth` 由 `.editorconfig` 决定** —— 现有代码是按 `tabWidth 2` 格式化的。实测：`tabWidth 2` → src/ 只动 31 行；`tabWidth 4` → 动 207 行。配置里已写死并注释原因。

**推迟到 Phase 3 的严格项**（非零成本，需真实代码改动）：

| flag | 新增错误数 |
| --- | --- |
| `noUncheckedIndexedAccess` | 9（**建议优先**，正好覆盖 rounds/messages 的数组越界风险） |
| `noPropertyAccessFromIndexSignature` | 20 |
| `exactOptionalPropertyTypes` | 10 |
| `noImplicitOverride` | 0 → 已在 Phase 0 顺手加上 |

### Phase 1 — 修用户可见 bug（每个 bug 先加失败测试） ✅ 已完成

- [x] **fingerprint 加轮次维度**（P5）—— 修「重复短消息塌陷」
- [x] **`setupHistoryContextMenu` 幂等 + 返回 Disposer**（P4）
- [x] **路由正则统一为 `[^/?#]`**（P3）
- [x] **`preScrollDone` 重置**（P1 的一部分）
- [ ] ~~`resetSessionState` 补全 8 项残留~~ → **改为并入 Phase 4**，见下
- **验收结果**：

| 项 | 结果 |
| --- | --- |
| 测试 | **24 → 59**（Vitest，7 个文件），每个 bug 都先确认红灯 |
| CI | 本地 + GitHub 双绿，最后一次 48 s |
| bundle | 53.53 → **54.16 kB**（gzip 16.48 → 16.68），换来 4 个 bug 修复 |
| `content.ts` | 638 → **487 行** |

**四处修复的实际内容**：

1. **`fix(route)`** —— 新建 `src/platform/route.ts`（目标 platform 层的第一个模块），9 个调用点收敛为 2 个常量。精确界定影响面：只有 `historyTitles.ts` 真的会出错（它匹配 `href`，可带 fragment）；`modals.ts` 匹配的是 `location.pathname`，永不含 `#`，属潜在不一致。
2. **`fix(folders)`** —— `contextMenuDisposer` 守卫 + 返回 Disposer；新增 `types.ts` 的 `Disposer` 类型。
3. **`fix(store)`** —— `SidebarMessage` 新增 `occurrence` 字段，去重键从「内容」改为「内容 + 同内容第 N 次」。**没有**把序号拼进 fingerprint 字符串 —— 用户文本本身可以含 `#`，字符串分隔会有歧义，独立字段没有这个问题。`bindDomAnchors` 因此无需改动。
4. **`fix(prescroll)`** —— 抽出 `src/features/prescroll.ts` + `resetPreScroll()`，路由切换改为先滚动再重建。

**两项计划调整**（都已在 commit message 里说明）：

- **Vitest 从 Phase 6 提前到 Phase 1**：Phase 1 的验收标准是"每个 bug 先加失败测试"，而 4 个 bug 里有 2 个没有 DOM 测不了。3 个 tsx 脚本逐条迁移（10+8+6 = 24 断言 → 24 tests）。**故意不关** worker 隔离（Vitest 提示可省 ~900ms）—— `conversationStore` 是模块级单例，文件间隔离是正确性要求。
- **`preScroll` 抽取从 Phase 5 提前**：`content.ts` 顶层有 bootstrap IIFE，import 即执行副作用，不抽出来这个修复根本无法测试。

**bug 3 的范围修正（用户决策）**：原计划"补全 `resetSessionState` 的 8 项残留"是错的。这 8 项（`capture.lastRequestTs`/`lastResponseTs`/`pendingRequests`/`chatRounds`、`historyTitles.titleCache`/`cacheLoaded`、`folders.librarySectionOpen`、`fab.prevRoundIds`、`panel.searchQuery`）是 **P1「无状态收敛」的症状**，现在给每个模块加 `resetXxx()` 导出等于写一批 Phase 4 的 `AppStore.reset(sessionId)` 会立刻删掉的代码。**改为并入 Phase 4**，Phase 1 只修了其中真正独立的 `preScrollDone`。

**Phase 1 期间 CI 抓到的自身错误**（记录以免重犯）：新写的 `context-menu.test.ts` 有 3 个类型错误，Vitest 只转译不检查类型所以放过了，`tsc -b` 拦住。→ 这正是 typecheck 必须独立成一步的价值，第一天就兑现。

### Phase 2 — 抽 `platform/` 层 ✅ 已完成

- [x] `platform/storage.ts`：14 处手写样板 → 1 个 adapter，支持注入 fake。**干掉 `contextValid` 全局失效开关** → 改为 per-call 错误处理
- [x] `platform/route.ts`：9 处正则 → 1 处（实际在 Phase 1 提前完成，见下）
- [x] `platform/arenaDom.ts`：历史链接 selector、滚动容器 selector、quick-nav 路径
- **验收**：platform 层真实源码测试 32 个（`storage.test.ts` 17 + `arenaDom.test.ts` 15）；`chrome.storage.local` 代码站点 14 → **1**（仅 adapter 内）

**实测验收数据**

| 指标 | 重构前 | 重构后 |
| --- | --- | --- |
| `chrome.storage.local` 代码站点 | 14（5 个文件） | **1**（仅 `platform/storage.ts:41`） |
| `contextValid` / `invalidateContext` | 6 处引用 + 2 处定义 | **0**（已从 `state.ts` 删除） |
| `typeof chrome` 守卫 | 8 | **1**（adapter 内） |
| 裸 `a[href*="/c/"]` 代码站点 | 3 | **0**（`HISTORY_LINK_SELECTOR`） |
| Vitest 测试 | 85 | **117** |
| 覆盖率 statements | 23.10% | **26.87%**（`arenaDom` 100%、`storage` 84.9%） |
| Bundle | 54.16 kB | **53.99 kB** / gzip 16.80 |

**`contextValid` 为什么必须死**：它是一个单向开关——任意一次 `lastError` 就把整个 tab 的存储永久禁用，且无法恢复。`historyTitles.ts` 甚至专门写了注释说明它**故意绕过**这个标志，因为标志"太有破坏性"。这是"用 workaround 绕 workaround"。现在每次调用独立处理错误：失败只影响该次调用（`storageGet` → `undefined`，`storageSet`/`storageRemove` → `false`），且 adapter **永不 reject**，所以存储故障不可能击穿 content script。回归测试 `a failed get does not disable the next get` 直接钉住这个性质。

**两处计划偏差**

1. **滚动容器 selector 实际只剩 1 处**，不是计划里写的 3 处。原计划记的是 `content.ts` L218/L259/L293 三个调用点；Phase 1 为修 preScroll bug 把 `findScrollContainer` 整体抽进 `features/prescroll.ts` 时，3 个调用点已自然收敛为 1 处。本阶段只需把那个 selector 常量搬进 `arenaDom.ts`。
2. **`platform/route.ts` 在 Phase 1 已完成**（commit `f941975`）。原因是修 route bug 必须先有这个模块，否则 9 个调用点里改一个就漏八个。

**顺带修正的可测性缺陷**：`findArenaQuickNavContainer()` 那条 `children[0] → [1] → [0] → [2]` 路径原先埋在 760 行的 `folders.ts` 里，无法测试。现在搬进 `arenaDom.ts` 并有 7 个测试覆盖各级缺失场景——Arena 改版时这些测试会**指名道姓地红**，而不是扩展静默渲染不出东西。

**本轮记录的自身错误**（避免重犯）：上一轮报告"棘轮阈值已抬到 23/24/27/23"是**错的**。python 替换用了 2 个 tab 缩进，`vitest.config.ts` 实际是 3 个 tab，没匹配上，而 `print("ok")` 无条件执行掩盖了失败。文件里一直是 12/12/14/12。现已按实测下限改为 **26/28/32/26**，并用"临时设 99 → exit 1"验证闸门确实生效。教训：**替换后必须回读确认，不能只看脚本是否报错。**

### Phase 3 — 抽 `core/` 层（纯函数化）

- [ ] `computeRounds` / merge / fingerprint 从 `conversationStore` 抽到 `core/`
- [ ] `buildJson` / `buildMarkdown` / `buildSummaryPrompt` 从 `ui/modals.ts` 抽到 `core/serialize.ts`（当前它们和 DOM 弹窗代码混在一个文件里）
- [ ] **斩断 `conversationStore → folders`**（P2）：改为 `store.onChange` 订阅
- **验收**：`core/` 覆盖率 ≥ 90%；**删除 3 个 mirror `.cjs`**（被真实测试取代，20 个纸面 assertion 归零但真实覆盖率上升）

### Phase 4 — 状态收敛为 AppStore

- [ ] 27 处模块级 `let` → 收进 `store` 或闭包
- [ ] `store.reset(sessionId)` / `store.dispose()`
- [ ] 所有 `setup*` 返回 Disposer；`content.ts` 维护 `disposers[]`
- [ ] 简化 `refreshUI` 的手写 reconciler（3 个缓存字段随状态收敛自然消失）
- **验收**：**生命周期回归测试** —— "模拟 10 次路由切换后，document 监听器数量不增长"（正是本文档 §1 P4 用过的探针手法）

### Phase 5 — UI 层拆分（用户要求的"文件拆解美化"）

- [ ] `folders.ts` 760 行 → `features/sessions.ts`（纯 CRUD）+ `ui/arenaSidebar.ts`（注入）+ `ui/contextMenu.ts`（右键菜单，CSS 移出）
- [ ] `content.ts` 638 行 → 装配 + `app/loop.ts` + `features/prescroll.ts`
- [ ] `ui/panel.ts` 409 行 → `skeleton` / `roundItem` / `list` / `highlight`
- [ ] `ui/modals.ts` 372 行 → `export` / `summary`（纯逻辑已在 Phase 3 抽走）
- [ ] 引入 `h()` helper 替代 createElement 流水账
- **验收**：无文件 > 300 行；无函数 > 80 行；`npm run build` 体积不增

### Phase 6 — 测试规范定型

- [ ] Vitest 落地，分层策略：
  - `core/` → 纯单测，无环境
  - `platform/` → 注入 fake chrome
  - `features/` + `ui/` → jsdom
  - **生命周期回归** → 监听器/observer 计数断言
- [ ] 覆盖率门槛（`core/` 90%、整体 70%），CI 阻断
- [ ] 修 `tests/arena-mock.html` 用真实 selector，或改为 `__fixtures__/arena-dom.ts` 由测试代码生成
- [ ] `e2e-floating.cjs` 移到 `scripts/manual/` + README 标注，或删除
- **验收**：CI 上覆盖率报告可见；故意引入一个回归（如把 fingerprint 改回去）能被 CI 拦住

### Phase 7+ — 增量 Feature

地基干净后再做新功能。候选（来自 README Roadmap + 本次取证）：

- 隐藏轮次持久化（`hiddenRoundIds` 目前是纯 `Set`，刷新即丢，但面板有 ✕ 按钮）
- 右键 Rename 去掉 `prompt()`，改内联编辑
- Arena 侧边栏注入去掉 `children[0]→[1]→[0]→[2]` 硬编码索引，改特征匹配 + 失败上报
- 跨站点适配（chatgpt.com / claude.ai）—— `platform/arenaDom.ts` 抽好后这是自然的扩展点

---

## 5. 依赖顺序说明（为什么不能跳）

```
Phase 0 (安全网)  ──┬─→ Phase 1 (修 bug)
                    │
                    └─→ Phase 2 (platform) ─→ Phase 3 (core) ─→ Phase 4 (store) ─→ Phase 5 (拆分)
                                                                                        │
                                                            Phase 6 (测试规范) ←─────────┘
```

- **Phase 0 必须最先**：没有 CI 和 formatter，后续任何重构都无法证明"行为未变"
- **Phase 2 早于 Phase 3**：`core/` 要纯，前提是 `platform/` 先把 chrome/DOM 隔离出去
- **Phase 4 晚于 Phase 3**：状态收敛时业务逻辑已经是纯函数，store 才可能薄
- **Phase 5 最后做拆分**：先分层再拆文件，否则只是把乱码搬进更多文件

---

## 6. 风险与对策

| 风险 | 对策 |
| --- | --- |
| 重构引入回归（当前 DOM 相关零覆盖） | Phase 0 先建 CI；Phase 1 每个 bug 先写失败测试；Phase 2/3 每抽一层就补该层测试 |
| Arena DOM 结构变化导致 adapter 失效 | `platform/arenaDom.ts` 集中所有 selector + 查找失败时 `console.warn` 上报（当前是静默返回 null） |
| 格式化 commit 淹没真实 diff | Prettier 独立成 commit，并在 PR 描述标注"纯格式化" |
| 体积膨胀 | 每阶段验收都跑 `npm run build` 并记录 bundle 体积（基线 53.75 kB / gzip 16.53 kB） |
| 单人项目重构动力衰减 | 每阶段独立可交付；Phase 0+1 合计约 1 天，先拿到可见收益 |

---

## 附：本次取证用到的可复现验证手法

后续每阶段都应复跑，作为"行为未变"的证据：

```bash
npm ci && npm test && npm run lint && npm run build
```

针对 P4/P5 这类需要运行态的问题，用 jsdom + 真实源码探针（临时脚本，跑完即删，不入库）：

```ts
// .probe/leak.ts —— 计数 document 监听器，断言幂等性
import "./setup";                                  // 装 jsdom 全局 + 打补丁的 addEventListener
import { setupHistoryContextMenu } from "../src/folders";
for (let i = 1; i <= 3; i++) setupHistoryContextMenu();
// 断言 click/keydown/MutationObserver 计数恒为 1
```

Phase 4 应把这类探针**固化为正式测试**。
