# 架构与门禁（当前状态）

> 这份文档描述**现在**的代码，不是计划。数字都是 2026-10-07 实测的，
> 每一条都能用下面列出的命令复现。历史计划文档在 `docs/archive/`，
> 里面的行数/覆盖率数字已经过期，只作为决策记录保留。

这是一个 **纯前端 Chrome MV3 扩展**：没有后端、没有 `background` service worker、
零运行时依赖。全部状态在页面侧（content script isolated world）+ `chrome.storage.local`。
唯一"像服务器"的东西是测试用的 `tests/e2e/mock-arena.mjs`（假 arena.ai）。

## 1. 运行时形状

```
arena.ai 页面 (MAIN world)
  └─ public/inject-hook.js ── fetch/XHR/RSC 打钩 ── CustomEvent ──┐
                                                                  │ dispatchEvent
content script (isolated world)  ← src/content.ts 是唯一入口
  ├─ 读 DOM（extract / prescroll / bootstrapExtract）
  ├─ 写 DOM（src/ui/**，全部在 closed shadow root 内）
  └─ chrome.storage.*（唯一入口 src/platform/storage.ts）
```

- `src/manifest.json` 只声明 `content_scripts`（+ `storage` 权限、`world: MAIN` 的 hook）。
- 加 service worker 之前，先回来改 §3 的两条硬规则（`chrome.*` 只在 platform、入口不被 import）。

## 2. 分层与依赖方向

`src/` = **49 个 `.ts` / 7,153 行**。层级不是目录美观，而是一条可执行约束
（`scripts/check-layers.ts`，`npm run arch:check`）：

| 层 | rank | 允许 import |
| --- | --- | --- |
| `src/types.ts` | −1 | （不能 import 任何东西） |
| `src/core/**` | 0 | `core/**`, `types` |
| `src/platform/**` | 1 | + `platform/**` |
| `src/app/**` `src/features/**` `src/capture/**` `src/ui/**` | 2 | + 同层、以及未分层的 `src/*` |
| `src/content.ts` | 3（入口） | 一切；且**不允许被任何模块 import** |

同层之间允许横向引用（`features → features`）——真实代码本来就有，
禁止只会逼出 `// eslint-disable`。

### 目前仍未分层的 9 个模块

`types.ts` `content.ts` 是设计如此；其余是迁移债：

```
src/state.ts 14 · src/conversationStore.ts 9 · src/rounds.ts 8 · src/extract.ts 4
src/capture.ts 4 · src/historyTitles.ts 3 · src/titleResolver.ts 3
src/ui/styles.ts 3 · src/ui/panel.ts 2          合计 50 条入边
```

`50` 是 `ROOT_IN_EDGE_MAX` 上限，只降不升。`src/capture.ts`、`src/ui/panel.ts`、
`src/ui/styles.ts` 是纯 re-export 桶文件（22/17/15 行），删掉就能让上限往下走。
另外注意 **`src/rounds.ts`（188 行，隐藏/删除状态）与 `src/core/rounds.ts`（115 行，
轮次分组）同名不同义**，是分层收尾时最容易踩的合并陷阱。

## 3. `arch:check` 的十条规则

每条都在 `tests/unit/layer-rules.test.ts`（23 个用例）里对着合成 fixture 验过"能抓到、
不误报"，并且有一条反向用例专门盯住 `KNOWN_DEBT` 登记表——债被偿掉却忘了删登记时，
`stale-debt` 会让它自己变红。规则失效不会静默。

| 规则 | 触发条件 |
| --- | --- |
| `no-upward-import` | 违反 §2 的方向；**循环依赖同一条报错**（沿栈找回边） |
| `core-purity` | `core/**` 里出现 `document.` / `window.` / `localStorage` / `sessionStorage` / `requestAnimationFrame` / `HTMLElement` / `Element` |
| `chrome-only-in-platform` | `platform/**` 之外出现 `chrome.` |
| `entry-not-imported` | 有模块 import `content.ts` |
| `types-has-no-imports` | `types.ts` 里有 import |
| `no-cycle` | SCC 塌缩后剩余环（兜底） |
| `unresolved-import` | 本地 `./` `../`  specifier 解析不到磁盘文件（挡 TS 别名和静默失效的重构） |
| `file-size-ceiling` | 单个文件 > `FILE_LINES_MAX = 420` 行 |
| `unlayered-coupling-ratchet` | 未分层模块入边 > `ROOT_IN_EDGE_MAX = 50` |
| `stale-debt` | 登记表里的债边已不存在 |

