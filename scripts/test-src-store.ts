// Real source-based test for conversationStore (canonical message store + rounds).
// Imports the ACTUAL production modules (conversationStore.ts, state.ts), unlike
// scripts/test-conversation-store.cjs which mirrored the logic with its own singleton.
//
// NOTE: these tests exercise the pure data-layer functions only. chrome.* is never
// invoked — saveToStorage/loadFromStorage guard on `typeof chrome === "undefined"`,
// so importing these modules in node is side-effect free.
import assert from "node:assert/strict";
import {
	conversationStore,
	refreshStore,
	addCapturedMessage,
	bindDomAnchors,
	getMessagesForRound,
} from "../src/conversationStore";
import { cachedElements } from "../src/state";

const failures: string[] = [];
function run(label: string, fn: () => void) {
	try {
		fn();
		console.log("  ok - " + label);
	} catch (e) {
		failures.push(label + ": " + (e as Error).message);
		console.error("  FAIL - " + label + " :: " + (e as Error).message);
	}
}

console.log("test-src-store: conversationStore (real source import)");

run("refreshStore dedup: same content added twice -> 1 message", () => {
	conversationStore.reset();
	refreshStore({ dom: [{ id: "m1", role: "user", content: "same text" }] });
	refreshStore({ dom: [{ id: "m2", role: "user", content: "same text" }] });
	assert.equal(conversationStore.messages.length, 1);
});

run("refreshStore with empty opts -> no-op", () => {
	conversationStore.reset();
	refreshStore({});
	assert.equal(conversationStore.messages.length, 0);
	assert.equal(conversationStore.rounds.length, 0);
});

run("capture origin upgrades a prior dom message of same content", () => {
	conversationStore.reset();
	refreshStore({ dom: [{ id: "m1", role: "user", content: "hello world" }] });
	const added = addCapturedMessage({
		id: "cap",
		role: "user",
		content: "hello world",
		capturedAt: 123,
		sessionId: "s",
	});
	assert.equal(added, false); // not new — merged into existing
	assert.equal(conversationStore.messages.length, 1);
	assert.equal(conversationStore.messages[0].origin, "capture");
	assert.equal(conversationStore.messages[0].capturedAt, 123);
});

run("system role normalized to assistant on dom insert", () => {
	conversationStore.reset();
	refreshStore({ dom: [{ id: "m1", role: "system", content: "sys msg" }] });
	assert.equal(conversationStore.messages[0].role, "assistant");
});

run("getMessagesForRound returns user + its assistant replies", () => {
	conversationStore.reset();
	refreshStore({
		dom: [
			{ id: "u1", role: "user", content: "q1" },
			{ id: "a1", role: "assistant", content: "r1" },
			{ id: "u2", role: "user", content: "q2" },
			{ id: "a2", role: "assistant", content: "r2" },
		],
		bindAnchors: false,
	});
	const msgs = getMessagesForRound("u1");
	assert.equal(msgs.length, 2);
	assert.deepEqual(msgs.map((m) => m.id), ["u1", "a1"]);
});

run("getMessagesForRound for last round reaches end of store", () => {
	conversationStore.reset();
	refreshStore({
		dom: [
			{ id: "u1", role: "user", content: "q1" },
			{ id: "a1", role: "assistant", content: "r1" },
			{ id: "u2", role: "user", content: "q2" },
		],
		bindAnchors: false,
	});
	const msgs = getMessagesForRound("u2");
	assert.equal(msgs.length, 1);
	assert.deepEqual(msgs.map((m) => m.id), ["u2"]);
});

run("bindDomAnchors assigns domId from cachedElements by fingerprint", () => {
	conversationStore.reset();
	cachedElements.clear();
	// Fake DOM element — only fields bindDomAnchors reads are needed.
	const fakeEl = { isConnected: true, textContent: "  hello   world  " };
	cachedElements.set("el-1", fakeEl as unknown as Element);
	refreshStore(
		{ dom: [{ id: "m1", role: "user", content: "hello world" }], bindAnchors: false },
	);
	bindDomAnchors();
	assert.equal(conversationStore.messages[0].domId, "el-1");
});

run("bindDomAnchors clears domIds whose element is disconnected", () => {
	conversationStore.reset();
	cachedElements.clear();
	const fakeEl = { isConnected: true, textContent: "abc def" };
	cachedElements.set("el-1", fakeEl as unknown as Element);
	refreshStore(
		{ dom: [{ id: "m1", role: "user", content: "abc def" }], bindAnchors: false },
	);
	bindDomAnchors();
	assert.equal(conversationStore.messages[0].domId, "el-1");
	// Simulate the element being recycled from the DOM: replace the cache
	// entry with a disconnected element (isConnected is read-only on Element,
	// so swap the entry instead of mutating it).
	const disconnectedEl = { isConnected: false, textContent: "abc def" };
	cachedElements.set("el-1", disconnectedEl as unknown as Element);
	bindDomAnchors();
	assert.equal(conversationStore.messages[0].domId, undefined);
});

if (failures.length > 0) {
	console.error(`test-src-store: FAILED ${failures.length}:`);
	failures.forEach((f) => console.error("  - " + f));
	process.exit(1);
}
console.log("test-src-store: PASS (" + 8 + " assertions)");