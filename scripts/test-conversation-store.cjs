// NOTE: mirrored-behavior test — does NOT import src/ production code.
// See docs/rebaseline-phase10a.md §6.
// conversationStore logic tests — upsertMessage (merge) + bindDomAnchors
// Mirrors production behavior: uses a module-level _store singleton.

const tests = [];
function run(label, fn) {
	try {
		fn();
		tests.push({ label, passed: true });
	} catch (e) {
		tests.push({ label, passed: false, error: e.message });
	}
}
function eq(a, b, msg) {
	if (a !== b)
		throw new Error((msg || "assertion failed") + `: expected ${b}, got ${a}`);
}

// ─── Shared fingerprint (must match conversationStore.ts) ───────────────────────────

function fingerprint(text) {
	const normalized = text
		.trim()
		.replace(/\s+/g, " ")
		.toLowerCase()
		.slice(0, 200);
	return "fp-" + normalized.length + "-" + normalized.slice(0, 80);
}

// ─── Singleton store (mirrors conversationStore.messages) ─────────────────────────────

let _store = [];
function resetStore() {
	_store = [];
}

// ─── upsertMessage (mirrors conversationStore.ts) ─────────────────────────────────────

function upsertMessage(msg) {
	const fp = msg.fingerprint || fingerprint(msg.content);
	const fpKey = fp;
	const existing = _store.find(
		(m) => (m.fingerprint || fingerprint(m.content)) === fpKey,
	);
	if (existing) {
		if (!existing.domId && msg.domId) existing.domId = msg.domId;
		if (msg.origin === "capture" && existing.origin !== "capture") {
			existing.content = msg.content;
			existing.capturedAt = msg.capturedAt;
			existing.origin = "capture";
		}
		return false;
	}
	_store.push(msg);
	return true;
}

function makeMsg(overrides) {
	return {
		id: "msg-1",
		role: "user",
		content: "Hello world",
		fingerprint: undefined,
		domId: undefined,
		roundIndex: 0,
		origin: "dom",
		capturedAt: undefined,
		sessionId: undefined,
		...overrides,
	};
}

// ─── bindDomAnchors (mirrors conversationStore.ts) ────────────────────────────────────

function bindDomAnchors(messages, cachedElements) {
	for (const msg of messages) {
		if (msg.domId) {
			const el = cachedElements.get(msg.domId);
			if (!el || !el.isConnected) msg.domId = undefined;
		}
	}
	for (const [id, el] of cachedElements) {
		if (!el.isConnected) cachedElements.delete(id);
	}
	cachedElements.forEach((el, domId) => {
		const text = (el.textContent || "").trim().replace(/\s+/g, " ");
		if (text.length < 5) return;
		const fp = fingerprint(text);
		for (const msg of messages) {
			if (!msg.domId && (msg.fingerprint || fingerprint(msg.content)) === fp) {
				msg.domId = domId;
				break;
			}
		}
	});
}

function makeMockEl(text, connected = true) {
	return { textContent: text, isConnected: connected };
}

// ─── upsertMessage tests ─────────────────────────────────────────────────────────────────

run("empty store + fresh → added", () => {
	resetStore();
	const msg = makeMsg({ id: "fresh-1", content: "First message" });
	const wasNew = upsertMessage(msg);
	eq(wasNew, true, "should return true for new message");
	eq(_store.length, 1, "store should have 1 message");
	eq(_store[0].content, "First message");
});

run("duplicate fingerprint → not added", () => {
	resetStore();
	_store.push({
		id: "existing",
		role: "user",
		content: "Hello world",
		fingerprint: fingerprint("Hello world"),
		origin: "dom",
	});
	const msg = makeMsg({ id: "dup", content: "Hello world" });
	const wasNew = upsertMessage(msg);
	eq(wasNew, false, "should return false for duplicate");
	eq(_store.length, 1, "store should still have 1");
	eq(_store[0].id, "existing", "original id preserved");
});

