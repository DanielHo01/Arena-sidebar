# Edge AI Sidebar

> **版本**: 0.2.0 | **构建大小**: 72.5 KB / gzip 23.0 KB（content script）+ 1.9 KB（inject hook）
>
> **代码规模**: `src/` 50 个 `.ts` / 5,887 行 · **测试**: 42 文件 / 750 用例 · **门禁**: 见 [docs/architecture.md](./docs/architecture.md)

Edge 浏览器扩展：在 arena.ai 聊天页面注入浮动按钮，**一键跳转到任意轮次对话**，支持导出、摘要生成、标题自定义等功能。

---

## 功能一览

### 核心导航

- ✅ 浮动按钮（可拖动位置）
- ✅ 展开 Rounds 列表（user/assistant 交替分组）
- ✅ Role-aware preview（用户问 / AI 答双行预览）
- ✅ 点击跳转 + 滚动高亮（当前 round 自动跟随）
- ✅ 正序/倒序切换
- ✅ 实时搜索过滤（标题 / 双预览 / 任意消息全文）
- ✅ **隐藏轮次** — ✕ 隐藏 / ↩ 恢复，按会话持久化（`hidden-rounds:{sessionId}`），跨标签页同步
- ✅ **编辑消息** — ✏️ 内联修正已发送的消息（仅扩展内可见，arena.ai 不动），防重提保护
- ✅ **删除轮次** — 🗑️ 两次点击确认硬删除，指纹 tombstone 按会话持久化，刷新不复活，跨标签页同步
- ✅ 实时检测新消息（MutationObserver + 轮询）

### 会话管理

- ✅ **Session Library** — 内嵌 Arena 左侧栏，可展开/折叠
- ✅ **会话文件夹**（Inbox / Archive，自定义文件夹）
- ✅ **右键菜单**（Rename / Move to folder）
- ✅ **标题自定义** — 右键 Rename（#17 后唯一入口），统一优先级：customTitle > title > sessionId 前缀
- ✅ **持久化恢复** — 刷新后恢复 loaded rounds

### 导出与摘要

- ✅ **导出对话** — JSON / Markdown / 永久链接
- ✅ **AI 摘要提示词** — 为每轮生成结构化摘要
- ✅ 捕获 chat 请求/响应（配对成轮次）
- ✅ 捕获 Arena 的 RSC 流式响应

---

## 技术栈

| 层 | 选型 |
| --- | --- |
| 构建 | Vite 8 + TypeScript 6 |
| 扩展框架 | Manifest V3 + `@crxjs/vite-plugin` |
| 内容脚本 UI | **Vanilla DOM + Shadow DOM**（无 React/Tailwind） |
| 注入方式 | 双 world 注入：MAIN world (inject-hook.js) + Isolated world (content.ts) |
| 图标 | 自生成 PNG（16/32/48/128） |

---

## 项目结构

分层规则：`platform/` 是唯一接触浏览器 API 的层；`core/` 是纯逻辑、无 DOM 依赖；
`features/` 是有状态的业务逻辑；`ui/` 只做渲染；`app/` 负责生命周期编排。
依赖方向单向向下，根目录文件是入口与装配点。

