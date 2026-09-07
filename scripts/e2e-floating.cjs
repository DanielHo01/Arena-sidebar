// E2E test v4: use CDP DOM API to pierce closed shadow DOM
const http = require("http");
const fs = require("fs");
const WebSocket = require("ws");

const CDP_PORT = 9250;
const HTML_PATH = "D:/edge-ai-sidebar/tests/arena-mock.html";
const DIST_PATH = "D:/edge-ai-sidebar/dist";

function startServer() {
	return new Promise((resolve) => {
		const server = http.createServer((req, res) => {
			res.writeHead(200, { "Content-Type": "text/html" });
			res.end(fs.readFileSync(HTML_PATH, "utf8"));
		});
		server.listen(8000, "127.0.0.1", () => {
			console.log("HTTP: http://127.0.0.1:8000");
			resolve(server);
		});
	});
}

function launchEdge() {
	const { spawn } = require("child_process");
	const os = require("os");
	const path = require("path");
	const userDataDir = path.join(os.tmpdir(), "edge-fab-" + Date.now());
	const proc = spawn(
		"C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe",
		[
			"--remote-debugging-port=" + CDP_PORT,
			"--user-data-dir=" + userDataDir,
			"--load-extension=" + DIST_PATH,
			"--disable-extensions-except=" + DIST_PATH,
			"--no-first-run",
			"--no-default-browser-check",
			"--no-sandbox",
			"--headless=new",
			"--disable-gpu",
		],
		{ stdio: ["ignore", "pipe", "pipe"] },
	);
	proc.on("error", (e) => console.error("Edge error:", e.message));
	return proc;
}

function getJson(p) {
	return new Promise((res, rej) => {
		http
			.get("http://127.0.0.1:" + CDP_PORT + p, (r) => {
				let d = "";
				r.on("data", (c) => (d += c));
				r.on("end", () => {
					try {
						res(JSON.parse(d));
					} catch (e) {
						rej(e);
					}
				});
			})
			.on("error", rej);
	});
}

function sleep(ms) {
	return new Promise((r) => setTimeout(r, ms));
}

async function waitForCDP() {
	for (let i = 0; i < 20; i++) {
		await sleep(800);
		try {
			await getJson("/json/version");
			return true;
		} catch {}
	}
	return false;
}

function hasAttr(attrs, name, value) {
	if (!attrs) return false;
	for (let i = 0; i < attrs.length; i += 2) {
		if (attrs[i] === name && attrs[i + 1] === value) return true;
	}
	return false;
}

// Find the shadow root nodeId via CDP DOM.querySelector + describeNode (pierces closed shadow)
async function getShadowNodeId(send, sess) {
	const doc = await send("DOM.getDocument", { depth: 0 }, sess);
	const docNodeId = doc.root.nodeId;
	const host = await send(
		"DOM.querySelector",
		{ nodeId: docNodeId, selector: "#__edge_ai_sidebar_host" },
		sess,
	);
	if (!host || !host.nodeId || host.nodeId === 0) {
		console.log("getShadowNodeId: host not found via querySelector");
		return null;
	}
	const described = await send(
		"DOM.describeNode",
		{ nodeId: host.nodeId, depth: 1, pierce: true },
		sess,
	);
	if (
		!described ||
		!described.node ||
		!described.node.shadowRoots ||
		described.node.shadowRoots.length === 0
	) {
		console.log(
			"getShadowNodeId: host found but no shadowRoots in describeNode",
		);
		return null;
	}
	return described.node.shadowRoots[0].nodeId;
}

// Get bounding box for a selector inside a shadow root
async function shadowBox(send, sess, shadowNodeId, selector) {
	const qr = await send(
		"DOM.querySelector",
		{ nodeId: shadowNodeId, selector },
		sess,
	);
	if (!qr || !qr.nodeId || qr.nodeId === 0) return null;
	const box = await send("DOM.getBoxModel", { nodeId: qr.nodeId }, sess);
	if (!box || !box.model) return null;
	const [x, y] = box.model.content;
	return { nodeId: qr.nodeId, x, y, w: box.model.width, h: box.model.height };
}

