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

### Phase 3 — 抽 `core/` 层（纯函数化） ✅ 已完成

- [x] `computeRounds` / merge / fingerprint 从 `conversationStore` 抽到 `core/`
- [x] `buildJson` / `buildMarkdown` / `buildSummaryPrompt` 从 `ui/modals.ts` 抽到 `core/serialize.ts`
- [x] **斩断 `conversationStore → folders`**（P2）：改为 `onStoreChange` 订阅
- [x] **删除 3 个 mirror `.cjs`**
- **验收**：`src/core/` 覆盖率 **99.17% stmts / 100% funcs / 100% lines**（branch 89.74%）—— 达标

**新增模块**

| 模块 | 内容 | 覆盖率 |
| --- | --- | --- |
| `core/fingerprint.ts` | `fingerprint` / `baseKey` / `withOccurrences`（原为 `conversationStore` 私有，无法单测） | 100% |
| `core/rounds.ts` | `computeRounds` | 97.72% |
| `core/serialize.ts` | `buildSummaryPrompt` / `buildExportRounds` / `buildJson` / `buildMarkdown`（原为 `exportConversation` 内的闭包，与 DOM 弹窗代码混在一起） | 100% |

**实测验收数据**

| 指标 | 重构前 | 重构后 |
| --- | --- | --- |
| `conversationStore` → `folders` import | 1（数据层依赖 UI 注入层） | **0** |
| `src/ui/modals.ts` | 373 行 | **271 行** |
| `src/conversationStore.ts` | ~530 行 | **400 行** |
| Vitest 测试 | 131 | **162** |
| 覆盖率 statements | 26.87% | **31.44%** |
| mirror `.cjs` 纸面 assertion | 20 | **0**（删除） |
| Bundle | 53.99 kB | 54.50 kB / gzip 16.95 |

**分层倒置是怎么斩断的**：`conversationStore.saveToStorage()` 原先直接调 `folders.upsertSessionMetaFromStore()`，让数据层依赖 760 行的 UI 注入层。现在 store 暴露 `onStoreChange(listener): Disposer`，成功写入后 emit 一个 `StoreSnapshot`（`sessionId` / `messageCount` / `roundCount` / `firstRoundTitle`），由 `folders.setupSessionMetaSync()` 订阅。顺带把 `document.title` 的读取也移到了订阅方——那是 DOM 知识，同样不该待在数据层。9 个测试钉住契约：emit 时机（仅写入成功后）、快照内容、多订阅者、Disposer 生效、**抛异常的订阅者不能拖垮 store 也不能饿死其他订阅者**。

**为什么能安全删掉 mirror `.cjs`**（逐个面比对，不是想当然）：

| mirror 覆盖面 | 用例数 | 被谁取代 |
| --- | --- | --- |
| round 分组（含"60 条全 assistant → 1 轮"的原始 bug 场景） | 6 | `rounds.test.ts`（10） |
| store 去重 / domId 锚点绑定 / stale 缓存清理 | 9 | `store.test.ts`（8）+ `dedup.test.ts`（6） |
| round preview 字段与截断长度 | 6 | `rounds.test.ts` |
| 标题回退链 | 1 | `titles.test.ts`（6，100% 覆盖） |
| extract 选择器 | 4 组 | `extract.test.ts`（16）——且 mirror 断言的 `data-message-author-role` / `data-role` **生产代码早已不用**，属于**误导**而非保护 |

**遗留**：`tests/arena-mock.html` 与 `scripts/e2e-floating.cjs` 仍用旧 selector 且硬编码 `D:/edge-ai-sidebar` + `require('ws')`（`package.json` 无 `ws` 依赖），任何机器上都跑不起来 → 归入 Phase 5/6 处理。

### Phase 4 — 状态收敛为 AppStore ✅ 已完成

- [x] 新增 `app/store.ts`：`resetSessionState(sessionId)` + disposer 注册表
- [x] 8 个残留状态全部纳入 reset（含 Phase 1 折叠进来的 bug 3）
- [x] 9 个 `setup*` **全部**返回 `Disposer`；`content.ts` 用 `registerDisposer` 收集
- [x] `refreshUI` 的 3 个缓存字段收敛为 1 个派生 key
- **验收**：生命周期回归测试 —— **10 次路由切换后 document 监听器数量持平**