```
D:\edge-ai-sidebar\
├── src/
│   ├── content.ts              内容脚本入口：bootstrap + ensureUI
│   ├── conversationStore.ts    消息存储 + refreshStore 三源合并
│   ├── extract.ts              DOM 消息提取
│   ├── historyTitles.ts        双击改名 + 自定义标题恢复
│   ├── titleResolver.ts        标题解析 customTitle > title > sessionId
│   ├── state.ts                panel / fab / cachedElements / timers
│   ├── rounds.ts               隐藏轮次标记：按会话持久化 + 跨标签同步
│   ├── types.ts                共享类型
│   ├── manifest.json           MV3 源 manifest
│   │
│   ├── app/                    生命周期编排
│   │   ├── loop.ts             MutationObserver + 2s 抓取轮询 + 30s 重扫
│   │   └── store.ts            resetSessionState + disposer 注册表
│   │
│   ├── core/                   纯逻辑，无 DOM 依赖，覆盖率 99/90/100/100
│   │   ├── fingerprint.ts      消息指纹
│   │   ├── renderKey.ts        渲染快路径的单一比较键
│   │   ├── rounds.ts           轮次分组
│   │   └── serialize.ts        导出 / 摘要 prompt 构建
│   │
│   ├── platform/               浏览器 API 边界，chrome.storage 与 clipboard 各只此一处
│   │   ├── arenaDom.ts         所有编码 arena.ai 结构知识的选择器与探针
│   │   ├── clipboard.ts        navigator.clipboard 唯一封装
│   │   ├── route.ts            SPA 路由解析
│   │   └── storage.ts          chrome.storage 唯一封装，永不 reject，含配额重试 + LRU
│   │
│   ├── features/               有状态业务逻辑
│   │   ├── bootstrapExtract.ts 首屏 __NEXT_DATA__ 提取
│   │   ├── prescroll.ts        虚拟化历史预滚动
│   │   ├── roundNav.ts         轮次跳转
│   │   └── sessions.ts         文件夹 / 会话索引
│   │
│   ├── capture.ts              抓取聚合入口
│   ├── capture/
│   │   ├── chatCapture.ts      fetch 请求 / 响应配对
│   │   ├── models.ts           模型名收割
│   │   └── rsc.ts              __aiSidebarRsc 事件接收
│   │
│   └── ui/                     渲染层
│       ├── arenaSidebar.ts     注入 Arena 侧边栏的 Session Library
│       ├── contextMenu.ts      历史链接右键菜单
│       ├── dom.ts              h() 元素构造器
│       ├── fab.ts              浮动按钮
│       ├── icons.ts            图标
│       ├── inlineRename.ts     内联改名编辑器，双击与右键共用
│       ├── keyboard.ts         快捷键
│       ├── modals.ts           导出 / 摘要模态框
│       ├── render.ts           刷新与渲染调度
│       ├── panel.ts            面板入口
│       ├── panel/
│       │   ├── highlight.ts    当前轮高亮
│       │   ├── list.ts         列表 reconcile
│       │   ├── roundItem.ts    单轮条目
│       │   └── skeleton.ts     面板骨架
│       ├── styles.ts           样式入口
│       └── styles/
│           ├── arenaSidebar.ts ASL 命名空间，内联样式
│           ├── base.ts         基础样式
│           ├── contextMenu.ts  右键菜单样式
│           └── list.ts         列表样式
│
├── public/
│   ├── inject-hook.js          MAIN world 注入，只包装 window.fetch
│   └── icons/                  扩展图标
│
├── tests/
│   ├── __fixtures__/arenaDom.ts  Arena DOM 骨架，无 .test.ts 后缀故被 include 跳过
│   ├── __fixtures__/probes/      真站 DOM 合同的可重放快照（probe:check 对账）
│   ├── e2e/                    真 Chromium + 真 dist/ 的 13 步行为测试
│   └── unit/                   42 个测试文件，750 个用例
│
├── scripts/
│   ├── arena-dump.js           浏览器控制台里跑的页面结构抓取工具
│   ├── check-layers.ts         arch:check —— 分层方向与棘轮上限
│   └── gen-probe.ts            从 arenaContract.ts 生成可执行探针
│
├── dist/                       构建产物（直接加载到 Edge）
├── docs/
│   ├── architecture.md         当前架构与每条门禁的出处（先读这个）
│   ├── archive/                历史计划与交接文档，数字已过期
│
├── vite.config.ts
├── vitest.config.ts            覆盖率地板（全局 + 五个层）+ 线程池与随机顺序
├── package.json
├── tsconfig.json
├── tsconfig.app.json           应用配置，含 noUncheckedIndexedAccess 等严格开关
└── tsconfig.test.json          scripts + tests 的类型检查
```

---

## 安装

```
1. Edge → edge://extensions
2. 左下角 "Developer mode" 打开
3. 顶部 "Load unpacked" → 选 D:\edge-ai-sidebar\dist
4. 扩展列表出现 "Edge AI Sidebar"
5. 打开 arena.ai tab，登录，开始一个 Direct Chat 或 Max mode 对话
6. 右侧中间出现浮动按钮（MessageSquare 图标）
7. 点浮动按钮 → 弹层显示 rounds 列表
8. 点任意一条 → 页面跳到该处
```

