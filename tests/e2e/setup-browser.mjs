// tests/e2e/setup-browser.mjs — bootstrap a Chromium binary in a
// network-restricted sandbox where neither apt nor Google's download hosts
// are reachable, but npm is. @sparticuz/chromium ships a full (non-shell)
// Chromium binary inside its npm tarball; this script extracts it plus the
// NSS shared libraries it needs and prints the env vars for run.mjs.
//
// You do NOT need this on a normal machine — there run.mjs simply uses your
// installed Chrome/Edge (or E2E_BROWSER=/path/to/chrome).

import { execSync } from "node:child_process";
import { mkdirSync, existsSync, writeFileSync } from "node:fs";
import path from "node:path";

const ROOT = "/tmp/arena-sidebar-e2e-browser";
const LIB_DIR = path.join(ROOT, "al2023", "lib");

function run(cmd, cwd) {
	console.log(`  $ ${cmd}`);
	execSync(cmd, { cwd, stdio: "inherit" });
}

mkdirSync(ROOT, { recursive: true });
// tar refuses a missing cwd on current npm tar releases. Create the target
// before extraction so this bootstrap works in a clean sandbox as documented.
mkdirSync(LIB_DIR, { recursive: true });
if (!existsSync(path.join(ROOT, "package.json"))) {
	writeFileSync(path.join(ROOT, "package.json"), '{"private":true}\n');
}

console.log(
	"1/3  installing @sparticuz/chromium via npm (the only open channel)…",
);
run("npm install @sparticuz/chromium tar --no-audit --no-fund", ROOT);

console.log("2/3  extracting the Chromium binary…");
run(
	`node -e "import('@sparticuz/chromium').then(async (m) => { console.log(await m.default.executablePath()); })"`,
	ROOT,
);

console.log("3/3  extracting the NSS libraries…");
run(
	`node -e "const z=require('node:zlib'),fs=require('node:fs');` +
		`fs.writeFileSync('${ROOT}/al2023.tar', z.brotliDecompressSync(fs.readFileSync('${ROOT}/node_modules/@sparticuz/chromium/bin/al2023.tar.br')));"`,
	ROOT,
);
run(
	`node -e "require('tar').x({ file: '${ROOT}/al2023.tar', cwd: '${ROOT}/al2023' })"`,
	ROOT,
);

console.log("\nChromium is ready. Run the suite with:\n");
console.log(
	`  E2E_BROWSER=/tmp/chromium LD_LIBRARY_PATH=${LIB_DIR} npm run test:e2e\n`,
);
