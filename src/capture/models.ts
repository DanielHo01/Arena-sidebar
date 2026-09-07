// capture/models.ts — resolves model ids to display names.
//
// Arena exposes the mapping inside its page bootstrap data (__NEXT_DATA__ and
// inline scripts) rather than through any API, so this scans the script text for
// publicName/id pairs and caches what it finds.

// ─── Model name harvesting ────────────────────────────────────────────────────────

/** Model id -> display name. Page-scoped: never cleared on a route change. */
export const modelNameById = new Map<string, string>();

export function harvestModelNames(): number {
	const w = window as unknown as {
		__NEXT_DATA__?: unknown;
		__initialModels?: unknown[];
	};
	const candidates: unknown[] = [];
	const tryPaths = [
		() =>
			(
				w.__NEXT_DATA__ as
					{ props?: { pageProps?: { initialModels?: unknown[] } } } | undefined
			)?.props?.pageProps?.initialModels,
		() =>
			(
				w.__NEXT_DATA__ as
					{ props?: { pageProps?: { initialModelAId?: string } } } | undefined
			)?.props?.pageProps?.initialModelAId
				? (w.__NEXT_DATA__ as { props?: { pageProps?: unknown } } | undefined)
						?.props?.pageProps
				: null,
		() => w.__initialModels,
	];
	for (const fn of tryPaths) {
		try {
			const v = fn();
			if (Array.isArray(v)) candidates.push(v);
			else if (
				v &&
				typeof v === "object" &&
				Array.isArray((v as { initialModels?: unknown[] }).initialModels)
			)
				candidates.push((v as { initialModels: unknown[] }).initialModels);
		} catch {
			/* intentionally empty — __NEXT_DATA__ path may not exist on all pages */
		}
	}
	try {
		const nextDataEl = document.querySelector("#__NEXT_DATA__");
		if (nextDataEl) {
			const txt = nextDataEl.textContent || "";
			const m = txt.match(
				/"initialModels"\s*:\s*\[([\s\S]{20,50000}?)\](?=[\s,}])/,
			);
			if (m) {
				try {
					candidates.push(JSON.parse("[" + m[1] + "]"));
				} catch {
					/* intentionally empty — JSON parse of extracted snippet may fail */
				}
			}
		}
	} catch {
		/* intentionally empty — __NEXT_DATA__ element may not exist */
	}
	try {
		const scripts = document.querySelectorAll("script");
		scripts.forEach((s) => {
			const txt = s.textContent || "";
			const m = txt.match(
				/"initialModels"\s*:\s*\[([\s\S]{20,50000}?)\](?=[\s,}])/,
			);
			if (m) {
				try {
					candidates.push(JSON.parse("[" + m[1] + "]"));
				} catch {
					/* intentionally empty — JSON parse of extracted snippet may fail */
				}
			}
		});
	} catch {
		/* intentionally empty — script iteration may throw */
	}
	try {
		const allTexts = Array.from(document.querySelectorAll("script"))
			.map((s) => s.textContent || "")
			.join("\n");
		const ms = allTexts.matchAll(
			/"publicName"\s*:\s*"([^"]+)"[^}]{0,200}"id"\s*:\s*"([^"]+)"/g,
		);
		for (const m of ms) {
			const name = m[1],
				id = m[2];
			if (name && id && !modelNameById.has(id)) modelNameById.set(id, name);
		}
	} catch {
		/* intentionally empty — matchAll on large script text may throw */
	}
	let n = 0;
	for (const arr of candidates) {
		if (!Array.isArray(arr)) continue;
		for (const m of arr as Array<{ id?: string; publicName?: string }>) {
			if (m && typeof m === "object" && m.id && m.publicName) {
				if (!modelNameById.has(m.id)) {
					modelNameById.set(m.id, m.publicName);
					n++;
				}
			}
		}
	}
	return n;
}

export function lookupModelName(id: string): string {
	if (!id) return "";
	if (modelNameById.has(id)) return modelNameById.get(id)!;
	harvestModelNames();
	return modelNameById.get(id) || "";
}
