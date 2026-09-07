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
			// measured, and only ever raised. Coverage is still low because
			// content.ts and ui/* are untestable by construction (side effects
			// at import, no seams) -- lifting them is the Phase 4/5 refactor,
			// not something a threshold can force today.
			// Do not lower these without saying so in the commit message.
			//   measured: statements 26.87 / branches 28.94 / functions 32.67 / lines 26.81
			thresholds: {
				statements: 26,
				branches: 28,
				functions: 32,
				lines: 26,
			},
		},
	},
});
