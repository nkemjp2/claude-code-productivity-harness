import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { runCanaries } from "../plugins/harness/src/canary.mjs";

/**
 * The canary suite as a CI entry point (R-F2.4).
 *
 * A gate that has quietly stopped firing is invisible to every other check:
 * the unit tests still pass, the types still check, the hooks file still
 * validates. Only a staged violation shows it.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins", "harness");

const results = await runCanaries({
  gateRoot: join(plugin, "src", "gates"),
  canaryRoot: join(plugin, "tests", "canary"),
});

for (const r of results) {
  process.stderr.write(
    `${r.pass ? "PASS" : "FAIL"}  ${r.gate.padEnd(18)} expect=${r.expected} actual=${r.actual}` +
      `${r.pass ? "" : `  ${r.detail}`}\n`,
  );
}

const failed = results.filter((r) => !r.pass);
if (results.length === 0) {
  process.stderr.write("no canaries ran — that is a failure, not a pass\n");
  process.exitCode = 1;
} else if (failed.length > 0) {
  process.stderr.write(`\n${failed.length} canary failure(s).\n`);
  process.exitCode = 1;
} else {
  process.stderr.write(`\n${results.length} canaries green\n`);
}