run("capture origin overrides dom origin with same fingerprint", () => {
	resetStore();
	_store.push({
		id: "existing",
		role: "user",
		content: "Hello world",
		fingerprint: fingerprint("Hello world"),
		origin: "dom",
		capturedAt: undefined,
	});
	const msg = makeMsg({
		id: "new",
		content: "Hello world",
		origin: "capture",
		capturedAt: 12345678,
	});
	upsertMessage(msg);
	eq(_store.length, 1, "should not add duplicate");
	eq(_store[0].origin, "capture", "origin should be upgraded to capture");
	eq(_store[0].capturedAt, 12345678, "capturedAt should be filled in");
});

run("new message fills in missing domId from existing", () => {
	resetStore();
	_store.push({
		id: "existing",
		role: "user",
		content: "Hello world",
		fingerprint: fingerprint("Hello world"),
		origin: "dom",
		domId: undefined,
	});
	const msg = makeMsg({
		id: "new",
		content: "Hello world",
		domId: "anchor-42",
	});
	upsertMessage(msg);
	eq(
		_store[0].domId,
		"anchor-42",
		"domId should be filled in from new message",
	);
});

run("dom origin does NOT override capture origin", () => {
	resetStore();
	_store.push({
		id: "existing",
		role: "user",
		content: "Hello world",
		fingerprint: fingerprint("Hello world"),
		origin: "capture",
		capturedAt: 9999,
	});
	const msg = makeMsg({ id: "new", content: "Hello world", origin: "dom" });
	upsertMessage(msg);
	eq(_store[0].origin, "capture", "capture should be preserved");
	eq(_store[0].capturedAt, 9999, "capturedAt should be preserved");
});

run("multiple different messages → all stored", () => {
	resetStore();
	const msgs = [
		makeMsg({ id: "a", content: "Message A" }),
		makeMsg({ id: "b", content: "Message B" }),
		makeMsg({ id: "c", content: "Message C" }),
	];
	let added = 0;
	msgs.forEach((m) => {
		if (upsertMessage(m)) added++;
	});
	eq(added, 3, "all 3 should be added");
	eq(_store.length, 3);
});

run("different content → not deduplicated", () => {
	resetStore();
	_store.push({
		id: "first",
		role: "user",
		content: "Message one",
		fingerprint: fingerprint("Message one"),
		origin: "dom",
	});
	const msg = makeMsg({ id: "second", content: "Different message" });
	const wasNew = upsertMessage(msg);
	eq(wasNew, true, "should be added");
	eq(_store.length, 2, "both messages stored");
});

// ─── bindDomAnchors tests ─────────────────────────────────────────────────────────────────

run("disconnected element → domId cleared from message", () => {
	const messages = [
		{
			id: "m1",
			role: "user",
			content: "Hello world",
			fingerprint: fingerprint("Hello world"),
			domId: "stale-anchor",
		},
	];
	const cachedElements = new Map([
		["stale-anchor", { textContent: "Hello world", isConnected: false }],
	]);
	bindDomAnchors(messages, cachedElements);
	eq(
		messages[0].domId,
		undefined,
		"domId should be cleared for disconnected element",
	);
});

run(
	"matching element → domId bound to first message only (break works)",
	() => {
		const messages = [
			{
				id: "m1",
				role: "user",
				content: "Hello world",
				fingerprint: fingerprint("Hello world"),
				domId: undefined,
			},
			{
				id: "m2",
				role: "assistant",
				content: "Hello world",
				fingerprint: fingerprint("Hello world"),
				domId: undefined,
			},
		];
		const cachedElements = new Map([["anchor-A", makeMockEl("Hello world")]]);
		bindDomAnchors(messages, cachedElements);
		eq(messages[0].domId, "anchor-A", "first message should get the anchor");
		eq(
			messages[1].domId,
			undefined,
			"second message should NOT get the anchor (break)",
		);
	},
);

