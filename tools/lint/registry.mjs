/**
 * The prohibition registry: the nine absolute prohibitions, each bound to the
 * rule that enforces it and the fixture that proves the rule fires.
 *
 * This file is the single source the completeness test reads. A prohibition
 * added here without a rule fails the build, which is the point: the failure
 * mode being guarded against is a prohibition that everyone believes is
 * enforced and is not.
 *
 * `simulatedPath` is where the fixture would live if it were real source. The
 * fixtures sit under tests/, which every rule's `appliesTo` correctly excludes,
 * so a test must present the fixture at a path the rule actually governs —
 * otherwise it asserts nothing and passes for the wrong reason.
 *
 * @typedef {{
 *   prohibition: number,
 *   moat: string,
 *   statement: string,
 *   ruleId: string,
 *   fixture: string,
 *   simulatedPath: string
 * }} Entry
 */

/** @type {Entry[]} */
export const PROHIBITIONS = [
  { prohibition: 1, moat: "M1", ruleId: "no-process-exit",
    statement: "No process.exit() or bare exit outside src/lib/emit.mjs",
    fixture: "plugins/harness/tests/lint/fixtures/p1-process-exit.mjs",
    simulatedPath: "plugins/harness/src/gates/fixture.mjs" },
  { prohibition: 2, moat: "M3", ruleId: "no-stdout-writes",
    statement: "No writes to stdout outside src/lib/emit.mjs",
    fixture: "plugins/harness/tests/lint/fixtures/p2-stdout-write.mjs",
    simulatedPath: "plugins/harness/src/gates/fixture.mjs" },
  { prohibition: 3, moat: "M9", ruleId: "no-direct-cwd",
    statement: "No process.cwd() or direct CLAUDE_PROJECT_DIR reads outside src/lib/repo.mjs",
    fixture: "plugins/harness/tests/lint/fixtures/p3-direct-cwd.mjs",
    simulatedPath: "plugins/harness/src/gates/fixture.mjs" },
  { prohibition: 4, moat: "M2", ruleId: "hooks-json-generated",
    statement: "No hand-edited hooks/hooks.json; the generator is its only writer",
    fixture: "plugins/harness/tests/lint/fixtures/p4-hand-edited/hooks.json",
    simulatedPath: "plugins/harness/hooks/hooks.json" },
  { prohibition: 5, moat: "M23", ruleId: "handlers-point-at-runner",
    statement: "No handler in hooks.json pointing anywhere except runner.mjs",
    fixture: "plugins/harness/tests/lint/fixtures/p5-foreign-handler/hooks.json",
    simulatedPath: "plugins/harness/hooks/hooks.json" },
  { prohibition: 6, moat: "M25", ruleId: "adapter-never-blind-pass",
    statement: "No adapter returning pass for output it did not parse (restated, ADR-0004)",
    fixture: "plugins/harness/tests/lint/fixtures/p6-blind-pass.mjs",
    simulatedPath: "plugins/harness/src/adapters/fixture.mjs" },
  { prohibition: 7, moat: "M8", ruleId: "no-state-under-plugin-root",
    statement: "No persistent state written under the plugin root",
    fixture: "plugins/harness/tests/lint/fixtures/p7-plugin-root-write.mjs",
    simulatedPath: "plugins/harness/src/lib/fixture.mjs" },
  { prohibition: 8, moat: "M26", ruleId: "no-shared-handle-append",
    statement: "No shared-handle appends to the event log",
    fixture: "plugins/harness/tests/lint/fixtures/p8-shared-append.mjs",
    simulatedPath: "plugins/harness/src/gates/fixture.mjs" },
  { prohibition: 9, moat: "M20", ruleId: "security-relevant-pretooluse-only",
    statement: "No securityRelevant gate registered outside PreToolUse or the permission system",
    fixture: "plugins/harness/tests/lint/fixtures/p9-security-on-posttooluse.mjs",
    simulatedPath: "plugins/harness/src/gates/fixture.mjs" },
];
