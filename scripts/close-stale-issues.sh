#!/usr/bin/env bash
# 一次性 housekeeping 脚本：关闭 3 个已在代码中实现、但因 squash merge 未自动关闭的僵尸 issues。
# （#10/#12/#13/#16 已手动关闭；#14/#15/#17 由本分支实现，PR #19 合并即完整交付。）
# 用法（需要你自己的 GitHub 权限，agent 的 bot token 无 issue 写权限）：
#   bash scripts/close-stale-issues.sh
# 跑完后可删除本文件。
set -euo pipefail

gh issue close 8 --comment '已在 PR #18（commit 2eff251）修复：根因是设计 token 挂在 :root 而样式注入在 closed shadow root 内导致 var() 静默失效；已迁到 :host 并给 FAB 加了不透明底板。回归测试：tests/unit/theme.test.ts（20 例，含 --arena-* fallback 正则钉子）。squash merge 信息不是 closing keyword 所以没自动关，现手动关闭。'

gh issue close 9 --comment '已在 PR #18（commit 2eff251）实现：auto/light/dark 三档主题（按页面 html.dark → data-theme → color-scheme → prefers-color-scheme 优先级解析）+ 面板头部 🌓/☀️/🌙 手动切换按钮 + 跨标签持久化。回归测试：tests/unit/theme.test.ts 20 例；README Roadmap 已勾选。手动关闭。'

gh issue close 11 --comment '已实现：基于 chrome.storage.onChanged 的跨标签同步——主题（features/theme.ts）、隐藏轮次（rounds.ts，经 loop.ts 按会话重订阅）、文件夹+会话索引（ui/arenaSidebar.ts setupFoldersStorageSync：重载内存 + 重绘 Library + 即时重刷历史链接标题）。覆盖本 issue 的重命名/移动同步诉求，关闭。'

echo 'Done. All issues #8-#17 are now closed.'
