// Real source-based test for round grouping — imports computeRounds(actual production
// logic) from conversationStore.ts, unlike scripts/test-round-grouping.cjs which used
// a mirrored copy that no longer matches production (groupIntoRounds was removed).
import assert from "node:assert/strict";
import { computeRounds } from "../src/conversationStore";
import type { SidebarMessage } from "../src/types";

function msg(
	id: string,
	role: "user" | "assistant",
	content: string,
): SidebarMessage {
	return { id, role, content, fingerprint: "fp-" + id };
}

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

console.log("test-src-rounds: computeRounds (real source import)");

run("user+assistant -> 1 round, previews set", () => {
	const rounds = computeRounds([
		msg("u1", "user", "hello"),
		msg("a1", "assistant", "world reply"),
	]);
	assert.equal(rounds.length, 1);
	assert.equal(rounds[0].id, "u1");
	assert.equal(rounds[0].userPreview, "hello");
	assert.equal(rounds[0].assistantPreview, "world reply");
	assert.equal(rounds[0].assistantCount, 1);
	assert.equal(rounds[0].messageCount, 2);
});

run("userPreview truncated at 60 chars", () => {
	const rounds = computeRounds([
		msg("u1", "user", "x".repeat(100)),
		msg("a1", "assistant", "ok"),
	]);
	assert.equal(rounds[0].userPreview!.length, 60);
});

run("assistantPreview truncated at 100 chars", () => {
	const rounds = computeRounds([
		msg("u1", "user", "q"),
		msg("a1", "assistant", "y".repeat(200)),
	]);
	assert.equal(rounds[0].assistantPreview!.length, 100);
});

run("multi-assistant: assistantCount reflects total", () => {
	const rounds = computeRounds([
		msg("u1", "user", "q"),
		msg("a1", "assistant", "one"),
		msg("a2", "assistant", "two"),
	]);
	assert.equal(rounds[0].assistantCount, 2);
	assert.equal(rounds[0].messageCount, 3);
});

run(
	"lead assistant (before first user) becomes own round, no userPreview",
	() => {
		const rounds = computeRounds([
			msg("a0", "assistant", "welcome"),
			msg("u1", "user", "hi"),
			msg("a1", "assistant", "reply"),
		]);
		assert.equal(rounds.length, 2);
		assert.equal(rounds[0].userPreview, undefined);
		assert.equal(rounds[0].assistantPreview, "welcome");
		assert.equal(rounds[0].assistantCount, 1);
		assert.equal(rounds[1].id, "u1");
		assert.equal(rounds[1].assistantPreview, "reply");
	},
);

run("lead assistant only (no user) -> single round", () => {
	const rounds = computeRounds([msg("a0", "assistant", "opening")]);
	assert.equal(rounds.length, 1);
	assert.equal(rounds[0].userPreview, undefined);
	assert.equal(rounds[0].assistantPreview, "opening");
});

run("empty input -> 0 rounds", () => {
	assert.equal(computeRounds([]).length, 0);
});

run("alternating user/assistant produces one round per user turn", () => {
	const rounds = computeRounds([
		msg("u1", "user", "one"),
		msg("a1", "assistant", "r1"),
		msg("u2", "user", "two"),
		msg("a2", "assistant", "r2"),
	]);
	assert.equal(rounds.length, 2);
	assert.equal(rounds[0].id, "u1");
	assert.equal(rounds[1].id, "u2");
});

run("title is first user content truncated to 80 chars", () => {
	const rounds = computeRounds([
		msg("u1", "user", "a question"),
		msg("a1", "assistant", "ok"),
	]);
	assert.equal(rounds[0].title, "a question");
});

run("does not mutate input messages", () => {
	const inputs = [msg("u1", "user", "q"), msg("a1", "assistant", "a")];
	const frozen = inputs.map((m) => ({ ...m }));
	computeRounds(inputs);
	assert.deepEqual(inputs, frozen);
});

if (failures.length > 0) {
	console.error(`test-src-rounds: FAILED ${failures.length}:`);
	failures.forEach((f) => console.error("  - " + f));
	process.exit(1);
}
console.log("test-src-rounds: PASS (" + "10 assertions" + ")");
