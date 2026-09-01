import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import { PROHIBITIONS } from "../../../../tools/lint/registry.mjs";
import { rules } from "../../../../tools/lint/rules/index.mjs";
import { stripNonCode } from "../../../../tools/lint/engine.mjs";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/**
 * Nine tests, one per prohibition, each proving its rule fires on a real
 * violation.
 *
 * A lint rule that has never been shown to fire is indistinguishable from one
 * that cannot — which is M2's failure mode reproduced in the tooling meant to
 * prevent it. So each fixture is genuinely violating code, presented at a path
 * the rule actually governs.
 */
for (const entry of PROHIBITIONS) {
  test(`prohibition ${entry.prohibition} (${entry.moat}): ${entry.ruleId} fires`, () => {
    const rule = rules.find((r) => r.id === entry.ruleId);
    assert.ok(rule, `no rule registered with id ${entry.ruleId}`);

    assert.equal(
      rule.prohibition,
      entry.prohibition,
      "rule and registry disagree about which prohibition this is",
    );

    // The rule must actually govern the path, or the check below proves nothing.
    assert.ok(
      rule.appliesTo(entry.simulatedPath),
      `${rule.id} does not apply to ${entry.simulatedPath}, so this test would pass vacuously`,
    );

    const raw = readFileSync(resolve(ROOT, entry.fixture), "utf8");
    const text = rule.fileset === "source" ? stripNonCode(raw) : raw;
    const violations = rule.check(text, entry.simulatedPath);

    assert.ok(
      violations.length > 0,
      `${rule.id} found nothing in its own negative fixture ${entry.fixture}`,
    );
  });
}

test("a rule does not fire on the file it exempts", () => {
  // The counterpart to the nine above. A rule that fires everywhere is as
  // useless as one that fires nowhere: emit.mjs must be free to call
  // process.exit, since it is the only thing that may.
  const exitRule = rules.find((r) => r.id === "no-process-exit");
  assert.ok(exitRule);
  assert.equal(exitRule.appliesTo("plugins/harness/src/lib/emit.mjs"), false);

  const repoRule = rules.find((r) => r.id === "no-direct-cwd");
  assert.ok(repoRule);
  assert.equal(repoRule.appliesTo("plugins/harness/src/lib/repo.mjs"), false);

  const logRule = rules.find((r) => r.id === "no-shared-handle-append");
  assert.ok(logRule);
  assert.equal(logRule.appliesTo("plugins/harness/src/lib/log.mjs"), false);
});

test("comments and strings are not code", () => {
  // Without this, the word process.exit inside a doc comment fires a rule,
  // somebody adds an exception to quiet it, and the exception is where the
  // next real violation hides.
  const rule = rules.find((r) => r.id === "no-process-exit");
  assert.ok(rule);

  const commented = stripNonCode(`
    // never call process.exit() here
    /* process.exit(1) would be wrong */
    const help = "call process.exit() only in emit";
    export function ok() { return 0; }
  `);
  assert.equal(rule.check(commented, "plugins/harness/src/gates/x.mjs").length, 0);

  const real = stripNonCode(`export function bad() { process.exit(2); }`);
  assert.equal(rule.check(real, "plugins/harness/src/gates/x.mjs").length, 1);
});