// Evaluate text content of an element inside shadow
async function shadowText(send, sess, shadowNodeId, selector, attr) {
	const qr = await send(
		"DOM.querySelector",
		{ nodeId: shadowNodeId, selector },
		sess,
	);
	if (!qr || !qr.nodeId || qr.nodeId === 0) return null;
	const resolved = await send("DOM.resolveNode", { nodeId: qr.nodeId }, sess);
	if (!resolved || !resolved.object || !resolved.object.objectId) return null;
	const expr = attr
		? '(el) => el.getAttribute("' + attr.replace(/"/g, '\\"') + '")'
		: "(el) => el.textContent";
	const result = await send(
		"Runtime.callFunctionOn",
		{
			objectId: resolved.object.objectId,
			functionDeclaration: expr,
			returnByValue: true,
		},
		sess,
	);
	return result?.result?.value ?? null;
}

// Count elements matching selector inside shadow
async function shadowCount(send, sess, shadowNodeId, selector) {
	const qr = await send(
		"DOM.querySelectorAll",
		{ nodeId: shadowNodeId, selector },
		sess,
	);
	return qr?.nodeIds?.length ?? 0;
}

async function run() {
	const server = await startServer();
	const edgeProc = launchEdge();
	await sleep(2500);

	if (!(await waitForCDP())) {
		console.log("CDP not ready");
		edgeProc.kill("SIGKILL");
		server.close();
		process.exit(1);
	}
	const ver = await getJson("/json/version");
	console.log("Edge:", ver.Browser);

	const bws = new WebSocket(ver.webSocketDebuggerUrl);
	await new Promise((r) => bws.on("open", r));
	let rid = 0;
	const pending = new Map();
	bws.on("message", (d) => {
		const m = JSON.parse(d.toString());
		if (m.id && pending.has(m.id)) {
			pending.get(m.id)(m);
			pending.delete(m.id);
		}
	});
	function send(method, params, sessionId) {
		const id = ++rid;
		return new Promise((r) => {
			pending.set(id, (m) => r(m.result || m.error));
			const msg = { id, method, params: params || {} };
			if (sessionId) msg.sessionId = sessionId;
			bws.send(JSON.stringify(msg));
		});
	}

	const tab = await send("Target.createTarget", {
		url: "http://127.0.0.1:8000/arena-mock.html",
	});
	const sess = (
		await send("Target.attachToTarget", {
			targetId: tab.targetId,
			flatten: true,
		})
	).sessionId;
	await send("Runtime.enable", {}, sess);
	await send("Page.enable", {}, sess);
	await send("DOM.enable", {}, sess);
	await sleep(3500);

	// 1. Content script extraction (light DOM, no shadow needed)
	const r1 = await send(
		"Runtime.evaluate",
		{
			expression:
				'JSON.stringify({tagged: document.querySelectorAll("[data-ai-sidebar-id]").length, hostExists: !!document.getElementById("__edge_ai_sidebar_host")})',
			returnByValue: true,
		},
		sess,
	);
	const s1 = JSON.parse(r1.result.value);
	console.log("--- 1. Extraction ---");
	console.log(JSON.stringify(s1, null, 2));

	if (!s1.hostExists) {
		console.log("ERROR: host element not found");
		edgeProc.kill("SIGKILL");
		server.close();
		process.exit(1);
	}

	// Get shadow root nodeId (works with both open and closed shadow DOM when pierce=true)
	const shadowNodeId = await getShadowNodeId(send, sess);
	if (!shadowNodeId) {
		console.log("ERROR: shadow root not found");
		edgeProc.kill("SIGKILL");
		server.close();
		process.exit(1);
	}
	console.log("Shadow root nodeId:", shadowNodeId);

	// 2. Find FAB via CDP DOM (pierces closed shadow)
	const fabBox = await shadowBox(send, sess, shadowNodeId, ".fab");
	const fabText = fabBox
		? await shadowText(send, sess, shadowNodeId, ".fab", "aria-label")
		: null;
	const s2 = {
		fabFound: !!fabBox,
		fabText: fabText || "",
		fabRect: fabBox
			? { x: fabBox.x, y: fabBox.y, w: fabBox.w, h: fabBox.h }
			: null,
	};
	console.log("--- 2. FAB button (shadow root) ---");
	console.log(JSON.stringify(s2, null, 2));

	if (!s2.fabFound) {
		edgeProc.kill("SIGKILL");
		server.close();
		process.exit(1);
	}

	// 3. Click FAB via Input.dispatchMouseEvent
	const fabX = s2.fabRect.x + s2.fabRect.w / 2;
	const fabY = s2.fabRect.y + s2.fabRect.h / 2;
	console.log(
		"--- 3. Click FAB at (" +
			Math.round(fabX) +
			", " +
			Math.round(fabY) +
			") ---",
	);
	await send(
		"Input.dispatchMouseEvent",
		{ type: "mousePressed", x: fabX, y: fabY, button: "left", clickCount: 1 },
		sess,
	);
	await send(
		"Input.dispatchMouseEvent",
		{ type: "mouseReleased", x: fabX, y: fabY, button: "left", clickCount: 1 },
		sess,
	);
	await sleep(600);

	// 4. Check panel + rounds via CDP DOM
	const panelBox = await shadowBox(send, sess, shadowNodeId, ".panel");
	const panelTitle = panelBox
		? await shadowText(send, sess, shadowNodeId, ".title")
		: null;
	const roundsCount = panelBox
		? await shadowCount(send, sess, shadowNodeId, ".item")
		: 0;
	const firstItemText =
		roundsCount > 0
			? await shadowText(send, sess, shadowNodeId, ".item")
			: null;
	const s3 = {
		panelFound: !!panelBox,
		panelTitle,
		roundsCount,
		firstItemText: firstItemText?.trim().slice(0, 80),
	};
	console.log("--- 4. Panel + rounds ---");
	console.log(JSON.stringify(s3, null, 2));

	if (!s3.panelFound || s3.roundsCount < 4) {
		edgeProc.kill("SIGKILL");
		server.close();
		process.exit(1);
	}

	// 4.5. Verify API discovery pipeline: content script inject → main world hook → postMessage → apiConfig
	const summaryBtnBox = await shadowBox(
		send,
		sess,
		shadowNodeId,
		".summary-btn",
	);
	console.log("--- 4.5. Panel elements ---");
	console.log(
		JSON.stringify(
			{
				summaryBtnExists: !!summaryBtnBox,
				searchInputExists: !!(await shadowBox(
					send,
					sess,
					shadowNodeId,
					".search-input",
				)),
			},
			null,
			2,
		),
	);

	// Check content script's injected hook is active in main world (CSP-safe external script)
	const hookCheck = await send(
		"Runtime.evaluate",
		{
			expression:
				'JSON.stringify({ hooked: window.fetch.toString().includes("__aiSideApiCaptured"), flagged: !!window.__aiSideApiCaptured })',
			returnByValue: true,
		},
		sess,
	);
	const hc = JSON.parse(hookCheck.result.value);
	console.log("--- 4.5a. Hook installed (main world) ---");
	console.log(JSON.stringify(hc, null, 2));
	if (!hc.hooked) {
		console.log(
			"ERROR: inject-hook.js not installed in main world — reload extension",
		);
		bws.close();
		edgeProc.kill("SIGKILL");
		server.close();
		process.exit(1);
	}

	// Simulate arena.ai-style fetch from page (main world) — triggers the injected hook
	await send(
		"Runtime.evaluate",
		{
			expression: `(async () => { try { await fetch('/api/chat', { method: 'POST', body: JSON.stringify({ messages: [{ role: 'user', content: 'hello' }] }), headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer test' } }); } catch(e) {} })()`,
			returnByValue: true,
			awaitPromise: true,
		},
		sess,
	);
	await sleep(600);

	// Verify hook fired in main world
	const hookFired = (
		await send(
			"Runtime.evaluate",
			{
				expression: "!!window.__aiSideApiCaptured",
				returnByValue: true,
			},
			sess,
		)
	).result.value;

	// Debug: check dataset state after fetch
	const dsCheck = await send(
		"Runtime.evaluate",
		{
			expression:
				'document.documentElement.dataset.aiSideApi ? "SET: " + document.documentElement.dataset.aiSideApi.slice(0, 120) : "NOT SET"',
			returnByValue: true,
		},
		sess,
	);
	console.log("--- 4.5b. Dataset after fetch ---");
	console.log(dsCheck.result.value);

	// Trigger DOM mutation on document.body to force refreshUI (MutationObserver watches body)
	await send(
		"Runtime.evaluate",
		{
			expression:
				'(e => { const i = document.createElement("i"); e.appendChild(i); e.removeChild(i) })(document.body)',
			returnByValue: true,
		},
		sess,
	);
	await sleep(800);

	// Re-acquire shadow root and check button disabled property
	const sRoot2 = await getShadowNodeId(send, sess);
	const btn2 = await shadowBox(
		send,
		sess,
		sRoot2 || shadowNodeId,
		".summary-btn",
	);
	let btnDisabled = true;
	if (btn2?.nodeId) {
		const attrs = await send(
			"DOM.getAttributes",
			{ nodeId: btn2.nodeId },
			sess,
		);
		btnDisabled = attrs?.attributes?.includes("disabled") ?? true;
	}
	const apiCaptureOk = hookFired && !btnDisabled;
	console.log("--- 4.6. API discovery verification ---");
	console.log(
		JSON.stringify({ hookFired, btnDisabled, apiCaptureOk }, null, 2),
	);
	if (!apiCaptureOk) {
		console.log(
			"ERROR: API discovery pipeline broken (hookFired=" +
				hookFired +
				" btnDisabled=" +
				btnDisabled +
				")",
		);
		bws.close();
		edgeProc.kill("SIGKILL");
		server.close();
		process.exit(1);
	}
	console.log("OK: API discovery pipeline verified");
	console.log("");

	// Use freshest shadow root for remaining steps
	const liveId = sRoot2 || shadowNodeId;

	// 5. Click first round item
	const firstItemBox = await shadowBox(send, sess, liveId, ".item");
	if (!firstItemBox) {
		console.log("ERROR: no first item found");
		edgeProc.kill("SIGKILL");
		server.close();
		process.exit(1);
	}
	const itemX = firstItemBox.x + firstItemBox.w / 2;
	const itemY = firstItemBox.y + firstItemBox.h / 2;
	console.log(
		"--- 5. Click 1st round at (" +
			Math.round(itemX) +
			", " +
			Math.round(itemY) +
			") ---",
	);

	const before = (
		await send(
			"Runtime.evaluate",
			{ expression: "window.scrollY", returnByValue: true },
			sess,
		)
	).result.value;
	await send(
		"Input.dispatchMouseEvent",
		{ type: "mousePressed", x: itemX, y: itemY, button: "left", clickCount: 1 },
		sess,
	);
	await send(
		"Input.dispatchMouseEvent",
		{
			type: "mouseReleased",
			x: itemX,
			y: itemY,
			button: "left",
			clickCount: 1,
		},
		sess,
	);
	await sleep(1200);
	const after = (
		await send(
			"Runtime.evaluate",
			{ expression: "window.scrollY", returnByValue: true },
			sess,
		)
	).result.value;
	const flash = (
		await send(
			"Runtime.evaluate",
			{
				expression: 'document.querySelectorAll(".ai-sidebar-flash").length',
				returnByValue: true,
			},
			sess,
		)
	).result.value;
	console.log(
		"Scroll: before=" +
			before +
			" after=" +
			after +
			" | changed: " +
			(before !== after),
	);
	console.log("Flash class applied: " + flash + " elements");

	// 6. Take screenshot
	const ss = await send("Page.captureScreenshot", { format: "png" }, sess);
	if (ss && ss.data) {
		fs.writeFileSync(
			"D:/edge-ai-sidebar/.e2e-fab-screenshot.png",
			Buffer.from(ss.data, "base64"),
		);
		console.log("Screenshot: .e2e-fab-screenshot.png");
	}

	// 7. Verify panel collapsed after click (FAB visible, panel gone)
	// Refresh CDP DOM cache + re-get shadowNodeId (content script may have changed DOM)
	const freshShadowNodeId = await getShadowNodeId(send, sess);
	const checkId = freshShadowNodeId || shadowNodeId;
	const fabAfter = await shadowBox(send, sess, checkId, ".fab");
	const panelAfter = await shadowBox(send, sess, checkId, ".panel");
	const s5 = { fabVisible: !!fabAfter, panelVisible: !!panelAfter };
	console.log("--- 6. State after click ---");
	console.log(JSON.stringify(s5, null, 2));

	const evidence = {
		timestamp: new Date().toISOString(),
		edge: ver.Browser,
		extraction: {
			tagged: s1.tagged,
			expected: 8,
			ok: s1.tagged === 8,
			hostExists: s1.hostExists,
		},
		fab: { found: s2.fabFound, rect: s2.fabRect },
		panel: {
			found: s3.panelFound,
			title: s3.panelTitle,
			rounds: s3.roundsCount,
			expectedRounds: 4,
			firstItemPreview: s3.firstItemText,
		},
		click: {
			scrollBefore: before,
			scrollAfter: after,
			scrollChanged: before !== after,
			flashCount: flash,
		},
		stateAfter: s5,
	};
	fs.writeFileSync(
		"D:/edge-ai-sidebar/.e2e-fab-evidence.json",
		JSON.stringify(evidence, null, 2),
	);
	console.log("\n=== EVIDENCE ===");
	console.log(JSON.stringify(evidence, null, 2));

	bws.close();
	edgeProc.kill("SIGKILL");
	server.close();
	process.exit(0);
}

run().catch((e) => {
	console.error("FATAL:", e.message, e.stack);
	process.exit(1);
});
