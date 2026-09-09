#!/usr/bin/env bash
# 一次性 housekeeping 脚本：关闭 7 个已在代码中实现、但因 squash merge 未自动关闭的僵尸 issues。
# 用法（需要你自己的 GitHub 权限，agent 的 bot token 无 issue 写权限）：
#   bash scripts/close-stale-issues.sh
# 跑完后可删除本文件。
set -euo pipefail

gh issue close 8 --comment '已在 PR #18（commit 2eff251）修复：根因是设计 token 挂在 :root 而样式注入在 closed shadow root 内导致 var() 静默失效；已迁到 :host 并给 FAB 加了不透明底板。回归测试：tests/unit/theme.test.ts。squash merge 信息不是 closing keyword 所以没自动关，现手动关闭。'

gh issue close 9 --comment '已在 PR #18（commit 2eff251）实现：auto/light/dark 三档主题（按页面 html.dark → data-theme → color-scheme → prefers-color-scheme 优先级解析）+ 面板头部手动切换按钮 + 跨标签持久化。回归测试：tests/unit/theme.test.ts 15 例。手动关闭。'

gh issue close 10 --comment '已实现（src/ui/keyboard.ts，PR #4 起覆盖测试）：Alt+S 开关面板、↑/↓ 轮次导航、Enter 跳转、Esc 关闭，在输入框聚焦时自动让路。唯一与建议不同的是 toggle 键用 Alt+S 而非 Ctrl+Shift+S（减少与浏览器/页面快捷键冲突）。如需改键请 reopen。'

gh issue close 11 --comment '已实现：基于 chrome.storage.onChanged 的跨标签同步——主题（features/theme.ts）、隐藏轮次（rounds.ts，经 loop.ts 按会话重订阅）、文件夹（ui/arenaSidebar.ts）、会话元数据（content.ts setupSessionMetaSync）。覆盖本 issue 的重命名/移动同步诉求，关闭。'

gh issue close 12 --comment '已在 PR #7（commit 5ca6031）实现：src/ui/panel/list.ts 的搜索同时匹配 title + userPreview + assistantPreview + 全部消息 m.content 全文，不再只搜标题/截断预览。关闭。'

gh issue close 13 --comment '已在 PR #2 实现：src/ui/inlineRename.ts 内联编辑器统一了双击/右键两条重命名路径，window.prompt() 已从生产代码删除（仅剩注释提及）。支持 Esc 取消。关闭。'

gh issue close 16 --comment 'PR #7（commit 5ca6031）已把搜索从截断预览扩展到消息全文（src/ui/panel/list.ts 匹配全部 m.content）并加了变异探针验证，应已解决漏结果问题。如仍有特定关键词复现漏轮次，请带例子 reopen。'

echo 'Done. Remaining open issues should be #14 (Battle 模式), #15 (消息编辑/删除), #17 (命名冗余).'
