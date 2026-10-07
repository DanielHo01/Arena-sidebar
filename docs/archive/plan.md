# Edge AI Sidebar — Implementation Plan (DEPRECATED)

> ⚠️ **此文档已过时** — v0.1 原始规划，描述的是早期 React + Side Panel 构想。
>
> **当前实现 (v0.2)**：
>
> - 形态：浮动按钮 + Shadow DOM 注入（无 React/Tailwind）
> - 功能：消息导航 + 导出 + 摘要生成 + 标题自定义
> - 栈：Vanilla DOM + TypeScript + Manifest V3 + Shadow DOM
>
> 详情见 [README.md](../README.md)

---

## 0. 决策摘要（已过时 — 以下为 v0.1 构想）

| 项 | 决策 | 备注 |
| --- | --- | --- |
| 产品形态 | **纯 chat**（单 provider：DeepSeek） | Arena 多模型对比哲学不做 |
| **UI 风格** | **Arena shadcn/ui 风格**（thin bar + pill tabs） | 基于 arena.ai dump 真实 HTML |
| API | DeepSeek 官方 (`api.deepseek.com`) | OpenAI 兼容 |
| **鉴权** | **简化：明文存 chrome.storage.local** | 无密码、无加密（用户决策：不要解锁 UX） |
| **浏览器** | **Edge only**（Chromium 内核） | 暂不考虑 Firefox / Safari |
| **发布** | **自用**，暂不提交 Edge Add-ons 商店 | |
| 打开方式 | Side Panel API | 点图标开侧栏 |
| 存储分层 | 会话 → IndexedDB / 偏好 → chrome.storage.sync / Key → chrome.storage.local（明文） |
| 后端 | **无**（纯前端） | |
| 项目目录 | `D:\edge-ai-sidebar\` | |

---

## 1. 功能清单（11 项 + 基础必备）

### 11 项核心（用户选定）

1. **搜索所有会话**（Fuse.js）
2. **收藏 / 标星会话**
3. **会话标签**
4. **会话文件夹**
5. **导出单条**（Markdown / HTML / PDF / JSON / PNG / Word）
6. **批量导出所有会话**
7. **导入历史**（ChatGPT `conversations.json` / Gemini Takeout zip）
8. **分支会话**（从第 N 条消息 fork）
9. **消息级分享**（复制 Markdown + 时间戳）
10. **页面上下文感知**（当前 tab URL + title + 选中文本）
11. **右侧浮动预览**（迷你历史）

### 基础必备

- Markdown 渲染 + 代码高亮（marked + highlight.js + DOMPurify 防 XSS）
- 流式响应（SSE via fetch streams）
- 自动滚动 + 复制按钮

---

## 2. 技术栈

```
构建：Vite + TypeScript
UI：React 18
样式：Tailwind CSS v4 + shadcn/ui（基于 Radix UI primitives）
扩展框架：Manifest V3 + @crxjs/vite-plugin
存储：IndexedDB（Dexie.js 封装） + chrome.storage
搜索：Fuse.js
Markdown：marked + highlight.js + DOMPurify
导出：jsPDF + html2canvas + jszip + docx
导入：原生 JSON 解析 + jszip（解压 Takeout）
工具：clsx + tailwind-merge（cn helper）+ lucide-react（图标）
```

---

## 3. 项目结构

```
edge-ai-sidebar/
├── src/
│   ├── sidepanel/
│   │   ├── App.tsx
│   │   ├── components/
│   │   │   ├── ui/                       # shadcn 复制粘贴组件
│   │   │   │   ├── button.tsx
│   │   │   │   ├── tabs.tsx
│   │   │   │   ├── dialog.tsx
│   │   │   │   ├── sheet.tsx
│   │   │   │   ├── tooltip.tsx
│   │   │   │   ├── dropdown-menu.tsx
│   │   │   │   ├── input.tsx
│   │   │   │   ├── textarea.tsx
│   │   │   │   ├── scroll-area.tsx
│   │   │   │   ├── badge.tsx
│   │   │   │   ├── separator.tsx
│   │   │   │   └── collapsible.tsx
│   │   │   ├── Sidebar.tsx
│   │   │   ├── TopBar.tsx
│   │   │   ├── ChatView.tsx
│   │   │   ├── MessageBubble.tsx
│   │   │   ├── InputBox.tsx
│   │   │   ├── ModelTabs.tsx
│   │   │   ├── ModelList.tsx
│   │   │   ├── FloatingPreview.tsx
│   │   │   ├── SearchBar.tsx
│   │   │   ├── FolderTree.tsx
│   │   │   ├── ExportMenu.tsx
│   │   │   ├── ImportDialog.tsx
│   │   │   ├── PageContextBar.tsx
│   │   │   ├── Onboarding.tsx
│   │   │   └── Settings.tsx
│   │   ├── hooks/
│   │   │   ├── useChat.ts
│   │   │   ├── useSessions.ts
│   │   │   ├── useSearch.ts
│   │   │   └── useContext.ts
│   │   ├── lib/
│   │   │   └── utils.ts                  # cn() = clsx + tailwind-merge
│   │   └── styles/
│   │       └── globals.css               # Tailwind base + CSS 变量
│   ├── service-worker/
│   │   ├── index.ts                      # 入口（顶层注册所有 listener）
│   │   ├── api.ts                        # DeepSeek streaming fetch
│   │   ├── storage.ts                    # chrome.storage + Dexie 封装
│   │   ├── importers.ts
│   │   ├── exporters.ts
│   │   └── messaging.ts
│   ├── content/
│   │   └── inject.ts
│   └── shared/
│       ├── types.ts
│       └── db.ts
├── public/
│   ├── icons/
│   └── sidepanel.html
├── docs/
│   └── plan.md
├── scripts/
│   └── arena-dump.js
├── components.json                       # shadcn/ui 配置
├── tailwind.config.ts                    # (Tailwind v4 可选)
├── manifest.json
├── vite.config.ts
├── package.json
└── tsconfig.json
```

---

## 4. 数据模型

```typescript
interface Session {
  id: string;                             // UUID
  title: string;
  createdAt: number;
  updatedAt: number;
  starred: boolean;                       // 2
  tags: string[];                         // 3
  folderId?: string;                      // 4
  model: string;                          // 'deepseek-chat' | 'deepseek-reasoner'
  systemPrompt?: string;
  source?: 'native' | 'chatgpt' | 'gemini';
  forkedFromMessageId?: string;           // 8
  pageContext?: {                         // 10
    url: string;
    title: string;
    selection?: string;
  };
  messages: Message[];
}

interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  thinking?: string;
  createdAt: number;
  parentSessionId?: string;
}

interface Folder {
  id: string;
  name: string;
  color?: string;
  createdAt: number;
}
```

---

## 5. 关键实现要点

### 5.1 鉴权（简化：明文存，用户决策）

```typescript
// Onboarding：直接存明文（无密码、无加密）
async function setApiKey(plaintext: string) {
  await chrome.storage.local.set({ apiKey: plaintext });
}

// service-worker/api.ts：直接读
const { apiKey } = await chrome.storage.local.get('apiKey');
if (!apiKey) throw new Error('请先在 Onboarding 中填入 API Key');
```

### 5.2 流式响应（SSE）

```typescript
async function* streamChat(messages: Message[], apiKey: string, model: string) {
  const res = await fetch('https://api.deepseek.com/chat/completions', {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ model, messages, stream: true })
  });
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    for (const line of buffer.split('\n')) {
      if (line.startsWith('data: ')) {
        const data = line.slice(6);
        if (data === '[DONE]') return;
        const json = JSON.parse(data);
        const delta = json.choices[0]?.delta?.content;
        if (delta) yield delta;
      }
    }
    buffer = '';
  }
}
```

### 5.3-5.9 略（同 v1：搜索 / 导出 / 导入 / 分支 / 分享 / 页面上下文 / 浮动预览）

### 5.10 shadcn/ui 集成 + 设计 Token（参考 Arena dump）

```css
/* src/sidepanel/styles/globals.css */
@import "tailwindcss";

