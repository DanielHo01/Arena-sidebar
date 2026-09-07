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
		coverage: {
			provider: "v8",
			reporter: ["text", "lcov"],
			include: ["src/**/*.ts"],
			// Pure declarations / data, not logic -- counting them would let the
			// percentage move without any behaviour being tested.
			exclude: ["src/types.ts", "src/ui/styles.ts"],
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
			//   measured (Phase 5):
			//     all        42.19 / 42.78 / 45.97 / 42.47
			//     src/core   99.17 / 90.78 / 100   / 100
			//     src/platform 90.12 / 86.66 / 81.81 / 92.64
			thresholds: {
				statements: 42,
				branches: 42,
				functions: 45,
				lines: 42,
				// Pure logic. A regression here is the expensive kind, so these
				// are pinned tight -- see the Phase 6 probe in the plan.
				"src/core/**": {
					statements: 99,
					branches: 90,
					functions: 100,
					lines: 100,
				},
				"src/platform/**": {
					statements: 90,
					branches: 86,
					functions: 81,
					lines: 92,
				},
			},
		},
	},
});
