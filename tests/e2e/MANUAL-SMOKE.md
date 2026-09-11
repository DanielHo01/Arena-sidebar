# 真 Arena 手动冒烟清单

沙箱无法访问 arena.ai(网络封锁 + 需要登录态),以下是 E2E 无法代验、需要你在真环境里跑一遍的清单。每步 30 秒内可完成,顺序即依赖顺序。

## 准备

1. `npm ci && npm run build`(dist/ 即待测构建)
2. Chrome → `chrome://extensions` → 开发者模式 →「加载已解压的扩展程序」→ 选 `dist/`
3. 登录 https://arena.ai,打开任一有多轮对话的会话

## §0 结构探针（DOM 改版时才跑，不是每次 PR）

选择器合同在 `src/platform/arenaContract.ts`，CI 用
`tests/__fixtures__/probes/*.json` 重放生产函数。平时 **`npm test` 就是
验收**；下面只在 arena.ai 改了布局、或 CI 合同测试红了时做。

1. `npm run gen:probe`（不要手改 `scripts/arena-probe.js`）
2. 打开探针全文，在出问题的那一页 Console 粘贴（只读）
3. 把复制到的 **`snapshot`** 存成 `tests/__fixtures__/probes/<id>.json`
   （对话正文改成占位句；核对 `expect.battle` / `expect.sidebar`）
4. `npm test` — 新文件会被自动拾取

探针头两行仍可扫一眼：`Battle检测 verdict`、`提取器 user/asst`。
`FAB=false` 在 closed shadow 下是正常误报，不要当扩展没注入。
详情见 `tests/__fixtures__/probes/README.md`。

## 自动化页面执行测试

本项目也提供了一个本地 Arena 页面服务器和真实 Chromium 执行器。它不是 jsdom
单元测试：会加载真实 `dist/` bundle，执行真实 content script、MutationObserver、
Shadow DOM、滚动、输入事件和 storage 流程。

```bash
npm run build
npm run test:e2e
```

如果环境没有 Chrome/Edge，可以在网络受限的沙箱中先执行：

```bash
node tests/e2e/setup-browser.mjs
E2E_MODE=script \\
E2E_BROWSER=/tmp/chromium \\
LD_LIBRARY_PATH=/tmp/arena-sidebar-e2e-browser/al2023/lib \\
npm run test:e2e
```

`E2E_MODE=auto` 默认优先尝试 MV3 extension mode；如果浏览器没有成功加载扩展，
会自动回退到 script mode。Issue #32 的页面场景 `/c/e2e-issue32` 会验证：

- 37 句用户长消息不会被 `tooManyLines` 丢弃
- 120px 用户/助手卡片仍会被提取
- Sidebar root 和 injection container 分两次延迟挂载后，Session Library 仍会注入
- 面板最终显示 3 个轮次、6 条消息

## 冒烟步骤

### ① 隐藏 → 刷新 → 恢复(持久化 + 恢复模式)

- [ ] 悬停某一轮 → 点 ✕ → 该轮从列表消失,底部出现「N hidden round(s)」条
- [ ] **F5 刷新页面** → 面板恢复后该轮**仍然隐藏**,底部条还在(存储键 `edge-ai-sidebar:hidden-rounds:{会话id}` 生效)
- [ ] 点底部条 → 进入恢复模式:隐藏轮**暗淡显示、按钮变 ↩**
- [ ] 点 ↩ → 轮恢复,底部条消失

### ② 跨标签实时同步(核心验证点)

- [ ] 同一会话在**第二个标签页**打开(等待面板渲染)
- [ ] 在标签页 B 悬停某轮 → 点 ✕
- [ ] **不刷新**标签页 A → A 的面板应在 ~1 秒内自动:该轮消失 + 底部条出现
- [ ] 反向再验一次:B 恢复,A 自动跟回 4 轮无条

### ③ 全文搜索命中截断预览之外的词

- [ ] 打开一个**长回答**的会话,从某轮回答正文 100 字符以后挑一个不常见的词
- [ ] 面板搜索框输入该词 → 该轮应被命中(旧版只搜标题/60/100 字符预览,命中不了)

### ④ Direct chat(无会话路由)

- [ ] 打开 Arena 的 direct chat(非 /c/ 路由)发几条消息
- [ ] 面板显示这些轮;✕ 隐藏**不持久化**(刷新即回)——这是有意设计
- [ ] 切回 /c/ 会话 → 之前隐藏的轮不受影响(会话隔离)

### ⑤ 竞态修复的日常观察(可选)

- [ ] 在一个**安静**(无流式输出)的页面切换会话 → 新会话的面板应立即渲染,而不是空白 30 秒后才出现(本轮 E2E 发现并修复的 bug)

### ⑥ Battle 模式提示(#14 / #21)

检测本身由 `search-arena-battle-2026-09-09` 合同快照覆盖，不必为了合 PR 再采一次。
真站抽检（可选，合同红了或 Arena 改版时）：

- [ ] 打开一个 Battle 对话(盲测双模型 + 投票按钮的页面)
- [ ] 面板(或 FAB 点开后)应显示 `⚔️ Battle mode — round navigation isn't supported here yet`,而不是空白无 UI
- [ ] 切回 Direct Chat / 普通 /c/ 会话 → 提示消失,轮次正常渲染

### ⑦ 本地编辑 / 删除(#15)

- [ ] 悬停某一轮 → 点 ✏️ → 改几个字回车 → 行标题即时更新,meta 显示 `✏️ edited`
- [ ] **F5 刷新** → 编辑保留(存在会话消息记录里)
- [ ] 悬停另一轮 → 点 🗑️ → 按钮变 ❓ → 再点 → 该轮消失;**F5 刷新不复活**(tombstone 键 `edge-ai-sidebar:deleted-messages:{会话id}`)
- [ ] 跨标签验证:另一标签页打开同一会话 → 删除/编辑应在 ~1 秒内同步过去(删的表现是行消失)
- [ ] 回到 arena.ai 页面本身确认:**原对话内容未被改动**(扩展只改自己的导航数据,这是有意设计——arena 官方没有消息级编辑 API)

## 期望之外的表现 → 告诉我

- 刷新后隐藏状态丢失 / 恢复成 4 轮
- 跨 tab 不同步,必须刷新才跟上
- 恢复模式卡死(全部恢复后底部条还在,或新隐藏的轮显示成暗淡+↩ 而不是消失+条)
- 搜索长回答正文无结果
- 编辑后刷新丢失 / 行标题没更新
- 删除后刷新复活,或另一标签页不同步消失

任何一条不符,把会话 URL 特征(不要发内容)+ 现象发我即可复现排查。