run("element with no matching message → no binding", () => {
	const messages = [
		{
			id: "m1",
			role: "user",
			content: "Specific content",
			fingerprint: fingerprint("Specific content"),
			domId: undefined,
		},
	];
	const cachedElements = new Map([["orphan", makeMockEl("Unrelated text")]]);
	bindDomAnchors(messages, cachedElements);
	eq(messages[0].domId, undefined, "no binding should happen");
});

run("existing domId preserved when element still connected", () => {
	const messages = [
		{
			id: "m1",
			role: "user",
			content: "Hello world",
			fingerprint: fingerprint("Hello world"),
			domId: "keep-this",
		},
	];
	const cachedElements = new Map([["keep-this", makeMockEl("Hello world")]]);
	bindDomAnchors(messages, cachedElements);
	eq(messages[0].domId, "keep-this", "existing domId should be preserved");
});

run("empty store + empty elements → no crash", () => {
	const messages = [];
	const cachedElements = new Map();
	bindDomAnchors(messages, cachedElements);
	eq(messages.length, 0);
});

run("stale cachedElements entry → deleted", () => {
	const messages = [];
	const cachedElements = new Map([
		["stale", { textContent: "x", isConnected: false }],
	]);
	bindDomAnchors(messages, cachedElements);
	eq(cachedElements.has("stale"), false, "stale entry should be removed");
});

// ─── Sprint 8: computeRounds preview field tests ──────────────────────────────────────

// Mirror the production computeRounds logic
function computeRoundsForTest(msgs) {
	const rounds = [];
	let current = null;
	let pendingLead = null;
	let roundIdx = 0;
	let currentFirstUser = null;
	let currentFirstAssistant = null;
	let currentAssistantCount = 0;

	const pushRound = (r) => {
		r.userPreview = currentFirstUser
			? currentFirstUser.content.slice(0, 60)
			: undefined;
		r.assistantPreview = currentFirstAssistant
			? currentFirstAssistant.content.slice(0, 100)
			: undefined;
		r.assistantCount = currentAssistantCount;
		rounds.push(r);
	};

	for (const msg of msgs) {
		if (msg.role === "assistant" && current === null) {
			pendingLead = msg;
			continue;
		}
		if (msg.role === "user") {
			if (current !== null) {
				pushRound(current);
				roundIdx++;
			} else if (pendingLead) {
				// For lead rounds, currentFirstAssistant must point to pendingLead
				// so pushRound can pick up its content as assistantPreview
				currentFirstAssistant = pendingLead;
				currentFirstUser = null;
				currentAssistantCount = 1;
				const lr = {
					id: pendingLead.id,
					title: pendingLead.content.slice(0, 80),
					messageCount: 1,
					index: roundIdx,
					hasAnchor: false,
				};
				pushRound(lr);
				roundIdx++;
			}
			currentFirstUser = msg;
			currentFirstAssistant = null;
			currentAssistantCount = 0;
			current = {
				id: msg.id,
				title: msg.content.slice(0, 80),
				messageCount: 0,
				index: roundIdx,
				hasAnchor: false,
				userPreview: undefined,
				assistantPreview: undefined,
				assistantCount: 0,
			};
			pendingLead = null;
		}
		if (current !== null) {
			current.messageCount++;
			if (msg.role === "assistant") {
				currentAssistantCount++;
				if (!currentFirstAssistant) currentFirstAssistant = msg;
			}
		}
	}
	if (current) {
		pushRound(current);
		roundIdx++;
	} else if (pendingLead && rounds.length === 0) {
		currentFirstAssistant = pendingLead;
		currentFirstUser = null;
		currentAssistantCount = 1;
		const lr = {
			id: pendingLead.id,
			title: pendingLead.content.slice(0, 80),
			messageCount: 1,
			index: 0,
			hasAnchor: false,
		};
		pushRound(lr);
	}
	return rounds;
}

