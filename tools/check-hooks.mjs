import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { validateHooks } from "../plugins/harness/src/build/validate-hooks.mjs";

/**
 * CI entry point for the hooks validator (M2, M23).
 *
 * Absent `hooks.json` is not a pass and not a failure — no gate ships until
 * Phase 4, so there is nothing to validate yet. Saying so out loud beats a
 * silent zero, which would look identical once there IS a file and the
 * validator has quietly stopped running.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const file = join(root, "plugins", "harness", "hooks", "hooks.json");

if (!existsSync(file)) {
  process.stderr.write("check:hooks — no hooks.json yet (no gates ship before Phase 4); nothing to validate\n");
} else {
  const problems = validateHooks(file);
  for (const p of problems) process.stderr.write(`${p}\n`);
  if (problems.length > 0) {
    process.stderr.write(`\n${problems.length} problem(s) in hooks.json.\n`);
    process.exitCode = 1;
  } else {
    process.stderr.write("check:hooks — clean\n");
  }
}