---

## 使用流程

```
[arena.ai 打开 + 登录 + Direct/Max 对话]
       ↓ (页面加载完成)
[内容脚本自动注入，右侧出现浮动按钮]
       ↓ 点浮动按钮
[弹层展开：X rounds · Y messages + 搜索框 + 操作按钮]
       ↓
  ┌─────────────────────────────────────────────┐
  │ [Title] [🔃] [📤 Export] [✨ Summary] [✕]   │
  │ [Search rounds...]                          │
  │ ┌─────────────────────────────────────────┐ │
  │ │ ① Round 1 · 2 messages                 │ │
  │ │    First user message preview...        │ │
  │ │ ② Round 2 · 2 messages                 │ │
  │ │    Another question...                   │ │
  │ └─────────────────────────────────────────┘ │
  └─────────────────────────────────────────────┘
       ↓ 点任意一条 round
[arena.ai 页面平滑滚动到该处 + 高亮 1.5 秒]
[弹层自动收起 → 回到浮动按钮状态]
```

---

## 功能详解

### 消息提取策略

`src/extract.ts` 里两个具名选择器，各管一侧：

- `USER_MESSAGE_SELECTOR` — `main [class*="bg-surface-raised"][class*="rounded-lg"]`，排除 `w-4` / `inline-flex`
- `ASSISTANT_MESSAGE_SELECTOR` — `main [class*="bg-surface-primary"][class*="flex-col"][class*="overflow-hidden"]`

命中后递归穿透 Shadow DOM，防 React/Vue 组件隔离。

> 早期文档写的"12 策略选择器"已不存在；当前实现就是上面这两条。

### 导出对话

点 📤 按钮，弹出模态框：

- **📋 Copy JSON** — 复制完整 JSON 到剪贴板
- **📋 Copy Markdown** — 复制 Markdown 格式
- **🔗 Copy link** — 复制 arena.ai 永久链接
- **💾 Download JSON** — 下载 `.json` 文件
- **💾 Download .md** — 下载 `.md` 文件

JSON 结构包含：sessionId、url、exportedAt、rounds（含 user/responses）。

### AI 摘要提示词

点 ✨ 按钮，弹出模态框显示为每轮生成的摘要提示词：

- 格式为 JSON，包含 `id`、`title`、`summary`
- **📋 Copy to clipboard** — 复制到剪贴板
- **🚀 Open new arena.ai chat** — 在新标签页打开 arena.ai 并填入
- **📥 Paste into current chat** — 粘贴到当前页面的输入框
- **💾 Download as .md** — 下载为 Markdown 文件

### 自定义标题

在 arena.ai 左侧历史会话列表，右键任意会话 → ✏️ Rename 即可编辑（与 ChatGPT / Claude 一致的菜单式重命名）：

- 自动保存到 `chrome.storage.local`
- 下次访问自动应用
- 提示文字：`Right-click to rename`

### 拖动浮动按钮

按住浮动按钮拖动，可自定义位置：

- 位置自动保存到 `chrome.storage.local`
- 下次打开页面保持位置

### 本地存储与配额

`chrome.storage.local` 约 10MB，每个会话存一条完整消息快照（`edge-ai-sidebar:session:<uuid>`），无限累积会写满。三层防护：

- **LRU 上限** — 只保留最新 50 条、共 6MB 以内的会话快照（百轮对话单快照可达 MB 级，字节预算才是真约束），超出的按 `lastSavedAt` 自动淘汰（重访该会话会从 DOM 重新提取）
- **配额重试** — 写入命中 quota 时自动清理到 3MB / 最新 10 条并重试一次；文件夹索引、重命名、隐藏标记体积小且不可再生，永不淘汰
- **可见反馈** — 面板 header 有存储占用圆点（🟢 <50% / 🟡 <80% / 🟠 <95% / 🔴 ≥95%，悬停看具体 MB）；彻底写失败时弹 toast 提示

---

## 自动化测试