当前全绿输出：

```
✓ layer contract holds — no violations
edges: 155 · unlayered inbound: 50/50 · largest file: 415/420 · debt: 3 pair(s)
```

### 已知债（`KNOWN_DEBT`，故意允许而非重写）

三处 UI 动作处理器需要整个抓取生命周期，而"启动/停止抓取"的唯一入口在 app 层：

```
src/ui/panel/{keyboard,modals,roundItem}.ts → src/app/lifecycle.ts   （app 高于 ui）
```

### 行数天花板怎么来的

`420` = 当前最差文件（`src/platform/storage.ts` 414 行）+ 6。**它是天花板不是目标**：
Track A 把 `storage.ts`（414）、`conversationStore.ts`（379）、`extract.ts`（365）拆开时，
必须把常量一起往下调——这是有意的，防止"以后再说"。

它同时拆穿了一条历史验收标准："files over 300 lines: 0"（`docs/archive/plan.md`）
从未为真：现在有 6 个文件超过 300 行（`platform/storage.ts` 414、`conversationStore.ts` 379、
`extract.ts` 365、`features/sessions.ts` 314、`ui/arenaSidebar.ts` 309、`content.ts` 309）。

## 4. 测试与覆盖率地板

`vitest.config.ts` 里每层一个阈值对象，四个数字都是 **实测值下取整 + 1**，
所以它们是地板：任何一次"往被测模块里塞未测试分支"都会红，而不是把平均值稀释掉。

| 范围 | 地板（语句/分支/函数/行） | 实测 |
| --- | --- | --- |
| 全局 | 94 / 85 / 95 / 96 | 94.99 / 86.2 / 95.96 / 96.63 |
| `src/core/**` | 99 / 90 / 100 / 100 | 99.22 / 91.46 / 100 / 100 |
| `src/platform/**` | 96 / 89 / 91 / 99 | 96.62 / 89.93 / 91.83 / 99.03 |
| `src/app/**` | 96 / 94 / 87 / 98 | 96.82 / 94.11 / 87.5 / 98.19 |
| `src/features/**` | 93 / 88 / 96 / 96 | 93.43 / 88.23 / 96.42 / 96.14 |
| `src/ui/**` | 98 / 90 / 97 / 99 | 98.79 / 91.73 / 97.7 / 99.55 |

四项都不带 `lines` 的旧全局阈值（42/42/45/42）是装饰性的：`core` 在 99% 也过、
在 43% 也过。这正是把它换成上表的原因。

明确不进覆盖率的 4 个纯 re-export 桶（`src/capture.ts`、`src/ui/panel.ts`、
`src/ui/styles.ts`、`src/types.ts`）：一个 `export {}` 桶没有任何可执行语句，
留着就按 0% 计入分母。`public/inject-hook.js` 同理，由 e2e 覆盖。

两处值得记的配置（`vitest.config.ts` 里有同样内容的注释）：

- `pool: "vmThreads"` —— 套件 80% 的墙钟是 jsdom 启动，而 jsdom 不需要进程隔离。
  切过去 42 文件全绿、23.6 s → 4.5 s，`per-file isolation` 仍然保留。
- `sequence.shuffle: true` —— 顺序随机化抓出了两个真实缺陷：`capture.test.ts` 的
  `beforeEach` 漏了 `resetCaptureState()`；`panel-round-item.test.ts` 的三个 `describe`
  各带一份互相漂移的 mock 重置（其中一个因此**从没测到生产路径**）。
  复现某一次失败：`npx vitest run --sequence.shuffle --sequence.seed=<n>`。

e2e（`.github/workflows/ci.yml` 的 `End-to-end (Chromium)` 步骤）跑的是真实 `dist/`：
构建 → 起 mock arena → headless Chromium 加载扩展（本机没有系统 Chrome 时先
`npm run browser:setup`）→ 13 步断言。CI 的 ubuntu-latest 自带
`/usr/bin/google-chrome-stable`，所以这一步不需要额外配置。

## 5. 体积预算与 `dist/` 实际内容

`content.ts-*.js` **74,143 B**（gzip-9 **23,342 B**），预算 75,000 / 25,000 ——
只剩 **857 字节**（1.1%）的余量。预算故意设成棘轮：它现在的作用是防止变胖，
Track A 拆完文件后应把它压到 ~60 KB 并把预算一起调小（理由写进 commit message）。
量法必须是 `gzip -c9 dist/assets/content.ts-*.js | wc -c`，与 CI 一致；
不要引用 vite 打印的 `23.57 kB`（那是 `gzip -6` + 1000 进制，差 ~200 B）。

