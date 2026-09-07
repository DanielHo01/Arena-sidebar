// Real-source test: round grouping via computeRounds (actual production logic).
// Migrated verbatim from scripts/test-src-rounds.ts (10 assertions).
import { describe, it, expect } from "vitest";
import { computeRounds } from "../../src/core/rounds";
import type { SidebarMessage } from "../../src/types";

function msg(
	id: string,
	role: "user" | "assistant",
	content: string,
): SidebarMessage {
	return { id, role, content, fingerprint: "fp-" + id };
}

describe("computeRounds", () => {
	it("user+assistant -> 1 round, previews set", () => {
		const rounds = computeRounds([
			msg("u1", "user", "hello"),
			msg("a1", "assistant", "world reply"),
		]);
		expect(rounds).toHaveLength(1);
		expect(rounds[0].id).toBe("u1");
		expect(rounds[0].userPreview).toBe("hello");
		expect(rounds[0].assistantPreview).toBe("world reply");
		expect(rounds[0].assistantCount).toBe(1);
		expect(rounds[0].messageCount).toBe(2);
	});

	it("userPreview truncated at 60 chars", () => {
		const rounds = computeRounds([
			msg("u1", "user", "x".repeat(100)),
			msg("a1", "assistant", "ok"),
		]);
		expect(rounds[0].userPreview).toHaveLength(60);
	});

	it("assistantPreview truncated at 100 chars", () => {
		const rounds = computeRounds([
			msg("u1", "user", "q"),
			msg("a1", "assistant", "y".repeat(200)),
		]);
		expect(rounds[0].assistantPreview).toHaveLength(100);
	});

	it("multi-assistant: assistantCount reflects total", () => {
		const rounds = computeRounds([
			msg("u1", "user", "q"),
			msg("a1", "assistant", "one"),
			msg("a2", "assistant", "two"),
		]);
		expect(rounds[0].assistantCount).toBe(2);
		expect(rounds[0].messageCount).toBe(3);
	});

	it("lead assistant (before first user) becomes own round, no userPreview", () => {
		const rounds = computeRounds([
			msg("a0", "assistant", "welcome"),
			msg("u1", "user", "hi"),
			msg("a1", "assistant", "reply"),
		]);
		expect(rounds).toHaveLength(2);
		expect(rounds[0].userPreview).toBeUndefined();
		expect(rounds[0].assistantPreview).toBe("welcome");
		expect(rounds[0].assistantCount).toBe(1);
		expect(rounds[1].id).toBe("u1");
		expect(rounds[1].assistantPreview).toBe("reply");
	});

	it("lead assistant only (no user) -> single round", () => {
		const rounds = computeRounds([msg("a0", "assistant", "opening")]);
		expect(rounds).toHaveLength(1);
		expect(rounds[0].userPreview).toBeUndefined();
		expect(rounds[0].assistantPreview).toBe("opening");
	});

	it("empty input -> 0 rounds", () => {
		expect(computeRounds([])).toHaveLength(0);
	});

	it("alternating user/assistant produces one round per user turn", () => {
		const rounds = computeRounds([
			msg("u1", "user", "one"),
			msg("a1", "assistant", "r1"),
			msg("u2", "user", "two"),
			msg("a2", "assistant", "r2"),
		]);
		expect(rounds).toHaveLength(2);
		expect(rounds[0].id).toBe("u1");
		expect(rounds[1].id).toBe("u2");
	});

	it("title is first user content truncated to 80 chars", () => {
		const rounds = computeRounds([
			msg("u1", "user", "a question"),
			msg("a1", "assistant", "ok"),
		]);
		expect(rounds[0].title).toBe("a question");
	});

	it("does not mutate input messages", () => {
		const inputs = [msg("u1", "user", "q"), msg("a1", "assistant", "a")];
		const frozen = inputs.map((m) => ({ ...m }));
		computeRounds(inputs);
		expect(inputs).toEqual(frozen);
	});
});
