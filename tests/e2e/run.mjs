// tests/e2e/run.mjs — end-to-end verification of the built extension in a
// real Chromium against the local arena mock (mock-arena.mjs).
//
// What makes this different from tests/unit: nothing is mocked here except
// Arena's DOM and (in script mode, below) the chrome.* platform. The real
// dist/ build runs, the real prescroll scrolls, the real Shadow DOM renders,
// and real input events click the real panel. The panel's shadow root is
// closed, so the harness drives it through raw CDP (DOM.getDocument with
// pierce: true) and raw input events — the same channel DevTools uses — plus
// the host element's data-* mirror for waits.
//
// No bundled browser, no puppeteer/playwright: the harness speaks CDP over a
// WebSocket itself and runs against any local Chromium you point it at.
//
// Two ways the dist/ build gets into the page:
//
//   extension mode (default, E2E_MODE=extension/auto) — launch Chromium with
//     --load-extension=dist. The full MV3 pipeline runs.
//   script mode (E2E_MODE=script) — install the REAL built bundles via
//     Page.addScriptToEvaluateOnNewDocument at document creation (the same
//     timing as run_at: document_start), plus a high-fidelity chrome.storage
//     stub: localStorage for persistence, BroadcastChannel for cross-tab
//     change events, and — like the real thing — the writer's own tab also
//     receives the change event. Used where no extension-capable browser
//     exists (locked-down sandboxes whose only open channel is npm, whose
//     Chromium builds ship without extension support).
//
//   E2E_MODE=auto (default) tries extension mode first and falls back to
//   script mode automatically if the content script does not appear.
//
//   E2E_BROWSER=/path/to/chrome npm run test:e2e   # pick a browser
//   E2E_HEADED=1 ...                                # watch it run

import { spawn } from "node:child_process";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import process from "node:process";
import WebSocket from "ws";
import { startMockArena } from "./mock-arena.mjs";

const DIST = path.resolve("dist");
const BASE_PORT = Number(process.env.E2E_PORT ?? 8000);
const MODE = process.env.E2E_MODE ?? "auto";

// ─── Script mode: the chrome.* platform stub ───────────────────────────────────
//
// Fidelity notes, because they are the point:
//   - get/set/remove are async, exactly like MV3 chrome.storage.local.
//   - onChanged fires in EVERY context that subscribed — including the tab
//     that performed the write (setupHiddenRoundsSync counts on that echo).
//   - Cross-tab delivery is async (BroadcastChannel), same as the real
//     cross-process event; same-tab delivery happens on the write path.

