// features/bootstrapExtract.ts — recovers the conversation from Arena's page
// bootstrap data.
//
// Arena ships the whole transcript inside __NEXT_DATA__ (and, on some routes, in
// an inline script) before it renders a single message. Reading that is strictly
// better than scraping the DOM: it is complete, unaffected by virtualisation,
// and available immediately. This module does that parse and nothing else.
//
// Split out of conversationStore.ts in Phase 5 -- it is a parser for a specific
// site payload, not store logic.

import type { SidebarMessage } from "../types";
import { fingerprint } from "../core/fingerprint";

// ─── Bootstrap: extract initial messages from page markup ───────────────────────────

export function extractBootstrapMessages(): SidebarMessage[] {
	const results: SidebarMessage[] = [];

	// Try __NEXT_DATA__ JSON embedded in page.
	try {
		const nextDataEl = document.getElementById("__NEXT_DATA__");
		if (nextDataEl && nextDataEl.textContent) {
			const nd = JSON.parse(nextDataEl.textContent);
			const msgs = findMessagesInObject(nd, [], 0);
			for (const m of msgs) {
				results.push({ ...m, origin: "bootstrap" });
			}
		}
	} catch {
		/* intentionally empty — __NEXT_DATA__ may not exist on all pages */
	}

	// Also scan inline script tags for Arena message structures.
	try {
		const scripts = document.querySelectorAll("script");
		for (const s of Array.from(scripts)) {
			const txt = s.textContent || "";
			const matches = txt.matchAll(
				/"(content|text|userMessage|assistantMessage)"\s*:\s*"((?:[^"\\]|\\.){10,5000})"/g,
			);
			for (const m of matches) {
				const content = m[2].replace(/\\"/g, '"').replace(/\\n/g, "\n");
				if (content.length > 5) {
					const fp = fingerprint(content);
					if (
						!results.find(
							(r) => (r.fingerprint || fingerprint(r.content)) === fp,
						)
					) {
						results.push({
							id: "boot-" + results.length,
							role: detectRole(content),
							content,
							origin: "bootstrap",
							fingerprint: fp,
						});
					}
				}
			}
		}
	} catch {
		/* intentionally empty — script scanning may throw */
	}

	return results;
}

function findMessagesInObject(
	obj: unknown,
	path: string[],
	depth: number,
): SidebarMessage[] {
	if (depth > 8 || !obj || typeof obj !== "object") return [];
	const results: SidebarMessage[] = [];

	// Terminal check: does this object look like a message?
	const o = obj as Record<string, unknown>;
	if (
		typeof o.content === "string" &&
		o.content.length > 5 &&
		(o.role === "user" || o.role === "assistant")
	) {
		results.push({
			id: "boot-" + path.join("-") + "-" + results.length,
			role: o.role as "user" | "assistant",
			content: String(o.content).slice(0, 10000),
			origin: "bootstrap",
			fingerprint: fingerprint(String(o.content)),
		});
	}

	for (const [k, v] of Object.entries(obj)) {
		if (Array.isArray(v)) {
			for (let i = 0; i < v.length; i++) {
				results.push(
					...findMessagesInObject(v[i], [...path, k, String(i)], depth + 1),
				);
			}
		} else if (v && typeof v === "object") {
			results.push(...findMessagesInObject(v, [...path, k], depth + 1));
		}
	}

	return results;
}

function detectRole(content: string): "user" | "assistant" {
	// Heuristic: short, question-like → user; long, complete sentences → assistant.
	if (content.length < 200) return "user";
	const questionMarks = (content.match(/[?？]/g) || []).length;
	if (questionMarks > 2) return "user";
	return "assistant";
}
