import { defineConfig } from "vitest/config";

// Separate from vite.config.ts on purpose: the build config pulls in
// @crxjs/vite-plugin (manifest rewriting), which is meaningless under test.
// When both files exist, Vitest reads this one.
export default defineConfig({
	test: {
		// jsdom for everything: the DOM/lifecycle bugs this suite exists to
		// catch need a document, and the pure-logic tests are unaffected by it.
		environment: "jsdom",
		include: ["tests/**/*.test.ts"],
		// Fail on unhandled rejections rather than passing silently.
		dangerouslyIgnoreUnhandledErrors: false,
		// 4.5s vs 23.6s, measured 2026-10-07 on this suite (42 files). jsdom was
		// being booted once per file and that boot was 63-79% of the wall clock;
		// vmThreads creates the environment once per worker and still keeps
		// per-file isolation, which this suite needs -- conversationStore and the
		// capture module state are module-level singletons.
		pool: "vmThreads",
		// Order-independence is not a nicety here: turning this on immediately found
		// two real bugs -- capture.test.ts reset conversationStore + chatRounds but
		// not pendingRequests, so an earlier test's leftover request paired with the
		// next response and flushed a phantom round; and panel-round-item.test.ts
		// reset module state in only two of its three describes, the third leaning on
		// a stale global mock. Shuffle stays on: it is the only thing that catches a
		// test relying on its neighbours. Reproduce one failing order with
		// `npx vitest run --sequence.shuffle --sequence.seed=<n>`.
		sequence: { shuffle: true },
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**/*.ts"],
			// Pure declarations / data, not logic -- counting them would let the
			// percentage move without any behaviour being tested. The three
			// barrels are re-export-only (asserted by tests/unit/layer-rules.test.ts:
			// if logic lands in one, this list has to shrink).
			exclude: [
				"src/types.ts",
				"src/capture.ts",
				"src/ui/styles.ts",
				"src/ui/panel.ts",
			],
			// ── Ratchet ────────────────────────────────────────────────────
			// These are FLOORS, not targets: set just under the level actually
			// measured, and only ever raised. Do not lower them without saying
			// so in the commit message.
			//
			// The refactor plan asked for "core/ 90%, overall 70%". The core/
			// half is met (99.17%); the 70% overall figure is not reachable and
			// never was -- it assumed content.ts and ui/* were testable, and
			// they run side effects at import with no seams. Rather than lower
			// one global number until it passes, which would let the pure
			// layers rot unnoticed, the floors are set PER DIRECTORY: the
			// layers that are actually well covered are pinned there, and a low
			// global floor still catches a total collapse.
			//
			//   measured 2026-10-07 (`npm run test:coverage`, 41 files / 724 tests):
			//     all           95.99 / 86.47 / 96.55 / 97.65
			//     src/core      99.22 / 91.46 / 100    / 100
			//     src/platform  96.62 / 89.93 / 91.83  / 99.03
			//     src/app       96.82 / 94.11 / 87.5   / 98.19
			//     src/features  93.43 / 88.23 / 96.42  / 96.14
			//     src/ui        98.84 / 91.82 / 97.82  / 99.58
			//   Floors sit 1-2 points under those. They used to read 42/42/45/42 with a
			//   comment claiming that was the measurement -- it was 53 points of slack,
			//   i.e. a ratchet that had silently stopped ratcheting. Do not repeat that:
			//   re-measure whenever you touch this number.
			thresholds: {
				statements: 94,
				branches: 85,
				functions: 95,
				lines: 96,
				// Pure logic. A regression here is the expensive kind, so these
				// are pinned tight -- see the Phase 6 probe in the plan.
				"src/core/**": {
					statements: 99,
					branches: 90,
					functions: 100,
					lines: 100,
				},
				"src/platform/**": {
					statements: 96,
					branches: 89,
					functions: 91,
					lines: 99,
				},
				// The orchestration layer: the reset/disposer registry is where
				// cross-session leaks hide, so it is pinned right under measured.
				"src/app/**": {
					statements: 96,
					branches: 94,
					functions: 87,
					lines: 98,
				},
				"src/features/**": {
					statements: 93,
					branches: 88,
					functions: 96,
					lines: 96,
				},
				"src/ui/**": {
					statements: 98,
					branches: 90,
					functions: 97,
					lines: 99,
				},
			},
		},
	},
});