const CHROME_STORAGE_STUB = `
(() => {
  // Script mode starts even earlier than a real document_start content
  // script (new-document time) and also runs on about:blank, where
  // localStorage is off-limits — guard both.
  if (location.protocol !== "http:" && location.protocol !== "https:") return;
  if (window.chrome && window.chrome.storage) return;
  const bc = typeof BroadcastChannel === "function"
    ? new BroadcastChannel("e2e-storage")
    : null;
  const listeners = new Set();
  const readAll = () => {
    try { return JSON.parse(localStorage.getItem("__e2e_store") || "{}"); }
    catch { return {}; }
  };
  const writeAll = (obj) =>
    localStorage.setItem("__e2e_store", JSON.stringify(obj));
  const notify = (changes) => {
    for (const l of [...listeners]) {
      try { l(changes, "local"); } catch (e) { /* a listener must not break the writer */ }
    }
  };
  if (bc) bc.onmessage = (ev) => notify(ev.data);
  // Cross-tab: the storage event fires in every OTHER same-origin tab —
  // the standard channel, and the closest match to how real
  // chrome.storage.onChanged reaches the other tabs. Diff old vs new to
  // build the same {key: {oldValue, newValue}} shape the writer produced.
  window.addEventListener("storage", (ev) => {
    if (ev.key !== "__e2e_store" || !ev.newValue) return;
    let oldAll = {}, newAll = {};
    try { oldAll = ev.oldValue ? JSON.parse(ev.oldValue) : {}; } catch {}
    try { newAll = JSON.parse(ev.newValue); } catch { return; }
    const changes = {};
    const keys = new Set([...Object.keys(newAll), ...Object.keys(oldAll)]);
    for (const k of keys) {
      if (JSON.stringify(newAll[k]) !== JSON.stringify(oldAll[k])) {
        changes[k] = { oldValue: oldAll[k], newValue: newAll[k] };
      }
    }
    if (Object.keys(changes).length > 0) notify(changes);
  });
  // Armor: Chromium's native binding installer replaces window.chrome some
  // time after document start (observed ~seconds in headless), which would
  // silently kill every later storage call. A non-writable, non-configurable
  // data property blocks both plain assignment and defineProperty.
  const stub = {
    storage: {
      local: {
        async get(keys) {
          const all = readAll();
          if (keys === null || keys === undefined) return { ...all };
          const list = Array.isArray(keys) ? keys : [keys];
          const out = {};
          for (const k of list) if (k in all) out[k] = all[k];
          return out;
        },
        async set(items) {
          const all = readAll();
          const changes = {};
          for (const [k, v] of Object.entries(items)) {
            changes[k] = { oldValue: all[k], newValue: v };
            all[k] = v;
          }
          writeAll(all);
          if (bc) bc.postMessage(changes);
          notify(changes);
        },
        async remove(keys) {
          const all = readAll();
          const list = Array.isArray(keys) ? keys : [keys];
          const changes = {};
          for (const k of list) {
            if (k in all) {
              changes[k] = { oldValue: all[k] };
              delete all[k];
            }
          }
          writeAll(all);
          if (bc) bc.postMessage(changes);
          notify(changes);
        },
      },
      onChanged: {
        addListener(l) { listeners.add(l); },
        removeListener(l) { listeners.delete(l); },
      },
    },
  };
  try { delete window.chrome; } catch (e) {}
  Object.defineProperty(window, "chrome", {
    value: stub,
    writable: false,
    configurable: false,
  });
})();
`;

/**
 * Resolves as soon as <html> exists. addScriptToEvaluateOnNewDocument runs
 * at new-document time — earlier than a real document_start content script —
 * and both bundles touch document.documentElement immediately, so script
 * mode waits for the document element before running them.
 */
const DOC_READY_SHIM = `
(() => {
  if (window.__e2eDocReady) return;
  window.__e2eDocReady = new Promise((resolve) => {
    if (document.documentElement) return resolve();
    const mo = new MutationObserver(() => {
      if (document.documentElement) { mo.disconnect(); resolve(); }
    });
    mo.observe(document, { childList: true, subtree: true });
    document.addEventListener("DOMContentLoaded", () => resolve(), { once: true });
  });
})();
`;

function scriptSources() {
	const assets = path.join(DIST, "assets");
	const injectHook = readdirSync(assets).find((f) =>
		f.startsWith("inject-hook"),
	);
	const contentBundle = readdirSync(assets).find((f) =>
		f.startsWith("content."),
	);
	if (!injectHook || !contentBundle)
		throw new Error("dist/assets bundles not found — run npm run build first");
	const afterDocReady = (source) =>
		`window.__e2eDocReady.then(function(){ ${source} });`;
	return [
		CHROME_STORAGE_STUB,
		DOC_READY_SHIM,
		afterDocReady(readFileSync(path.join(assets, injectHook), "utf8")),
		afterDocReady(readFileSync(path.join(assets, contentBundle), "utf8")),
	];
}

// ─── Browser plumbing: raw CDP over WebSocket ──────────────────────────────────

const BROWSER_CANDIDATES = [
	process.env.E2E_BROWSER,
	"/usr/bin/google-chrome",
	"/usr/bin/google-chrome-stable",
	"/usr/bin/chromium",
	"/usr/bin/chromium-browser",
	"/usr/bin/microsoft-edge",
].filter(Boolean);

