# Edge AI Sidebar

> **版本**: 0.2.0 | **构建大小**: ~27 KB (content script) + 3 KB (inject hook)

Edge 浏览器扩展：在 arena.ai 聊天页面注入浮动按钮，**一键跳转到任意轮次对话**，支持导出、摘要生成、标题自定义等功能。

---

## 功能一览

### 核心导航

- ✅ 浮动按钮（可拖动位置）
- ✅ 展开 Rounds 列表（user/assistant 交替分组）
- ✅ 点击跳转 + 滚动高亮（当前 round 自动跟随）
- ✅ 正序/倒序切换
- ✅ 实时搜索过滤
- ✅ 实时检测新消息（MutationObserver + 3 秒兜底轮询）

### 导出与摘要

- ✅ **导出对话** — JSON / Markdown / 永久链接（复制或下载）
- ✅ **AI 摘要提示词** — 为每轮生成结构化摘要（可用于复制到其他 AI 继续讨论）
- ✅ 捕获 API 请求/响应（arena.ai 网络请求详情）

### 辅助功能

- ✅ **自定义标题编辑** — 双击左侧历史会话标题即可重命名
- ✅ API 配置捕获（提取 API URL、headers、请求体示例）
- ✅ WebSocket 事件捕获（实时消息事件日志）
- ✅ 模型名称解析（从 `__NEXT_DATA__` 提取模型 ID → 名称映射）

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
│   ├── content.ts                  内容脚本 ~45 KB（含完整 UI）
│   ├── service-worker/             Service Worker（可选扩展）
│   └── manifest.json               MV3 源 manifest
├── public/
│   └── icons/                     扩展图标
├── dist/                          构建产物（直接加载到 Edge）
│   ├── manifest.json
│   ├── assets/
│   │   ├── content.ts-*.js         ~27 kB（内容脚本）
│   │   └── inject-hook.js-*.js     ~3 kB（MAIN world 注入）
│   └── public/icons/
├── scripts/
│   ├── test-content-extract.cjs   jsdom 单元测试（4 scenarios）
│   ├── test-round-grouping.cjs     jsdom 单元测试（6 scenarios）
│   ├── arena-dump.js              Arena DOM dump 工具（手动调试用）
│   └── e2e-floating.cjs           E2E 浮动按钮测试
├── docs/
│   └── plan.md                     v0.1 原始规划（已过时）
├── vite.config.ts
├── package.json
└── tsconfig.app.json
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
# 4 个 extraction 场景
node scripts/test-content-extract.cjs

# 6 个 round grouping 场景
node scripts/test-round-grouping.cjs

# 一次跑两个
npm test
```

**当前状态**：

- ✅ Extraction 4/4 PASS：ChatGPT-style / Arena-class / Arena-data-role / Edge-cases
- ✅ Round grouping 6/6 PASS：60 alternating → 30 rounds / 0 → 0 / 60 all-assistant → 1 / etc.

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

| 之前（v0.1 构想） | 现在（v0.2 实现） |
| --- | --- |
| 大 AI Sidepanel（占屏幕一半） | 小浮动按钮（不占空间） |
| React + shadcn 12 组件 | Vanilla DOM |
| Tailwind v4 + Arena tokens | 纯 CSS 变量 + hsl() |
| chrome.sidePanel API | Shadow DOM 注入页面 |
| chrome.runtime.sendMessage 跨 context 通信 | 同 context 直接调用 |
| Service Worker（setPanelBehavior） | 不需要 |
| 250 kB bundle（原始构想） | 27 kB bundle |
| 11 项复杂功能 | 核心导航 + 导出 + 摘要 + 标题编辑 |

---

## 已知限制

- 仅支持 arena.ai 的 Direct / Max 模式（不支持 Battle 盲测模式）
- 不支持消息编辑 / 删除 / 新建（只读）
- 不持久化会话（关闭后重新打开会重新拉取）
- 不支持图片 / 文件附件的消息预览（仅文本）
- role 分配用 DOM 位置奇偶（Direct chat 严格交替；Battle/SxS 模式不适用）
- 自定义标题保存在 `chrome.storage.local`（每个扩展实例独立）

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
