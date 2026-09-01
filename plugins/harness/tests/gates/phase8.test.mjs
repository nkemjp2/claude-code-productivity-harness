import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { scoreEvalRun } from "../../src/lib/evalset.mjs";
import { lintCorpus } from "../../src/lib/corpus.mjs";
import { routeEscalation } from "../../src/lib/escalation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATES = resolve(HERE, "..", "..", "src", "gates");
const gate = async (/** @type {string} */ id) => await import(pathToFileURL(join(GATES, `${id}.mjs`)).href);

/**
 * Phase 8: governance — keeping the harness itself honest.
 */

function repo(/** @type {string} */ policy = "enabled: true\nmode: enforce\n") {
  const root = mkdtempSync(join(tmpdir(), "harness-p8-"));
  mkdirSync(join(root, ".harness", "tasks", "TASK-1"), { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), policy);
  writeFileSync(join(root, ".harness", "current-task"), "TASK-1\n");
  writeFileSync(
    join(root, ".harness", "tasks", "TASK-1", "contract.yaml"),
    'id: TASK-1\nblast_radius:\n  - "src/**"\ncriteria:\n  - id: AC-1\n    statement: The system shall work.\nbudget:\n  tokens: 1000\n  minutes: 30\n',
  );
  writeFileSync(join(root, ".harness", "tasks", "TASK-1", "plan.md"), "# Plan\n");
  return root;
}

/* ---------- eval set: two tracks, one gates (G3.2) ---------- */

test("a failed adversarial case blocks the harness change outright", () => {
  const r = scoreEvalRun({
    adversarial: [{ id: "injection", passed: false }, { id: "vacuous-test", passed: true }],
    outcomes: [{ id: "escape_rate", delta: -0.4 }],
  });
  assert.equal(r.blocks, true);
  assert.match(r.reason, /injection/);
});

test("an outcome measure moving the wrong way NEVER blocks", () => {
  // G3.2 exactly. An eval set of a handful of tasks has no statistical power
  // to detect a change in escape rate, so gating on it reverts good changes on
  // sampling noise.
  const r = scoreEvalRun({
    adversarial: [{ id: "injection", passed: true }],
    outcomes: [{ id: "escape_rate", delta: +2.5 }],
  });
  assert.equal(r.blocks, false);
  assert.match(r.trend.join(" "), /escape_rate/);
  assert.match(r.reason, /directional|trend|no statistical power/i);
});

test("an eval run with no adversarial cases does not count as a pass", () => {
  const r = scoreEvalRun({ adversarial: [], outcomes: [] });
  assert.equal(r.blocks, true);
  assert.match(r.reason, /no adversarial/i);
});

/* ---------- corpus lint (G2.1) ---------- */

test("a direct contradiction across corpus files is reported", () => {
  const problems = lintCorpus([
    { path: "CLAUDE.md", text: "Always use tabs for indentation." },
    { path: ".claude/rules/style.md", text: "Never use tabs for indentation." },
  ]);
  assert.ok(problems.some((p) => /contradict/i.test(p)), problems.join("\n"));
  assert.ok(problems.some((p) => p.includes("CLAUDE.md") && p.includes("style.md")));
});

test("a rule with no expiry date is reported", () => {
  // R-L2.3. Rules added for one incident accumulate and consume context budget
  // indefinitely unless something forces a review.
  const problems = lintCorpus([{ path: ".claude/rules/x.md", text: "Do not use dynamic imports." }]);
  assert.ok(problems.some((p) => /review date|expiry/i.test(p)));
});

test("a rule carrying an incident link and a review date passes", () => {
  assert.deepEqual(
    lintCorpus([
      {
        path: ".claude/rules/x.md",
        text: "Do not use dynamic imports.\n\nIncident: INC-3\nReview by: 2026-12-01\nEnforced by: arch-check gate\n",
      },
    ]),
    [],
  );
});

test("duplication across two files is reported once, naming both", () => {
  const line = "Every public function carries a JSDoc block.";
  const problems = lintCorpus([
    { path: "CLAUDE.md", text: `${line}\n\nReview by: 2027-01-01\nIncident: n/a\nEnforced by: lint\n` },
    { path: ".claude/rules/docs.md", text: `${line}\n\nReview by: 2027-01-01\nIncident: n/a\nEnforced by: lint\n` },
  ]);
  assert.equal(problems.filter((p) => /duplicat/i.test(p)).length, 1);
});

