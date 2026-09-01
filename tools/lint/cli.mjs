import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { run } from "./engine.mjs";
import { rules } from "./rules/index.mjs";

/**
 * Lint entry point. Reports every violation and exits non-zero if any exist.
 *
 * This file is dev tooling, not plugin source, so it is outside the reach of
 * prohibitions 1 and 2 — the rules scope themselves to plugins/harness/src/.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const violations = run(root, rules);

for (const v of violations) {
  process.stderr.write(`${v.file}:${v.line}  ${v.message}\n`);
}

if (violations.length > 0) {
  process.stderr.write(`\n${violations.length} prohibition violation(s).\n`);
  process.exitCode = 1;
} else {
  process.stderr.write(`lint: clean — ${rules.length} prohibition rules, no violations.\n`);
}