**实测验收数据**

| 指标 | 重构前 | 重构后 |
| --- | --- | --- |
| 未被 reset 的会话级状态 | 8 | **0** |
| `setup*` 返回 `Disposer` | 3 / 9 | **9 / 9** |
| `refreshUI` 缓存前态字段 | 3（`prevIsOpen` / `prevSearchActive` / `fab.prevRoundIds`） | **1**（`panel.lastRenderKey`） |
| Vitest 测试 | 162 | **188** |
| 覆盖率 statements | 31.44% | **38.58%**（`src/app` 100%、`state.ts` 100%） |
| Bundle | 54.50 kB | 55.52 kB / gzip 17.26 |

**8 个残留状态现在全部由 `resetSessionState(sessionId)` 清零**：`capture.lastRequestTs` / `lastResponseTs` / `pendingRequests` / `chatRounds`（经 `resetCaptureState`）、`historyTitles.titleCache` / `cacheLoaded`（经 `resetTitleCache`）、`folders.librarySectionOpen`（经 `resetLibrarySection`）、`panel.searchQuery` + `panel.lastRenderKey`。各模块自己暴露 reset 函数，`app/store.ts` 只负责编排——状态归谁所有，就由谁负责清。

**故意不 reset 的**（并写进了代码注释）：`fab.position`（跨会话持久化）、`panel.reverseOrder`（用户偏好）、`modelNameById`（页面级，重扫要全文匹配 script）、`foldersState`（持久化索引）、`timers` / `observer` / `shadowRoot`（由 bootstrap 持有）。

**验收测试确认会红，不是空转**：把 `setupHistoryContextMenu` 的幂等守卫删掉，10 次路由切换让 document 监听器从 2 涨到 **24**（3 次调用 2 → 6）；恢复守卫后持平。同样地，从 `resetSessionState` 里删掉 5 个 reset 调用会红 3 个测试——**这次探针暴露出 `resetTitleCache` / `resetLibrarySection` 原本没有断言覆盖**，已补上行为断言并复验（删掉即红：`expected 'Old Title' to contain 'New Title'`、`expected 'none' to be 'block'`）。

**一处计划偏差（计划里的预期是错的）**：计划写"3 个缓存字段随状态收敛**自然消失**"。实际不会——任何 reconciler 都必须和某个前态比较。真正能做的是把 3 个各自为政的 ad-hoc 字段收敛成 1 个派生值 `renderKey()`（纯函数，`core/renderKey.ts`，10 个测试）。收敛过程还顺带修掉两个真 bug：

1. 旧 fast-path 只比较**轮数 + 最后一个 id**，所以 `["a","b","c"] → ["z","y","c"]`（中间轮变了）被判定为"没变化"，面板继续显示过期行。
2. `reverseOrder` **完全不在比较范围内**，所以在对话未变时切换排序会命中 fast-path 而不重渲染。

**teardown 有了真实消费者**：bootstrap 里 `window.addEventListener("pagehide", disposeAll, { once: true })`，注册表现在拥有本扩展装过的每一个监听器和定时器。

### Phase 5 — UI 层拆分（用户要求的"文件拆解美化"）✅ 已完成

计划里的行数是取证时的估值，下表左列是 **Phase 4 基线 `7ae78d8` 的实测值**（`folders.ts` 实为 759 行，非 760；`content.ts` 实为 517 行，非 638——因为 Phase 1 已把 `prescroll` 抽走、Phase 3 已把 `modals` 纯逻辑抽走）。

**文件拆分**（全部按 section marker 切，除注明外未改写逻辑）：