async function launchBrowser() {
	const exe = BROWSER_CANDIDATES.find((p) => existsSync(p));
	if (!exe) {
		throw new Error(
			"No Chromium executable found. Set E2E_BROWSER to your Chrome/Edge binary " +
				"(or run tests/e2e/setup-browser.mjs in a locked-down sandbox).",
		);
	}
	const userDataDir = await mkdtemp(path.join(tmpdir(), "arena-sidebar-e2e-"));
	const args = [
		process.env.E2E_HEADED ? "" : "--headless=new",
		"--no-sandbox",
		"--disable-gpu",
		"--disable-dev-shm-usage",
		"--no-first-run",
		"--no-default-browser-check",
		"--window-size=1400,900",
		`--user-data-dir=${userDataDir}`,
		"--remote-debugging-port=0",
		// Extension loading only works in extension-capable browsers (real
		// Chrome). In script mode the flags are dead weight AND they drag in
		// the extension binding installer, which replaces window.chrome and
		// kills the storage stub — so only pass them when they can matter.
		...(MODE === "script"
			? []
			: [`--disable-extensions-except=${DIST}`, `--load-extension=${DIST}`]),
		"about:blank",
	].filter(Boolean);

	const child = spawn(exe, args, {
		stdio: ["ignore", "pipe", "pipe"],
		env: process.env,
	});

	// Port 0 makes Chromium pick a free port and announce it on stderr.
	const wsUrl = await new Promise((resolve, reject) => {
		const timer = setTimeout(
			() => reject(new Error("browser did not announce a DevTools endpoint")),
			15000,
		);
		let buf = "";
		const onData = (chunk) => {
			buf += chunk.toString();
			const m = /DevTools listening on (ws:\/\/\S+)/.exec(buf);
			if (m) {
				clearTimeout(timer);
				resolve(m[1]);
			}
		};
		child.stderr.on("data", onData);
		child.stdout.on("data", onData);
	});

	return { child, wsUrl, userDataDir };
}

/** One WebSocket to the browser endpoint; commands multiplexed by id. */
class CdpConnection {
	/** @param {string} wsUrl */
	constructor(wsUrl) {
		this.nextId = 1;
		this.pending = new Map();
		this.sessionHandlers = new Map(); // sessionId → (event) => void
		this.ws = new WebSocket(wsUrl, { maxPayload: 256 * 1024 * 1024 });
		this.ws.on("message", (raw) => this.onMessage(raw.toString()));
		this.ready = new Promise((resolve, reject) => {
			this.ws.on("open", resolve);
			this.ws.on("error", reject);
		});
	}

	onMessage(text) {
		const msg = JSON.parse(text);
		if (msg.id && this.pending.has(msg.id)) {
			const { resolve, reject } = this.pending.get(msg.id);
			this.pending.delete(msg.id);
			if (msg.error)
				reject(new Error(`${msg.error.message} (${msg.error.code})`));
			else resolve(msg.result);
			return;
		}
		if (msg.sessionId && this.sessionHandlers.has(msg.sessionId)) {
			this.sessionHandlers.get(msg.sessionId)(msg);
		}
	}

	send(method, params = {}, sessionId) {
		const id = this.nextId++;
		const payload = { id, method, params };
		if (sessionId) payload.sessionId = sessionId;
		const reply = new Promise((resolve, reject) => {
			this.pending.set(id, { resolve, reject });
			setTimeout(() => {
				if (this.pending.has(id)) {
					this.pending.delete(id);
					reject(new Error(`CDP timeout: ${method}`));
				}
			}, 20000).unref();
		});
		this.ws.send(JSON.stringify(payload));
		return reply;
	}

	close() {
		this.ws.close();
	}
}

/** A page target, attached via a flattened session. */
class CdpPage {
	constructor(conn, sessionId) {
		this.conn = conn;
		this.sessionId = sessionId;
		this.scriptHooksInstalled = false;
		/** @type {string[]} */
		this.consoleLines = [];
		conn.sessionHandlers.set(sessionId, (event) => this.onEvent(event));
	}

	onEvent(msg) {
		if (msg.method === "Runtime.consoleAPICalled") {
			const parts = (msg.params.args ?? []).map(
				(a) => a.value ?? a.description ?? "",
			);
			this.consoleLines.push(`[${msg.params.type}] ${parts.join(" ")}`);
		} else if (msg.method === "Runtime.exceptionThrown") {
			const d = msg.params.exceptionDetails;
			this.consoleLines.push(
				`[exception] ${d.text} ${d.exception?.description ?? ""}`,
			);
		}
	}