@layer base {
  :root {
    --surface-primary: 0 0% 100%;
    --surface-secondary: 0 0% 98%;
    --border-faint: 0 0% 92%;
    --text-primary: 0 0% 9%;
    --text-secondary: 0 0% 45%;
    --text-tertiary: 0 0% 60%;
    --text-placeholder: 0 0% 70%;
    --interactive-active: 222 89% 55%;
    --interactive-normal: 222 89% 45%;
    --ring: 222 89% 55%;
  }

  .dark {
    --surface-primary: 0 0% 7%;
    --surface-secondary: 0 0% 12%;
    --border-faint: 0 0% 18%;
    --text-primary: 0 0% 95%;
    --text-secondary: 0 0% 65%;
    --text-tertiary: 0 0% 50%;
    --text-placeholder: 0 0% 40%;
    --interactive-active: 217 91% 60%;
    --interactive-normal: 217 91% 50%;
  }
}
```

---

## 6. UI 布局（参考 Arena dump）

### 整体框架

```
┌─────────────────────────────────────────────────────────┐
│ ┌──[sidebar]──┐ ┌──[main chat area]──────────────────┐ │
│ │             │ │ ┌─[top bar]─────────────────────┐ │ │
│ │ Logo        │ │ │ ☰  Logo   [Direct|Max]   👤   │ │ │
│ │             │ │ └──────────────────────────────┘ │ │
│ │ + New Chat  │ │ ┌─[chat area / welcome]────────┐ │ │
│ │ 🔍 Search   │ │ │                                │ │ │
│ │ Today       │ │ │   What would you like to do? │ │ │
│ │ Older       │ │ │   ┌─[input box]─────────────┐ │ │ │
│ │             │ │ │   │ Ask anything…          │ │ │ │
│ │             │ │ │   └────────────────────────┘ │ │ │
│ │             │ │ │   [Text][Code][Image][Search] │ │ │
│ │             │ │ │   ▢ deepseek-chat            │ │ │
│ │             │ │ │   ▢ deepseek-reasoner        │ │ │
│ │ [User]      │ │ └────────────────────────────┘ │ │
│ └─────────────┘ └──────────────────────────────────┘ │
└─────────────────────────────────────────────────────────┘
```

---

## 7. Manifest V3

```json
{
  "manifest_version": 3,
  "name": "Edge AI Sidebar",
  "version": "0.1.0",
  "side_panel": { "default_path": "sidepanel.html" },
  "permissions": ["sidePanel", "storage", "activeTab"],
  "host_permissions": ["https://api.deepseek.com/*"],
  "background": { "service_worker": "service-worker.js" },
  "action": { "default_title": "Open AI Sidebar" }
}
```

---

## 8. 里程碑

| # | 任务 | 验收 |
| --- | --- | --- |
| **M0** | 项目骨架 + sidepanel 可打开 + shadcn 集成 | MV3 加载，Tailwind + shadcn 渲染正常 |
| **M1** | TopBar + 折叠侧栏 UI | thin bar + 侧栏折叠/展开 |
| **M2** | Onboarding + 明文 Key 存储 | 首次填 Key，能调用一次 DeepSeek |
| **M3** | 会话 CRUD + Dexie | 创建/重命名/删除/标签/收藏/文件夹 |
| **M4** | InputBox + Model Tabs（4 pill） | 居中输入框 + Text/Code/Image/Search 切换 |
| **M5** | 流式对话 + Markdown 渲染 | SSE + marked + highlight.js |
| **M6** | 会话列表（时间分组）+ 三点菜单 | |
| **M7** | 搜索 + 浮动预览 + 页面上下文 | |
| **M8** | 导出（5 格式）+ 批量 | |
| **M9** | 导入 + 分支 + 分享 | |
| **M10** | polish + Edge sideload | |

---

## 9. 安全模型（修订）

- **API Key**：明文存 `chrome.storage.local`（用户决策，信任本地）
- `chrome.storage.sync` 仅存偏好（主题、布局）
- 直连 `api.deepseek.com`，不经中间服务器
- DOMPurify 防 XSS
- 最小 host_permissions：`activeTab` + `https://api.deepseek.com/*`

---

## 10. 已决定项

| # | 项 | 决策 |
| --- | --- | --- |
| 1 | 鉴权 UX | ✅ 明文存 |
| 2 | 浏览器 | ✅ Edge only |
| 3 | 发布 | ✅ 自用 |
| 4 | 欢迎页 | ✅ 保留 dump 结构 |

---

## 11. Arena 调研结论

- arena.ai = LMSYS Chatbot Arena 重塑品牌（2026-01-28 改名），5M 月活 / $1.7B 估值 / 300+ 模型
- 核心哲学：多模型对比 + 盲测投票 + 智能路由
- 用户决策：Arena 只作 UI 参考，方向走纯 chat
- UI 决策：采用 Arena shadcn/ui 风格（thin bar + 4 pill tabs + Tailwind）
- CSS 变量从 dump className 提取
- shadcn 印证：`peer-data-[variant=inset]` 等典型 className
- 图标库：lucide-react
- 完整 dump：`D:\arena-dump_search_direct.json`
- dump 脚本：`scripts/arena-dump.js`
