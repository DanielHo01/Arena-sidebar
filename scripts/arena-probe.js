/* Arena Sidebar 真站结构探针 v1
 *
 * 只读保证：不点击、不写 DOM、不发请求、不碰存储、不污染页面
 * （连扩展打的 data-ai-sidebar-id 标记都不会碰，只 query 不 set）。
 *
 * 用法：登录 arena.ai → 打开一个有完整对话的页面 → F12 → Console →
 * 粘贴本文件全部内容 → 回车 → 把输出贴回给 AI。
 * 在 Direct / Battle / Agent / Model 四种页面各跑一次（Battle 页要求
 * 双回答已生成完、投票条可见时再跑）。
 */
(() => {
	const cap = (s, n) =>
		(s === null || s === undefined ? "" : String(s))
			.replace(/\s+/g, " ")
			.trim()
			.slice(0, n);
	const cls = (el) =>
		cap(typeof el.className === "string" ? el.className : "", 100);
	const uniq = (arr) => [...new Set(arr)];
	const out = {
		probe: "arena-probe-v1",
		url: location.href,
		title: document.title,
		inIframe: window !== window.top,
		time: new Date().toISOString(),
	};
	try {
		// ── 1. 模式 tab（#14 信号 1 的依据） ──────────────────────────
		out.tabs = [
			...document.querySelectorAll('[role="tab"], button[aria-pressed]'),
		]
			.slice(0, 20)
			.map((el) => ({
				tag: el.tagName,
				text: cap(el.textContent, 40),
				role: el.getAttribute("role") || "",
				ariaSelected: el.getAttribute("aria-selected") || "",
				ariaPressed: el.getAttribute("aria-pressed") || "",
				dataState: el.getAttribute("data-state") || "",
				testid: el.getAttribute("data-testid") || "",
				cls: cls(el),
			}));

		// ── 2. 全页按钮清单（投票条藏在这里） ─────────────────────────
		const buttons = [...document.querySelectorAll('button, [role="button"]')];
		out.buttonCount = buttons.length;
		out.buttons = buttons
			.filter(
				(b) =>
					cap(b.textContent, 1) !== "" ||
					(b.getAttribute("aria-label") || "") !== "",
			)
			.slice(0, 120)
			.map((b) => ({
				text: cap(b.textContent, 60),
				ariaLabel: cap(b.getAttribute("aria-label"), 60),
				testid: cap(b.getAttribute("data-testid"), 60),
				cls: cls(b),
			}));

		// ── 3. 复刻 #14 检测逻辑，直接给出"会不会误报/漏报" ──────────
		const ACTIVE_TAB =
			'[role="tab"][aria-selected="true"], [role="tab"][data-state="active"], button[aria-pressed="true"]';
		let signal1 = null;
		for (const tab of document.querySelectorAll(ACTIVE_TAB)) {
			if (/battle/i.test(tab.textContent || "")) {
				signal1 = cap(tab.textContent, 40);
				break;
			}
		}
		const patterns = [/a is better/, /b is better/, /\btie\b/, /both bad/];
		const signal2 = patterns.map((p, i) => ({
			pattern: String(p),
			hit: buttons.some((b) => p.test((b.textContent || "").toLowerCase())),
			hitTexts:
				i === 2
					? undefined // "tie" 太常见，不列命中文本
					: uniq(
							buttons
								.filter((b) => p.test((b.textContent || "").toLowerCase()))
								.map((b) => cap(b.textContent, 40)),
						).slice(0, 5),
		}));
		out.battleDetect = {
			signal1ActiveBattleTab: signal1,
			signal2VotePatterns: signal2,
			quorumHits: signal2.filter((s) => s.hit).length,
			quorumNeeded: 3,
			verdict: signal1 !== null || signal2.filter((s) => s.hit).length >= 3,
		};

		// ── 4. 语义钩子清单（data-testid / data-* / 关键词 class） ─────
		out.testids = uniq(
			[...document.querySelectorAll("[data-testid]")]
				.map((el) => cap(el.getAttribute("data-testid"), 80))
				.filter(Boolean),
		).slice(0, 150);
		const dataNames = new Set();
		const dataStates = new Set();
		const classKw = new Set();
		const KW =
			/vote|battle|model|agent|message|turn|chat|tab|mode|column|versus|arena/i;
		const all = document.getElementsByTagName("*");
		const N = Math.min(all.length, 8000);
		for (let i = 0; i < N; i++) {
			const el = all[i];
			for (const a of el.attributes || []) {
				if (a.name.startsWith("data-")) {
					dataNames.add(a.name);
					if (a.name === "data-state") dataStates.add(cap(a.value, 30));
				}
			}
			if (typeof el.className === "string") {
				for (const tok of el.className.split(/\s+/)) {
					if (KW.test(tok)) {
						classKw.add(tok.slice(0, 60));
						if (classKw.size >= 100) break;
					}
				}
			}
		}
		out.dataAttrNames = [...dataNames].sort();
		out.dataStateValues = [...dataStates].sort();
		out.keywordClasses = [...classKw].sort();

		// ── 5. 提取器选择子在该页命中数（Agent/Model 页重点看这个） ───
		const USER_SEL =
			'main [class*="bg-surface-raised"][class*="rounded-lg"]:not([class*="w-4"]):not([class*="inline-flex"])';
		const ASST_SEL =
			'main [class*="bg-surface-primary"][class*="flex-col"][class*="overflow-hidden"]';
		const users = [...document.querySelectorAll(USER_SEL)];
		const assts = [...document.querySelectorAll(ASST_SEL)];
		out.extract = {
			userSelHits: users.length,
			asstSelHits: assts.length,
			userSample: users[0]
				? {
						tag: users[0].tagName,
						text: cap(users[0].textContent, 60),
						cls: cls(users[0]),
					}
				: null,
			asstSample: assts[0]
				? {
						tag: assts[0].tagName,
						text: cap(assts[0].textContent, 60),
						cls: cls(assts[0]),
					}
				: null,
		};

		// ── 6. 扩展自检（host / FAB / Battle 提示是否渲染） ───────────
		const host = document.getElementById("__edge_ai_sidebar_host");
		const shadowText = host?.shadowRoot
			? cap(host.shadowRoot.textContent, 400)
			: "";
		out.extension = {
			hostPresent: !!host,
			hasShadow: !!host?.shadowRoot,
			fabPresent: !!host?.shadowRoot?.querySelector(".fab"),
			battleNoticeShown: shadowText.includes("Battle mode"),
			panelTextHead: shadowText,
		};

		// ── 7. 其他已知假设 ───────────────────────────────────────────
		out.scrollContainerFound = !!(
			document.querySelector("main [data-radix-scroll-area-viewport]") ||
			document.querySelector('main [class*="overscroll-none"]') ||
			document.querySelector(
				'main > div > div[class*="h-full"][class*="w-full"][class*="overscroll-none"]',
			)
		);
		out.historyLinkCount = document.querySelectorAll('a[href*="/c/"]').length;
		out.elementCount = all.length;
		out.scannedElements = N;

		// ── 输出 ──────────────────────────────────────────────────────
		console.log(
			"%c=== ARENA PROBE v1 · " + out.url + " ===",
			"font-weight:bold",
		);
		console.log(
			`Battle检测: verdict=${out.battleDetect.verdict}（tab信号=${JSON.stringify(out.battleDetect.signal1ActiveBattleTab)} 投票quorum=${out.battleDetect.quorumHits}/3）`,
		);
		console.log(
			`提取器: user=${out.extract.userSelHits} asst=${out.extract.asstSelHits} · 扩展host=${out.extension.hostPresent} FAB=${out.extension.fabPresent} Battle提示=${out.extension.battleNoticeShown} · 按钮${out.buttonCount}个 历史链接${out.historyLinkCount}个`,
		);
		const json = JSON.stringify(out, null, 1);
		console.log(json);
		let copied = false;
		try {
			// Chrome DevTools 自带 copy()，页面里没有则跳过
			if (typeof copy === "function") {
				copy(out);
				copied = true;
			}
		} catch {
			/* ignore — 下面走 clipboard */
		}
		if (!copied && navigator.clipboard?.writeText) {
			navigator.clipboard
				.writeText(json)
				.then(() =>
					console.log("%c✔ 已复制到剪贴板，直接粘贴即可", "color:green"),
				)
				.catch(() =>
					console.log(
						"%c剪贴板被拦，手动三击选中上面的 JSON 复制",
						"color:orange",
					),
				);
		} else if (copied) {
			console.log("%c✔ 已复制到剪贴板，直接粘贴即可", "color:green");
		}
	} catch (e) {
		console.log(
			"%c探针出错（把这行连同 URL 发我）: " + ((e && e.message) || e),
			"color:red",
		);
		console.log(JSON.stringify(out, null, 1));
	}
})();