	send(method, params) {
		return this.conn.send(method, params, this.sessionId);
	}

	async goto(url) {
		await this.send("Page.enable");
		await this.send("Runtime.enable");
		await this.send("Page.navigate", { url });
	}

	async reload() {
		await this.send("Page.reload", {});
	}

	/**
	 * Script mode: install the real built bundles to run on every new
	 * document of this target, at document-creation time (same as the
	 * manifest's run_at: document_start).
	 */
	async installScriptHooks(sources) {
		await this.send("Page.enable");
		for (const source of sources) {
			await this.send("Page.addScriptToEvaluateOnNewDocument", { source });
		}
		this.scriptHooksInstalled = true;
	}

	async evaluate(expression) {
		const r = await this.send("Runtime.evaluate", {
			expression,
			returnByValue: true,
			awaitPromise: false,
		});
		if (r.exceptionDetails) {
			throw new Error(`evaluate failed: ${r.exceptionDetails.text}`);
		}
		return r.result?.value ?? null;
	}

	waitForTimeout(ms) {
		return new Promise((resolve) => setTimeout(resolve, ms));
	}
}

// ─── CDP agent: eyes and hands inside the closed shadow root ───────────────────

function parseAttrs(flat) {
	const attrs = {};
	if (flat)
		for (let i = 0; i < flat.length; i += 2) attrs[flat[i]] = flat[i + 1];
	return attrs;
}

/**
 * Walk the pierced DOM tree, collecting elements with class tokens and the
 * concatenated text of their subtree (CDP gives us text nodes' nodeValue, so
 * no execution context inside the closed root is needed).
 */
function scan(node, out, parent) {
	const textParts = node.nodeValue ? [node.nodeValue] : [];
	const el = {
		nodeId: node.nodeId,
		name: node.nodeName,
		attrs: parseAttrs(node.attributes),
		text: "",
		parent,
	};
	out.push(el);
	const kids = [...(node.children ?? []), ...(node.shadowRoots ?? [])];
	for (const kid of kids) textParts.push(scan(kid, out, el));
	el.text = textParts.join(" ").replace(/\s+/g, " ").trim();
	return el.text;
}

class Agent {
	/** @param {CdpPage} page @param {string} label */
	constructor(page, label) {
		this.page = page;
		this.label = label;
	}

	/** Full element list of the pierced document (light DOM + closed shadow roots). */
	async elements() {
		const { root } = await this.page.send("DOM.getDocument", {
			depth: -1,
			pierce: true,
		});
		/** @type {any[]} */
		const out = [];
		scan(root, out, null);
		return out;
	}

	/** Elements whose class list contains every token. */
	async byClass(...tokens) {
		return (await this.elements()).filter((el) => {
			const have = (el.attrs["class"] ?? "").split(/\s+/);
			return tokens.every((t) => have.includes(t));
		});
	}

	/** The single element matching, or null. Throws if more than one. */
	async one(...tokens) {
		const found = await this.byClass(...tokens);
		if (found.length > 1)
			throw new Error(
				`${this.label}: expected one .${tokens.join(".")}, got ${found.length}`,
			);
		return found[0] ?? null;
	}

	/** Click via real input events at the element's centre. */
	async click(el) {
		const { model } = await this.page.send("DOM.getBoxModel", {
			nodeId: el.nodeId,
		});
		const b = model.border;
		const x = (b[0] + b[4]) / 2;
		const y = (b[1] + b[5]) / 2;
		for (const type of ["mousePressed", "mouseReleased"]) {
			await this.page.send("Input.dispatchMouseEvent", {
				type,
				x,
				y,
				button: "left",
				clickCount: 1,
			});
		}
	}

