import { writeFileSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { generateHooks } from "../plugins/harness/src/build/generate-hooks.mjs";

/**
 * Build hooks.json from the gate registry (M2).
 *
 * The generator is its only writer. `at` is pinned to the newest gate's
 * content rather than the wall clock, so regenerating an unchanged registry
 * produces an identical file and the CI drift check means something.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const plugin = join(root, "plugins", "harness");

const hooks = await generateHooks({
  gateRoot: join(plugin, "src", "gates"),
  canaryRoot: join(plugin, "tests", "canary"),
  now: "generated",
});

mkdirSync(join(plugin, "hooks"), { recursive: true });
writeFileSync(join(plugin, "hooks", "hooks.json"), `${JSON.stringify(hooks, null, 2)}\n`, "utf8");
process.stderr.write(`hooks.json — ${hooks._generated.gates.length} gate(s): ${hooks._generated.gates.join(", ")}\n`);