`dist/` 全量 **85,727 B / 12 个文件**：

| 文件 | 字节 | 来源 / 谁引用 |
| --- | --- | --- |
| `assets/content.ts-*.js` | 74,143 | 打包产物，`content_scripts[1].js` |
| `assets/inject-hook.js-*.js` | 896 | crx 把 manifest 里的 `public/inject-hook.js` **重写**成 hash 产物 |
| `inject-hook.js` | 1,883 | publicDir 原样拷贝；只被下面那条 WAR 引用 |
| `manifest.json` | 1,795 | — |
| `icons/icon-*.png` | 3,505 | publicDir 原样拷贝（**规范位置**），**没人引用** |
| `public/icons/icon-*.png` | 3,505 | 同样 4 个文件的第二份；被 `manifest.icons` 引用 |

两条都成立的事实，值得 Track A 收：

1. **图标能显示纯属侥幸。** `src/manifest.json` 的 `icons` 写的是 `public/icons/…`——
   带着 `public/` 前缀，也就是 Vite publicDir **不会**产出的位置（publicDir 拷贝会去掉
   这层前缀，规范路径是 `dist/icons/…`）。它现在能跑，只是因为 crx 额外产出了
   `dist/public/icons/`。把 manifest 改成 `icons/icon-16.png` 就指向真正规范的那份，
   `dist/public/` 整层消失，省 3,505 B（包的 4%）。
   验证方式（改完必须两条都跑，光看构建成功不够）：
   `ls dist/public 2>&1`（应为 no such file）＋ `npm run test:e2e`（真 Chromium 加载真 `dist/`）。
   在 manifest 路径没理顺之前，**不要**往 `public/` 里放任何新文件：那里的文件名是
   "看起来有 `public/` 前缀、实际没有"的双重身份，容易踩。
2. **一条没人用的 `web_accessible_resources`。** `resources: ["inject-hook.js"]`
   在 `src/` 里没有任何 `chrome.runtime.getURL` 消费方（grep 只找到注释），
   hook 是靠 `world: "MAIN"` 的 content_script 注入的；而且它的 `matches` 里带着
   `http://127.0.0.1:8000/*` 与 `http://localhost:8000/*` 两个**只属于开发环境**的
   origin，却会随包发出去。删掉这一整条 WAR：`public/inject-hook.js` 就只剩 crx 那份
   hash 产物（`dist/inject-hook.js` 与 1,883 B 一起消失），更重要的是页面上任何脚本
   从此 GET 不到这个扩展资源——安全面收窄。同样以 e2e 为准（13 步里有 hook 注入的断言）。

`public/` 是 Vite `publicDir`，**里面每个文件都会进扩展包**，所以非扩展资产不要放这里
（`docs/assets/pelican-bicycle.svg` 就是这样被移出去的）。

## 6. 复杂度实测（与"要重写"的直觉相反）

- 176 个函数，只有 5 个超过 60 行，最长 82 行（`computeRounds`）。函数大小**不是**问题。
- 31 个模块级 `let` 分布在 17 个文件（最多 `src/app/loop.ts` 6 个）。
  `src/state.ts` 是 4 个可变单例、被 14 个模块 import。
- `src/app/store.ts` 已经用 disposer 注册表把"注册↔清理"绑在一起，
  `tests/unit/lifecycle.test.ts` 守住了配对不被拆散。
- 结论：复杂度问题集中在**状态与所有权**（§2 的桶文件、§6 的模块级 `let`、
  `conversationStore.ts:163` 的 `as any`），不在控制流。

## 7. 后续（按此顺序做，每步全绿再进下一步）

1. **A 减负**：拆 3 个 >300 行的热文件；删 3 个纯桶；图标去重；
   然后**同时**把 `FILE_LINES_MAX`、`ROOT_IN_EDGE_MAX`、体积预算往下调。
2. **B 分层收尾**：`conversationStore` / `rounds` / `extract` / `historyTitles` /
   `titleResolver` 归位，`types.ts` → `core/types.ts`，把 `unlayered-coupling-ratchet`
   一路降到 0。
3. **D 状态收敛**：模块级 `let` → 显式 owner，3 个 `app → ui` 债边清零并删掉 `KNOWN_DEBT`。
4. `npm run test:coverage` 与 `--sequence.shuffle` 保持常开；e2e 若真在 CI 里变红，
   修 `arenaContract` 的选择器而不是跳测试。