	/** Move the mouse over an element (needed to reveal hover-only UI). */
	async hover(el) {
		const { model } = await this.page.send("DOM.getBoxModel", {
			nodeId: el.nodeId,
		});
		const b = model.border;
		await this.page.send("Input.dispatchMouseEvent", {
			type: "mouseMoved",
			x: (b[0] + b[4]) / 2,
			y: (b[1] + b[5]) / 2,
		});
	}

	/** Focus by clicking, then type as real text input. */
	async type(el, text) {
		await this.click(el);
		await this.page.send("Input.insertText", { text });
	}

	/** Soft probe: poll until truthy or budget spent; returns the value or null. */
	async poll(probe, ms) {
		const deadline = Date.now() + ms;
		let last = null;
		while (Date.now() < deadline) {
			last = await probe();
			if (last) return last;
			await this.page.waitForTimeout(250);
		}
		return null;
	}

	/** Wait for an async probe to return a truthy value (default 15s). */
	async waitFor(label, probe, timeout = 15000) {
		const result = await this.poll(probe, timeout);
		if (!result)
			throw new Error(`${this.label}: timed out waiting for ${label}`);
		return result;
	}

	consoleLines() {
		return this.page.consoleLines;
	}

	sidebarLog() {
		return this.consoleLines().filter((l) => l.includes("[AI Sidebar]"));
	}
}

// ─── Assertions ──────────────────────────────────────────────────────────────

async function hostAttr(page, name) {
	return page.evaluate(
		`(function(){ var h = document.getElementById("__edge_ai_sidebar_host"); ` +
			`return h ? h.getAttribute(${JSON.stringify(name)}) : null; })()`,
	);
}

async function assertPanelRounds(agent, expected) {
	await agent.waitFor(
		`host rounds=${expected}`,
		async () =>
			(await hostAttr(agent.page, "data-ai-sidebar-rounds")) ===
			String(expected),
	);
}

async function items(agent) {
	return agent.byClass("item");
}

async function itemByText(agent, needle) {
	const found = (await items(agent)).filter((el) =>
		el.text.toLowerCase().includes(needle.toLowerCase()),
	);
	if (found.length !== 1)
		throw new Error(
			`${agent.label}: expected exactly one .item containing "${needle}", got ${found.length}`,
		);
	return found[0];
}

async function visibilityButton(agent, itemEl) {
	// Elements come from separate DOM.getDocument snapshots, so object identity
	// never holds across calls — match by the row's data-round-id instead.
	const rid = itemEl.attrs["data-round-id"];
	if (!rid) throw new Error(`${agent.label}: row has no data-round-id`);
	const all = await agent.byClass("item-visibility");
	const btn = all.find((b) => {
		let p = b.parent;
		while (p) {
			if (p.attrs["data-round-id"] === rid) return true;
			p = p.parent;
		}
		return false;
	});
	if (!btn)
		throw new Error(`${agent.label}: no .item-visibility inside row ${rid}`);
	return btn;
}

/**
 * The ✕/↩ buttons are hover-only (.item-actions is display:none until the row
 * is hovered), so a real user's sequence is: hover the row, then click. The
 * button sits inside the row, so the hover holds while the mouse moves on.
 */
async function hideOrRestore(agent, needle) {
	const row = await itemByText(agent, needle);
	await agent.hover(row);
	await agent.page.waitForTimeout(150);
	await agent.click(await visibilityButton(agent, row));
}

// ─── The scenario ─────────────────────────────────────────────────────────────

const steps = [];
const step = (name, fn) => steps.push({ name, fn });

step(
	"panel renders 4 rounds on a /c/ route (bootstrap → prescroll → extract)",
	async (ctx) => {
		await ctx.goto(ctx.alpha, `${ctx.url}/c/e2e-alpha`);
		await assertPanelRounds(ctx.alpha, 4);
		const rows = await items(ctx.alpha);
		if (rows.length !== 4)
			throw new Error(`expected 4 rows, saw ${rows.length}`);
		if (await ctx.alpha.one("hidden-bar"))
			throw new Error("hidden-bar present with nothing hidden");
	},
);