| 原文件 | 基线 | 拆分后 | 新增模块 |
| --- | --- | --- | --- |
| `folders.ts` | 759 | 已删除 | `features/sessions.ts` 227 + `ui/arenaSidebar.ts` 292 + `ui/contextMenu.ts` 224 |
| `content.ts` | 517 | **240** | `app/loop.ts` 149 + `ui/keyboard.ts` 88 + `ui/render.ts` 114 |
| `conversationStore.ts` | 436 | **276** | `features/bootstrapExtract.ts` 114 + `features/roundNav.ts` 66 |
| `ui/panel.ts` | 413 | **17**（聚合器） | `ui/panel/{skeleton 161, roundItem 151, list 68, highlight 54}` |
| `ui/styles.ts` | 319 | **19**（聚合器） | `ui/styles/{base, list, contextMenu, arenaSidebar}` |
| `capture.ts` | 324 | **22**（聚合器） | `capture/{chatCapture 131, models 119, rsc 91}` |

**超长函数**（基线 6 个 → **0**）：

| 函数 | 基线 | 现在 | 做法 |
| --- | --- | --- | --- |
| `setupHistoryContextMenu` | 222 | **38** | 用 `h()` 重写；58 行内联 CSS → `ui/styles/contextMenu.ts` |
| `renderArenaSessionLibrarySection` | 110 | **8** | 拆成 `buildFolderList` / `buildNewFolderInput` / `buildSessionList` |
| `showSummaryModal` | 104 | **40** | 抽 `pasteIntoChat` / `openInNewChat` / `buildSummaryActions`，用 `h()` 重写 |
| `computeRounds` | 94 | **73** | 开场助手轮的字面量重复出现两次（除 `index` 外逐字相同）→ `makeLeadRound()` |
| `refreshUI` | 91 | **4** | 整体外移到 `ui/render.ts`，按 FAB / 面板 / host 属性分三个函数 |
| `startPreScroll` | 81 | **20** | 抽 `retryUntilContainer` / `scrollUntilStable` |

- [x] `h()` helper（`ui/dom.ts`）替代 createElement 流水账，12 个测试，0 依赖
- [x] **验收达成**：文件 > 300 行 **6 → 0**；函数 > 80 行 **6 → 0**；bundle **55.52 → 55.39 kB**（gzip 17.60），不增反降
- 测试 188 → **218**（18 文件），覆盖率 38.58 → **42.19 %** stmts

**两处判断记录：**

1. **Session Library 的样式故意保留内联，没有进样式表。** 那一节注入的是 Arena 的**明域（light DOM）**，不是扩展的 shadow root；类选择器规则必须逐条压过 Arena 自己的 CSS 才生效，内联 `cssText` 不受影响。改为把 14 段样式字符串收进 `ui/styles/arenaSidebar.ts` 的 `ASL` 命名空间，把 14 行 import 压成 1 行——真正减重的是抽出字符串，不是改成样式表。

2. **`capture.ts` 拆分暴露了跨模块共享的模块级状态。** `modelNameById`（`models` 用）和 `_lastRscTs`（`resetCaptureState` 用）原本声明在同一块，按行区间切会让两者都变成孤儿。改为每个模块自带状态、自带 `reset*()`：`rsc.ts` 新增 `resetRscState()`，由 `app/store.ts` 与 `resetCaptureState()` 并列调用。

**踩坑记录：覆盖率门控一开始是红的。** 拆文件新增了未覆盖的函数，functions 从 45.97 % 掉到 **44.63 %**（< 45 % 门槛）。正确做法不是降门槛，而是给拆分暴露出来的解析器补测试——新增 `tests/unit/bootstrap-extract.test.ts`（18 个），functions 回到 45.97 %。两个探针确认测试真会咬人：把 role 判定放宽成 `typeof o.role === "string"` 会让"ignores an unknown role"变红；去掉 `depth > 8` 会让"stops descending past the depth limit"变红。

**关于这批 fixture 的一个陷阱：** `__NEXT_DATA__` 本身就是一个 `<script>` 标签，而 `extractBootstrapMessages` 的第二条恢复路径会正则扫描**所有** script 标签的文本。所以凡是要断言"JSON 遍历器接受了什么"的用例，必须把 payload 放在非 script 元素里，否则扫描路径会把它再加一遍。这是生产行为，不是测试假象。

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