```bash
npm test                      # 全套 Vitest（42 文件 / 750 用例），含 DOM 合同快照重放
npm run arch:check            # 分层方向 + 未分层耦合上限 + 文件行数上限
npm run test:coverage         # 同上，带覆盖率与按目录阈值棘轮
npm run gen:probe             # 从 arenaContract.ts 生成 scripts/arena-probe.js
npm run probe:check           # CI 用：探针与合同不同步则失败
```

真站 DOM 合同：`src/platform/arenaContract.ts` 是选择器唯一来源；
`tests/__fixtures__/probes/*.json` 是 2026-09 真页的可重放摘要。Arena 改版时
把探针输出的 `snapshot` 丢进该目录，不必每次 sideload 点一遍。

**当前状态**（2026-10-08 实测，改数字请连着 `vitest.config.ts` 一起改）：

- ✅ 42 个测试文件 / 750 个用例，`sequence.shuffle` 常开（用例顺序随机化）
- ✅ 整体覆盖率 95.23% 语句 / 86.4% 分支 / 96.49% 函数 / 96.9% 行
- ✅ 按目录棘轮：全局（94/85/95/96）、`src/core/**`（99/90/100/100）、
  `src/platform/**`（96/89/91/99）、`src/app/**`（96/94/87/98）、
  `src/features/**`（93/88/96/96）、`src/ui/**`（98/90/97/99）
- ✅ `npm test` 4.8 s：`pool: "vmThreads"` 让 jsdom 每个 worker 只建一次
  （此前每个测试文件建一次，占墙钟 63–79%），per-file isolation 保留
- ✅ CI（`.github/workflows/ci.yml`）跑同一套门控 + bundle 体积预算
  （73,500 B / gzip 24,000 B；实测 72,526 B / 22,967 B）
  + 真 Chromium e2e（`npm run test:e2e`，13 步，跑 `dist/` 与 mock arena）

（早期文档里的 `npm run test:mirror` / `test:src` 镜像测试脚本已在 Phase 0 迁移到 Vitest 时删除。）

---

## 故障排查

| 现象 | 原因 | 修复 |
| --- | --- | --- |
| 面板提示 Battle mode 不支持导航 | Battle 盲测是双模型并排 + 投票，与单线程提取不兼容 | 切到 Direct Chat 或 Max mode（看到提示本身说明检测正常） |
| 浮动按钮在，点了没反应 | 页面没消息（0 messages） | 等待对话加载 |
| 点了 round 没跳转 | DOM 提取失败（具体元素没匹配） | 见下"自定义 selectors" |
| 跳转不准确 | arena 用虚拟滚动 | 滚动后等 DOM 更新再跳 |
| 跳错了 round | DOM 顺序被 arena 改过 | 截图发我，加 debug log 看真实顺序 |

### 自定义 selectors

编辑 `src/extract.ts` 里的 `USER_MESSAGE_SELECTOR` / `ASSISTANT_MESSAGE_SELECTOR` 两个常量，然后 `npm run build`。

（早期文档提到的 `src/content.ts` 顶部 `MESSAGE_SELECTORS` 数组已不存在。）

### Debug 模式

在 arena.ai 页面 F12 → Console：

所有日志统一用 `[AI Sidebar]` 前缀，常见的几条：

- `[AI Sidebar] content script loaded, modules initializing...` — 内容脚本已加载
- `[AI Sidebar] preScroll: totalH= ... step= ...` / `preScroll: done, messages=N` — 虚拟滚动预加载进度
- `[AI Sidebar] RSC capture: listening for __aiSidebarRsc` — RSC 捕获已挂上
- `[AI Sidebar] RSC captured: status=...` — 收到一条 RSC 响应
- `[AI Sidebar] store: total messages=N rounds=M` — 重建后的轮次数

面板自身的状态挂在宿主元素上，可直接读：

```js
document.getElementById("__edge_ai_sidebar_host").dataset
// { aiSidebarOpen, aiSidebarMode, aiSidebarRounds, aiSidebarMsgs }
```

> 早期文档列的 `__aiSidebarSamples` / `__chatRounds` 全局变量和 `[AI Sidebar Debug]` 日志都已移除——`window.__aiSidebar*` 属性在 Phase 4 被换成模块内的 `timers` 引用（见 `src/state.ts`）。

---

## 质量门禁

规范不写在文档里，写在会红的闸门里。`docs/architecture.md` 是这些门禁的说明书。