step("✕ hides a round, footer bar appears", async (ctx) => {
	const a = ctx.alpha;
	await hideOrRestore(a, "quantum");
	await a.waitFor("3 rows + bar", async () => {
		const rows = await items(a);
		const bar = await a.one("hidden-bar");
		return rows.length === 3 && bar?.text.includes("1 hidden round")
			? true
			: null;
	});
});

step(
	"hidden state survives a page reload (fingerprint merge keeps stored ids)",
	async (ctx) => {
		const a = ctx.alpha;
		await a.page.reload();
		await assertPanelRounds(a, 4);
		await a.waitFor("3 rows + bar after reload", async () => {
			const rows = await items(a);
			const bar = await a.one("hidden-bar");
			return rows.length === 3 && bar !== null ? true : null;
		});
	},
);

step(
	"footer bar enters reveal mode; hidden row renders dimmed with ↩",
	async (ctx) => {
		const a = ctx.alpha;
		await a.click(await a.one("hidden-bar"));
		await a.waitFor("4 rows, quantum dimmed", async () => {
			const rows = await items(a);
			const bar = await a.one("hidden-bar");
			if (rows.length !== 4 || !bar) return null;
			if (!bar.text.includes("click to hide again")) return null;
			const row = await itemByText(a, "quantum");
			const dim = (row.attrs["class"] ?? "")
				.split(/\s+/)
				.includes("item-hidden");
			return dim ? true : null;
		});
		const row = await itemByText(a, "quantum");
		const btn = await visibilityButton(a, row);
		if (btn.text !== "↩")
			throw new Error(`visibility button shows "${btn.text}", want ↩`);
	},
);

step("↩ restores the round and the bar disappears", async (ctx) => {
	const a = ctx.alpha;
	await hideOrRestore(a, "quantum");
	await a.waitFor("4 rows, no bar, no dim", async () => {
		const rows = await items(a);
		const bar = await a.one("hidden-bar");
		return rows.length === 4 && !bar ? true : null;
	});
});

step(
	"hiding in tab 2 syncs to tab 1 without a reload (storage change event)",
	async (ctx) => {
		const b = ctx.tab2; // second page, same alpha session
		await ctx.goto(b, `${ctx.url}/c/e2e-alpha`);
		await assertPanelRounds(b, 4);
		await hideOrRestore(b, "hiking");
		// Tab 2 itself must show the hide first — proves the write landed.
		await b.waitFor("tab2: 3 rows + bar", async () => {
			const rows = await items(b);
			const bar = await b.one("hidden-bar");
			return rows.length === 3 && bar !== null ? true : null;
		});
		// Tab 1 must catch up on its own — no reload, no navigation.
		await ctx.alpha.waitFor("tab1: 3 rows + bar", async () => {
			const rows = await items(ctx.alpha);
			const bar = await ctx.alpha.one("hidden-bar");
			return rows.length === 3 && bar?.text.includes("1 hidden round")
				? true
				: null;
		});
	},
);

step(
	"navigating to another session shows its rounds with no leaked flags",
	async (ctx) => {
		const a = ctx.alpha;
		await ctx.goto(a, `${ctx.url}/c/e2e-beta`);
		await assertPanelRounds(a, 2);
		await a.waitFor("2 rows, no bar", async () => {
			const rows = await items(a);
			const bar = await a.one("hidden-bar");
			return rows.length === 2 && !bar ? true : null;
		});
	},
);

step(
	"full-text search matches a word buried past the truncated previews",
	async (ctx) => {
		const a = ctx.alpha;
		// Back to alpha: the hiking round stays hidden (per-session key), search
		// resets with the route change.
		await ctx.goto(a, `${ctx.url}/c/e2e-alpha`);
		await assertPanelRounds(a, 4);
		await a.waitFor("3 rows + bar (hiking still hidden)", async () => {
			const rows = await items(a);
			const bar = await a.one("hidden-bar");
			return rows.length === 3 && bar !== null ? true : null;
		});
		// "xylophone" sits at char 100+ of the round-1 assistant message: in no
		// title, no user preview (60 chars), no assistant preview (100 chars).
		const input = await a.one("search-input");
		if (!input) throw new Error("search input not found");
		await a.type(input, "xylophone");
		await a.waitFor("search narrows to the risotto round", async () => {
			const rows = await items(a);
			return rows.length === 1 && rows[0].text.toLowerCase().includes("risotto")
				? true
				: null;
		});
	},
);

