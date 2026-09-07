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
	},
});