/* ---------- escalation routing (G4) ---------- */

test("an escalation routes through terminalSequence, never /dev/tty", () => {
  // R-G4.3. Hooks have no controlling terminal, so a direct terminal write is
  // not merely bad practice — it cannot work.
  const out = routeEscalation({ reason: "criteria unmet after 5 attempts", task: "TASK-1", interactive: true });
  assert.ok(out.terminalSequence, "no terminalSequence emitted");
  assert.ok(!JSON.stringify(out).includes("/dev/tty"));
  assert.match(out.systemMessage, /TASK-1/);
});

test("in a non-interactive session the sequence is omitted rather than emitted uselessly", () => {
  const out = routeEscalation({ reason: "x", task: "TASK-1", interactive: false });
  assert.equal(out.terminalSequence, undefined);
  assert.ok(out.systemMessage, "the message must still be recorded");
});

/* ---------- budgets and thrash breaker (G5.1, G5.2) ---------- */

test("the thrash breaker halts on a file edited past the threshold", async () => {
  const root = repo();
  const g = await gate("thrash-breaker");
  const events = Array.from({ length: 6 }, () => ({
    event: "PreToolUse", session_id: "s", task: "TASK-1", target: join(root, "src", "x.ts"), verdict: "pass",
  }));
  const r = await g.check({
    event: { hook_event_name: "PreToolUse", session_id: "s", cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "src", "x.ts") } },
    root,
    policy: { enabled: true, mode: "enforce", budgets: { thrash_edits: 5 } },
    events,
  });
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /x\.ts/);
  assert.match(r.reason, /6|5/);
  assert.equal(r.escalate, true, "a thrash halt is an escalation, not a retry");
});

test("normal editing is not thrash", async () => {
  const root = repo();
  const g = await gate("thrash-breaker");
  const r = await g.check({
    event: { hook_event_name: "PreToolUse", session_id: "s", cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "src", "x.ts") } },
    root,
    policy: { enabled: true, mode: "enforce", budgets: { thrash_edits: 5 } },
    events: [{ event: "PreToolUse", session_id: "s", task: "TASK-1", target: join(root, "src", "x.ts"), verdict: "pass" }],
  });
  assert.equal(r.verdict, "pass");
});

test("the budget gate blocks when the task's wall-clock budget is exhausted", async () => {
  const root = repo();
  const g = await gate("budget");
  const started = new Date(Date.now() - 45 * 60 * 1000).toISOString();
  const r = await g.check({
    event: { hook_event_name: "PostToolBatch", session_id: "s", cwd: root },
    root,
    policy: { enabled: true, mode: "enforce", budgets: {} },
    events: [{ event: "PreToolUse", ts: started, session_id: "s", task: "TASK-1", verdict: "pass" }],
  });
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /30/, "the refusal must name the budget it exceeded");
});

/* ---------- effort routing (G6.1) ---------- */

test("effort routing reads CLAUDE_EFFORT and warns on protected-path work at low effort", async () => {
  // R-G6.2's enforcement point does not exist — PreModelSwitch is absent from
  // the client (ADR-0003) — so this cannot block a model switch. What it CAN
  // do is observe the effort actually in force and say so, which is the honest
  // remainder of the requirement rather than a substitute pretending to be it.
  const root = repo();
  const g = await gate("effort-routing");
  const r = await g.check({
    event: { hook_event_name: "PreToolUse", session_id: "s", cwd: root, tool_name: "Write", tool_input: { file_path: join(root, ".github", "workflows", "ci.yml") } },
    root,
    policy: { enabled: true, mode: "enforce" },
    effort: "low",
  });
  assert.equal(r.verdict, "warn");
  assert.match(r.message, /effort/i);
  assert.match(r.message, /PreModelSwitch|cannot block/i, "the gate must not imply it enforced a floor");
});

test("effort routing is silent on ordinary paths", async () => {
  const root = repo();
  const g = await gate("effort-routing");
  const r = await g.check({
    event: { hook_event_name: "PreToolUse", session_id: "s", cwd: root, tool_name: "Write", tool_input: { file_path: join(root, "src", "x.ts") } },
    root,
    policy: { enabled: true, mode: "enforce" },
    effort: "low",
  });
  assert.equal(r.verdict, "pass");
});