// ─── Driver ───────────────────────────────────────────────────────────────────

async function main() {
	const mock = await startMockArena(BASE_PORT);
	const { child, wsUrl, userDataDir } = await launchBrowser();
	const conn = new CdpConnection(wsUrl);
	await conn.ready;

	async function newPage() {
		const { targetId } = await conn.send("Target.createTarget", {
			url: "about:blank",
		});
		const { sessionId } = await conn.send("Target.attachToTarget", {
			targetId,
			flatten: true,
		});
		return new CdpPage(conn, sessionId);
	}

	const sources = scriptSources();
	/** "extension" | "script"; auto starts optimistic and falls back. */
	let mode = MODE === "script" ? "script" : "extension";

	/**
	 * Navigate with mode handling: in auto mode, give the loaded extension a
	 * few seconds to inject; if it does not (browser without extension
	 * support), install the script hooks and reload.
	 */
	async function goto(agent, url) {
		if (mode === "script" && !agent.page.scriptHooksInstalled) {
			await agent.page.installScriptHooks(sources);
		}
		await agent.page.goto(url);
		if (mode === "extension") {
			const injected = await agent.poll(
				() =>
					agent.page.evaluate(
						'!!document.getElementById("__edge_ai_sidebar_host")',
					),
				5000,
			);
			if (!injected && MODE === "auto") {
				mode = "script";
				console.log(
					"  (extension did not load in this browser — falling back to script mode)",
				);
				await agent.page.installScriptHooks(sources);
				await agent.page.reload();
			}
		}
	}

	const alpha = new Agent(await newPage(), "tab1");
	const tab2 = new Agent(await newPage(), "tab2");
	const ctx = { url: mock.url, alpha, tab2, goto };

	let failed = null;
	for (const s of steps) {
		try {
			await s.fn(ctx);
			console.log(`  ✓ ${s.name}`);
		} catch (err) {
			failed = { step: s.name, error: err };
			console.error(`  ✗ ${s.name}`);
			console.error(`    ${err?.message ?? err}`);
			break;
		}
	}

	if (failed) {
		for (const [label, agent] of [
			["tab1", alpha],
			["tab2", tab2],
		]) {
			console.error(`\n── diagnostics (${label}) ────────────────────────────`);
			try {
				const rows = (await agent.byClass("item")).map(
					(el) => el.attrs["data-round-id"],
				);
				console.error(`  live rows: ${JSON.stringify(rows)}`);
				const diag = await agent.page.evaluate(
					'(function(){ var h = document.getElementById("__edge_ai_sidebar_host");' +
						' var ls = null; try { ls = localStorage.getItem("__e2e_store"); } catch (e) {}' +
						" return JSON.stringify({ title: document.title, ready: document.readyState," +
						' host: !!h, rounds: h ? h.getAttribute("data-ai-sidebar-rounds") : null,' +
						" chromeStub: !!(window.chrome && window.chrome.storage && window.chrome.storage.onChanged)," +
						' hiddenNow: JSON.parse(ls)["edge-ai-sidebar:hidden-rounds:e2e-alpha"] || null }); })()',
				);
				console.error(`  page: ${diag}`);
			} catch (e) {
				console.error(`  page eval failed: ${e.message}`);
			}
			console.error("  ── console (all, last 25) ──");
			for (const line of agent.consoleLines().slice(-25))
				console.error(`  ${line}`);
		}
	}

	child.kill("SIGTERM");
	conn.close();
	await mock.close();
	await rm(userDataDir, { recursive: true, force: true });

	if (failed) {
		console.error(`\nE2E FAILED at: ${failed.step}`);
		process.exit(1);
	}
	console.log(
		`\nE2E OK — ${steps.length}/${steps.length} steps passed (${mode} mode, real Chromium, mock arena).`,
	);
	process.exit(0);
}

main().catch((err) => {
	console.error(err);
	process.exit(1);
});
