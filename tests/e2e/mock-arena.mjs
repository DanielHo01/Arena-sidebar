// tests/e2e/mock-arena.mjs — a local stand-in for arena.ai, serving the DOM
// contract this extension actually depends on (see src/extract.ts and
// src/platform/arenaDom.ts):
//
//   user messages      main [class*="bg-surface-raised"][class*="rounded-lg"]
//                      (not w-4 / inline-flex)
//   assistant messages main [class*="bg-surface-primary"][class*="flex-col"]
//                      [class*="overflow-hidden"]
//   scroll container   main > div > div[class*="h-full"][class*="w-full"]
//                      [class*="overscroll-none"]
//   session routes     /c/{sessionId}
//
// The extension's manifest already matches http://localhost/* (kept from the
// original dev setup), so the REAL dist/ build injects here unmodified.
// This is a structural imitation, not a visual one — it exists to exercise
// the full MV3 pipeline in a real browser: content script bootstrap, DOM
// extraction, prescroll, panel rendering, chrome.storage.local persistence
// and cross-tab change events.

import http from "node:http";

/** @param {string} text */
function userMsg(text) {
	// The mock has no Tailwind layout engine, so give the ordinary conversation
	// bubbles an explicit width. Issue #32 uses the narrower 120px variant below
	// to prove the production 100px floor is not too strict.
	return `<div class="bg-surface-raised rounded-lg px-4 py-3 max-w-lg ml-auto" style="width: 360px; max-width: 512px; margin-left: auto;"><p class="whitespace-pre-wrap">${text}</p></div>`;
}

/** @param {string} text */
function assistantMsg(text) {
	return `<div class="bg-surface-primary flex flex-col overflow-hidden rounded-2xl px-4 py-3" style="width: 360px;"><div class="prose"><p>${text}</p></div></div>`;
}

/** @param {string} text */
function narrowUserMsg(text) {
	return `<div class="bg-surface-raised rounded-lg px-2 py-2" style="width: 120px; margin-left: auto;"><p class="whitespace-pre-wrap">${text}</p></div>`;
}

/** @param {string} text */
function narrowAssistantMsg(text) {
	return `<div class="bg-surface-primary flex flex-col overflow-hidden rounded-2xl px-2 py-2" style="width: 120px;"><div class="prose"><p>${text}</p></div></div>`;
}

/** @param {[string, string][]} pairs — [userText, assistantText] per round */
function narrowConversation(pairs) {
	return pairs
		.map(([u, a]) => `${narrowUserMsg(u)}\n${narrowAssistantMsg(a)}`)
		.join("\n");
}

/** @param {[string, string][]} pairs — [userText, assistantText] per round */
function conversation(pairs) {
	return pairs.map(([u, a]) => `${userMsg(u)}\n${assistantMsg(a)}`).join("\n");
}

const CONVERSATIONS = {
	"e2e-alpha": {
		title: "Alpha Conversation",
		pairs: [
			[
				"How do I cook restaurant quality risotto for a dinner party this weekend",
				"Start with carnaroli rice, toast it briefly in a dry pan, then add warm stock one ladle at a time while stirring constantly for about eighteen minutes until the grains release their starch. The texture you want is all'onda, waving like silk. Finish with cold butter and grated parmesan off the heat. A xylophone virtuoso once told me the pan should never leave the flame, and that is true of risotto too.",
			],
			[
				"Explain quantum tunneling in simple terms for a curious teenager",
				"Imagine rolling a ball at a hill it does not have the energy to climb. In the everyday world the ball always rolls back. In the quantum world the ball is also a wave, and a small part of that wave leaks through to the other side, so sometimes the particle simply appears past the barrier.",
			],
			[
				"What are the best hiking trails near Seattle for a rainy day",
				"Rattlesnake Ledge stays manageable in drizzle with wide switchbacks, Twin Falls lives up to its name and is even better in rain, and the Franklin Falls approach is short, flat, and dramatic when the water is high.",
			],
			[
				"Summarize the plot of Moby Dick in three sentences",
				"A restless teacher called Ishmael signs onto a whaling ship whose captain, Ahab, has been maimed by a white whale and now burns to kill it. The chase drags the crew past reason and into catastrophe. Only Ishmael survives, floating on a coffin, to tell us the tale.",
			],
		],
	},
	"e2e-beta": {
		title: "Beta Conversation",
		pairs: [
			[
				"Introduce yourself in one short paragraph",
				"I am a language model here to help you think, write, plan and debug.",
			],
			[
				"Plan a two day trip to Tokyo on a budget",
				"Day one: Asakusa in the morning, a free walk along the Sumida river, street food in Yanaka at dusk. Day two: the free observation deck at the Metropolitan Government building, Meiji shrine, and a konbini picnic in Yoyogi park.",
			],
		],
	},
	"e2e-issue32": {
		title: "Issue 32 Narrow Messages",
		pairs: [
			[
				Array.from({ length: 37 }, (_, i) => `sentence ${i + 1}`).join(". "),
				"This narrow assistant card is intentionally only one hundred twenty pixels wide. It must still be extracted as a real response so the conversation does not disappear while the page is settling.",
			],
			[
				"A short prompt inside a narrow card still represents a user turn.",
				"The second response confirms that every message in this realistic narrow layout remains available to the sidebar.",
			],
			[
				"Check the delayed native sidebar injection after the page loads.",
				"The Session Library entry should appear after Arena mounts its sidebar and its container in separate DOM mutations.",
			],
		],
	},
};