run(
	"normal user+assistant round → userPreview and assistantPreview set",
	() => {
		const msgs = [
			{ id: "u1", role: "user", content: "What is the capital of France?" },
			{
				id: "a1",
				role: "assistant",
				content: "The capital of France is Paris.",
			},
		];
		const rounds = computeRoundsForTest(msgs);
		eq(rounds.length, 1);
		eq(
			rounds[0].userPreview,
			"What is the capital of France?",
			"userPreview should be set to full user content",
		);
		eq(
			rounds[0].assistantPreview,
			"The capital of France is Paris.",
			"assistantPreview should be set",
		);
		eq(rounds[0].assistantCount, 1, "assistantCount should be 1");
	},
);

run("userPreview truncated at 60 chars", () => {
	const longContent = "A".repeat(80);
	const msgs = [
		{ id: "u1", role: "user", content: longContent },
		{ id: "a1", role: "assistant", content: "Short answer." },
	];
	const rounds = computeRoundsForTest(msgs);
	eq(
		rounds[0].userPreview.length,
		60,
		"userPreview should be truncated to 60 chars",
	);
	eq(rounds[0].userPreview, longContent.slice(0, 60));
});

run("assistantPreview truncated at 100 chars", () => {
	const longContent = "B".repeat(120);
	const msgs = [
		{ id: "u1", role: "user", content: "Tell me a story." },
		{ id: "a1", role: "assistant", content: longContent },
	];
	const rounds = computeRoundsForTest(msgs);
	eq(
		rounds[0].assistantPreview.length,
		100,
		"assistantPreview should be truncated to 100 chars",
	);
});

run("multi-assistant: assistantCount reflects total", () => {
	const msgs = [
		{ id: "u1", role: "user", content: "Question" },
		{ id: "a1", role: "assistant", content: "First answer" },
		{ id: "a2", role: "assistant", content: "Second answer" },
		{ id: "a3", role: "assistant", content: "Third answer" },
	];
	const rounds = computeRoundsForTest(msgs);
	eq(rounds.length, 1);
	eq(rounds[0].assistantCount, 3, "assistantCount should be 3");
	eq(
		rounds[0].assistantPreview,
		"First answer",
		"assistantPreview should be FIRST assistant",
	);
});

run(
	"lead assistant: assistantPreview = content, userPreview = undefined",
	() => {
		// Lead assistant ONLY (no user follows in this batch) → 1 round
		const msgs = [
			{ id: "a1", role: "assistant", content: "I am an opening assistant." },
		];
		const rounds = computeRoundsForTest(msgs);
		eq(rounds.length, 1, "lead-only: 1 round");
		eq(
			rounds[0].userPreview,
			undefined,
			"lead assistant round has no userPreview",
		);
		eq(
			rounds[0].assistantPreview,
			"I am an opening assistant.",
			"lead assistant uses its content as assistantPreview",
		);
		eq(rounds[0].assistantCount, 1, "assistantCount should be 1");
	},
);

run("empty store → 0 rounds", () => {
	const rounds = computeRoundsForTest([]);
	eq(rounds.length, 0);
});

run(
	"title fallback chain: userPreview → title → assistantPreview → 'Untitled round'",
	() => {
		// Test the UI-layer fallback chain logic in isolation
		const fallbackChain = (r) =>
			r.userPreview || r.title || r.assistantPreview || "Untitled round";
		const normalRound = {
			userPreview: "User Q",
			title: "User Q",
			assistantPreview: "Answer",
			userPreviewDefined: true,
		};
		eq(fallbackChain(normalRound), "User Q");
		const leadRound = {
			userPreview: undefined,
			title: "Lead assistant",
			assistantPreview: "Answer",
			userPreviewDefined: false,
		};
		eq(fallbackChain(leadRound), "Lead assistant");
	},
);

// ─── Output ─────────────────────────────────────────────────────────────────────

console.log(JSON.stringify(tests, null, 2));
const passed = tests.filter((t) => t.passed).length;
const total = tests.length;
const allPassed = passed === total;
console.log("=== SUMMARY ===");
console.log(JSON.stringify({ total, passed, allPassed }));
process.exit(allPassed ? 0 : 1);
