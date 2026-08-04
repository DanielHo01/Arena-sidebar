# Edge AI Sidebar

> **版本**: 0.2.0 | **构建大小**: ~54 KB gzip:16.5 KB (content script) + 0.9 KB (inject hook)

Edge 浏览器扩展：在 arena.ai 聊天页面注入浮动按钮，**一键跳转到任意轮次对话**，支持导出、摘要生成、标题自定义等功能。

---

## 功能一览

### 核心导航

- ✅ 浮动按钮（可拖动位置）
- ✅ 展开 Rounds 列表（user/assistant 交替分组）
- ✅ Role-aware preview（用户问 / AI 答双行预览）
- ✅ 点击跳转 + 滚动高亮（当前 round 自动跟随）
- ✅ 正序/倒序切换
- ✅ 实时搜索过滤
- ✅ 实时检测新消息（MutationObserver + 轮询）

### 会话管理

- ✅ **Session Library** — 内嵌 Arena 左侧栏，可展开/折叠
- ✅ **会话文件夹**（Inbox / Archive，自定义文件夹）
- ✅ **右键菜单**（Rename / Move to folder）
- ✅ **标题自定义** — 双击或右键 Rename，统一优先级：customTitle > title > sessionId 前缀
- ✅ **持久化恢复** — 刷新后恢复 loaded rounds

### 导出与摘要

- ✅ **导出对话** — JSON / Markdown / 永久链接
- ✅ **AI 摘要提示词** — 为每轮生成结构化摘要
- ✅ 捕获 API 请求/响应
- ✅ API 配置捕获（URL、headers、请求体示例）
- ✅ WebSocket 事件捕获

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

```
D:\edge-ai-sidebar\
├── src/
│   ├── content.ts                  内容脚本（含完整 UI + preScroll）
│   ├── conversationStore.ts        消息存储 + rounds 计算
│   ├── extract.ts                 DOM 消息提取（12 个 selector）
│   ├── capture.ts                 API / WebSocket 捕获
│   ├── historyTitles.ts           双击改名 + 自定义标题恢复
│   ├── folders.ts                 会话文件夹管理 + Session Library
│   ├── titleResolver.ts          标题解析（customTitle > title > sessionId）
│   ├── state.ts                  Panel / FAB / Timer 状态
│   ├── types.ts                  共享类型
│   ├── rounds.ts                 hiddenRoundIds（纯 Set）
│   ├── manifest.json              MV3 源 manifest
│   └── ui/
│       ├── panel.ts               面板渲染 + reconcileList
│       ├── fab.ts                浮动按钮
│       └── modals.ts             导出 / 摘要模态框
├── public/
│   └── inject-hook.js            MAIN world 注入（API 拦截）
├── scripts/
│   ├── test-content-extract.cjs  jsdom 镜像测试
│   ├── test-round-grouping.cjs  jsdom 镜像测试
│   ├── test-conversation-store.cjs  jsdom 镜像测试
│   ├── test-src-rounds.ts        真实源码测试（tsx）
│   ├── test-src-store.ts         真实源码测试（tsx）
│   └── test-src-title-resolution.ts  真实源码测试（tsx）
├── dist/                        构建产物（直接加载到 Edge）
├── docs/
│   └── rebaseline-phase10a.md   Phase 10A 死代码清理记录
├── vite.config.ts
├── package.json
├── tsconfig.app.json
└── tsconfig.test.json           测试脚本类型检查
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

12 策略 DOM 选择器，覆盖：

- ChatGPT-style（`bg-surface-raised` 类）
- Arena-class（`bg-surface-primary` + `flex-col` 类）
- Arena-data-role（`data-role="user/assistant"` 属性）
- Edge-cases（aria-hidden + button 过滤）

自动递归穿透 Shadow DOM，防 React/Vue 组件隔离。

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

在 arena.ai 左侧历史会话列表，双击任意标题即可编辑：

- 自动保存到 `chrome.storage.local`
- 下次访问自动应用
- 提示文字：`Double-click to rename`

### 拖动浮动按钮

按住浮动按钮拖动，可自定义位置：

- 位置自动保存到 `chrome.storage.local`
- 下次打开页面保持位置

---

## 自动化测试

```bash
npm test              # 全套：镜像测试 + 真实源码测试
npm run test:mirror   # 仅镜像测试（3 suites，20 assertions）
npm run test:src      # 仅真实源码测试（3 suites，24 assertions）
```

**当前状态**：

- ✅ Mirror suites 20/20 PASS
- ✅ Real-source suites 24/24 PASS（computeRounds、conversationStore、resolveSessionTitle）

---

## 故障排查

| 现象 | 原因 | 修复 |
| --- | --- | --- |
| 没有浮动按钮 | arena.ai 在 Battle mode（不渲染消息列表） | 切到 Direct Chat 或 Max mode |
| 浮动按钮在，点了没反应 | 页面没消息（0 messages） | 等待对话加载 |
| 点了 round 没跳转 | DOM 提取失败（具体元素没匹配） | 见下"自定义 selectors" |
| 跳转不准确 | arena 用虚拟滚动 | 滚动后等 DOM 更新再跳 |
| 跳错了 round | DOM 顺序被 arena 改过 | 截图发我，加 debug log 看真实顺序 |

### 自定义 selectors

如果默认 12 个 selector 不够，编辑 `src/content.ts` 顶部的 `MESSAGE_SELECTORS` 数组，加适合你 DOM 结构的 selector，然后 `npm run build`。

### Debug 模式

在 arena.ai 页面 F12 → Console：

- `[AI Sidebar Debug] N sample elements ...` — 1.5s 后打印抓到元素的 attributes/classes
- `[AI Sidebar] WS event:` — WebSocket 事件
- `[AI Sidebar] Chat request:` — 捕获的 chat 请求
- `[AI Sidebar] Chat round COMPLETE/streaming:` — 捕获的 chat 响应
- 复制 `__aiSidebarSamples` 看实际 DOM 结构
- 复制 `__chatRounds` 看捕获的 rounds

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

- 仅支持 arena.ai Direct / Max 模式（不支持 Battle 盲测模式）
- 不支持消息编辑 / 删除 / 新建（只读）
- 自定义标题保存在 `chrome.storage.local`（每个扩展实例独立）
- 右键 Rename 依赖 `prompt()`（可替换为内联编辑框）

---

## 后续 Roadmap

- [ ] 适配 chatgpt.com / claude.ai 等其他 AI 聊天网站
- [ ] 浮动按钮位置自定义（拖动） — ✅ 已实现
- [ ] 消息搜索（fuzzy + 全文）
- [ ] 跨标签页同步（多 arena tab 切换）
- [ ] 浮动按钮快捷键
- [ ] 深色模式适配

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