/**
 * Arena's native sidebar is intentionally mounted after the chat. The first
 * mutation adds only the root; the second adds the injection container. This
 * reproduces the React hydration timing behind Issue #32 instead of letting
 * the extension succeed merely because a fixture rendered everything at once.
 */
function lateSidebarScript() {
	return `<script>
setTimeout(function () {
  var sidebar = document.createElement("aside");
  sidebar.setAttribute("data-sidebar", "sidebar");
  sidebar.setAttribute("data-side", "root");
  sidebar.className = "group/sidebar-wrapper";
  document.body.appendChild(sidebar);
  setTimeout(function () {
    var container = document.createElement("div");
    container.setAttribute("data-side", "container");
    var menu = document.createElement("ul");
    menu.setAttribute("data-sidebar", "menu");
    container.appendChild(menu);
    sidebar.appendChild(container);
  }, 250);
}, 250);
</script>`;
}

function page(title, body, extra = "") {
	return `<!doctype html>
<html>
<head>
<meta charset="utf-8">
<title>${title} - Arena</title>
<script id="__NEXT_DATA__" type="application/json">{}</script>
<script>console.log("[mock] arena page booted:", location.pathname);</script>
</head>
<body>
<main>
<div>
<div class="h-full w-full overscroll-none" style="height: 85vh; overflow-y: auto;">
<div style="min-height: 3000px; padding: 16px 24px;">
${body}
</div>
</div>
</div>
</main>
${extra}
</body>
</html>`;
}

/** @param {string} sid */
function sessionPage(sid) {
	const conv = CONVERSATIONS[sid];
	if (!conv) return notFound();
	const isIssue32 = sid === "e2e-issue32";
	return page(
		conv.title,
		isIssue32 ? narrowConversation(conv.pairs) : conversation(conv.pairs),
		isIssue32 ? lateSidebarScript() : "",
	);
}

function notFound() {
	return { status: 404, body: "not found", type: "text/plain" };
}

/** Start the mock. @returns {Promise<{server: http.Server, url: string, close: () => Promise<void>}>} */
export function startMockArena(port = 8000) {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			const url = new URL(req.url ?? "/", "http://localhost");
			const sid = /^\/c\/([^/?#]+)/.exec(url.pathname)?.[1];
			let out;
			if (sid && CONVERSATIONS[sid]) {
				out = { status: 200, body: sessionPage(sid), type: "text/html" };
			} else if (url.pathname === "/") {
				// New-chat page: the arena shell with no messages.
				out = { status: 200, body: page("New Chat", ""), type: "text/html" };
			} else if (url.pathname === "/favicon.ico") {
				out = { status: 204, body: "", type: "text/plain" };
			} else {
				out = notFound();
			}
			res.writeHead(out.status, { "content-type": out.type });
			res.end(out.body);
		});
		server.listen(port, "127.0.0.1", () => {
			resolve({
				server,
				url: `http://127.0.0.1:${port}`,
				close: () => new Promise((done) => server.close(() => done(undefined))),
			});
		});
	});
}