| 命令 | 拦什么 | 上限来源 |
| --- | --- | --- |
| `npm run format:check` | 格式漂移 | Prettier（`tabWidth: 2`，与 `.editorconfig` 对齐） |
| `npm run lint -- --max-warnings=0` | 0 warning 才算过 | `.oxlintrc.json` |
| `npm run arch:check` | 依赖方向、循环依赖、`chrome.*` 越界、`core/` 碰 DOM、未分层耦合数、单文件行数 | `scripts/check-layers.ts` 里的常量 |
| `npm run typecheck` | `strict` + `noUncheckedIndexedAccess` + `exactOptionalPropertyTypes` | `tsconfig.app.json` |
| `npm run probe:check` | DOM 合同与生成的探针不同步 | `src/platform/arenaContract.ts` |
| `npm test` | 750 用例 + 覆盖率地板 | `vitest.config.ts` `thresholds` |
| `npm run build` + 预算 | content bundle 超过 73,500 B / gzip 24,000 B | `.github/workflows/ci.yml` |
| `npm run test:e2e` | 真 Chromium + 真 `dist/` 的 13 步行为 | `tests/e2e/run.mjs` |

`arch:check` 的上限是**地板/天花板**而非目标：它们等于"今天的实测值"，
只允许往下调。三条棘轮（未分层耦合 45、单文件 315 行、覆盖率）都由
`tests/unit/layer-rules.test.ts` 反向验证——规则本身失效时那条测试会红。

---

## 架构选择

| 特性 | 之前（v0.1 构想） | 现在（v0.2 实现） |
| --- | --- | --- |
| UI 形态 | 大 AI Sidepanel（占屏幕一半） | 小浮动按钮（不占空间） |
| 技术栈 | React + shadcn + Tailwind | Vanilla DOM |
| 注入方式 | chrome.sidePanel API | Shadow DOM 注入 |
| 存储 | chrome.storage.local 分散 key | foldersState.sessions 统一存储 |
| 标题来源 | historyTitle_ / sessionMeta.title / round.title 各自独立 | resolveSessionTitle 统一解析 |
| Bundle | 250+ kB | 54 kB |

---

## 已知限制

- Battle 盲测模式仅显示提示（双模型并排导航暂不支持），Direct / Max 模式功能完整
- 消息编辑 / 删除仅扩展内生效（arena.ai 没有消息级编辑 API，官方只支持会话归档后删除）；不支持新建消息
- 自定义标题保存在 `chrome.storage.local`（每个扩展实例独立）
- 隐藏轮次不持久化到 Direct Chat（无会话 id 可挂靠，与消息存储同生命周期）

（重命名已统一为右键菜单唯一入口：Phase 7 去掉 `prompt()` 改内联编辑器 `ui/inlineRename.ts`，#17 移除了双击路径，对齐 ChatGPT / Claude。）

---

## 后续 Roadmap

- [ ] 适配 chatgpt.com / claude.ai 等其他 AI 聊天网站（`platform/arenaDom.ts` 是预留的扩展点）
- [x] 浮动按钮位置自定义（拖动 + 位置持久化）
- [x] 消息搜索（标题 / 双预览 / 全文正文；fuzzy 暂未做）
- [x] 跨标签页同步（文件夹、会话索引、隐藏轮次；面板开合为各标签独立）
- [x] 浮动按钮快捷键（Alt+S 开关面板）
- [x] 深色模式适配（面板 🌓 按钮：auto→light→dark；auto 跟随页面 `class="dark"`/`data-theme`，否则回退到系统主题；选择持久化并跨标签页同步。FAB 同时改为不透明底板，修复其在任意页面背景上不可见的问题）

---

## 安全说明

- 不上传任何数据
- 内容脚本仅读取 arena.ai 页面 DOM，不修改
- 无外部网络请求（除 arena.ai 自身）
- 无 API key 存储（无 API 集成）
- 数据存储在 `chrome.storage.local`（本地，浏览器级别隔离）

---

## 构建

```bash
npm install
npm run build    # 构建到 dist/
npm run dev      # 开发模式（热重载）
npm test         # 运行单元测试
```

---

## License

MIT License — 个人项目，仅供自用。
