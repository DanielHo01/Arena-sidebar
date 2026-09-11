# Arena DOM 合同快照

这些 JSON 是真站页面的**可重放摘要**，不是完整 HTML。CI 会 `mount` 它们，然后跑生产代码里的 `detectBattleMode` / `extractMessages` / `inspectArenaQuickNav` / `queryScrollContainer`。

人不用每次 sideload 点一遍。人只在 arena.ai 改版（或怀疑改版）时采样。

## 新增一份快照

1. 登录 arena.ai，打开目标页（Direct / Battle / Max / Agent）。
2. 复制 `scripts/arena-probe.js` 全文（由 `npm run gen:probe` 生成，不要手改）。
3. F12 → Console → 粘贴 → 回车。只读，不点、不写。
4. 输出 JSON 里取 **`snapshot`** 字段，存成 `tests/__fixtures__/probes/<id>.json`。
5. 核对 `expect`：Battle 页 `battle: true`，Direct/Max `battle: false`，侧栏能注 Session Library 则 `sidebar: "ok"`。
6. `npm test` — 新文件会被自动拾取。

对话正文请改成占位句（助手 ≥ 50 字，用户 ≥ 3 字）。宽度用 `messages[].width` 记录，#28 那种宽屏气泡写 `1400`。

## 何时必须再采一次

- `detectBattleMode` / 提取选择器 / 侧栏选择器 要改
- 探针 `verdict` 或 `extract.userSelHits` 和这份 JSON 对不上
- Arena 明显改了布局

`scripts/arena-probe.js` 过期时 `npm run probe:check`（CI 也会跑）会红，先 `npm run gen:probe`。
