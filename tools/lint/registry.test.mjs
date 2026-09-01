import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { PROHIBITIONS } from "./registry.mjs";
import { rules } from "./rules/index.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Registry completeness.
 *
 * This is a different check from the nine per-rule tests, and it must exist
 * separately. Those prove each rule fires; this proves no prohibition is
 * sitting in the registry without a rule behind it, and no rule is sitting in
 * the codebase without a prohibition it answers to.
 *
 * The failure this catches is the one nobody notices: a tenth prohibition is
 * agreed, written down, and never wired up. Every existing test still passes,
 * the build stays green, and the prohibition is enforced by nothing but
 * everyone's belief that it is.
 */

test("the work order's nine prohibitions are all registered", () => {
  assert.equal(PROHIBITIONS.length, 9, "the work order states nine absolute prohibitions");
  const numbers = PROHIBITIONS.map((p) => p.prohibition).sort((a, b) => a - b);
  assert.deepEqual(numbers, [1, 2, 3, 4, 5, 6, 7, 8, 9], "prohibitions must be 1..9 with no gaps");
});

test("every prohibition has a rule that enforces it", () => {
  /** @type {string[]} */
  const unenforced = [];
  for (const entry of PROHIBITIONS) {
    if (!rules.some((r) => r.id === entry.ruleId)) {
      unenforced.push(`prohibition ${entry.prohibition} (${entry.moat}) -> no rule ${entry.ruleId}`);
    }
  }
  assert.deepEqual(unenforced, [], `unenforced prohibitions:\n${unenforced.join("\n")}`);
});

test("every rule answers to a registered prohibition", () => {
  // The other direction. A rule with no prohibition is either dead code or an
  // undocumented constraint, and both are worth knowing about.
  const orphans = rules
    .filter((r) => !PROHIBITIONS.some((p) => p.ruleId === r.id))
    .map((r) => r.id);
  assert.deepEqual(orphans, [], `rules with no registered prohibition: ${orphans.join(", ")}`);
});

test("every prohibition has a negative fixture that exists on disk", () => {
  const missing = PROHIBITIONS.filter((p) => !existsSync(resolve(ROOT, p.fixture))).map(
    (p) => p.fixture,
  );
  assert.deepEqual(missing, [], `missing fixtures: ${missing.join(", ")}`);
});

test("every rule states what it does not catch", () => {
  // A rule that overstates its reach is the silently-disabled gate wearing a
  // lint rule's clothes. Each describe must name its own blind spot, so the
  // limitation is discoverable at the point of trust rather than in an ADR.
  const silent = rules
    .filter((r) => !/does not catch|Does NOT catch|Does not catch/.test(r.describe))
    .map((r) => r.id);
  assert.deepEqual(silent, [], `rules that do not state their limits: ${silent.join(", ")}`);
});
