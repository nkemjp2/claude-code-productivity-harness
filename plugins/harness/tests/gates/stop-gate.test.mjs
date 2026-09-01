import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { captureEvidence } from "../../src/lib/evidence.mjs";
import { loadPolicy } from "../../src/lib/policy.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATES = resolve(HERE, "..", "..", "src", "gates");

/**
 * The definition-of-done gate, and the loop safety around it.
 *
 * This is the single highest-yield gate in the design, and the single easiest
 * one to turn into an expensive grind. Two properties keep it useful:
 *
 * It **verifies** freshness and never **captures**. A Stop gate may re-fire up
 * to the retry ceiling, and a mutation or full-suite run is minutes long — so
 * a capturing Stop gate turns each refusal into another few minutes and the
 * whole thing collapses into the grind it was meant to prevent (C3).
 *
 * And it escalates below the platform's own cap. The platform ends the session
 * after CLAUDE_CODE_STOP_HOOK_BLOCK_CAP consecutive blocks; a harness that
 * hits that has handed the decision to the platform rather than making it.
 */

/** @param {string} id */
const gate = async (id) => await import(pathToFileURL(join(GATES, `${id}.mjs`)).href);

function taskRepo() {
  const root = mkdtempSync(join(tmpdir(), "harness-stop-"));
  mkdirSync(join(root, ".harness", "tasks", "TASK-1"), { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\nbudgets:\n  stop_retries: 3\n");
  writeFileSync(join(root, ".harness", "current-task"), "TASK-1\n");
  writeFileSync(
    join(root, ".harness", "tasks", "TASK-1", "contract.yaml"),
    'id: TASK-1\nblast_radius:\n  - "src/**"\ncriteria:\n  - id: AC-1\n    statement: The system shall work.\n',
  );
  return root;
}

const ok = async (/** @type {string} */ verb) => ({ verb, command: `run ${verb}`, code: 0, stdout: "ok", stderr: "", timedOut: false });

/** @param {string} root @param {object} [extra] */
const stopCtx = (root, extra = {}) => ({
  event: { hook_event_name: "Stop", session_id: "s", cwd: root, ...extra },
  root,
  // Loaded rather than hand-built, so the fixture carries what the runner
  // actually passes — including budgets. A hand-built policy silently omitted
  // stop_retries, and the ceiling test passed for the wrong reason.
  policy: loadPolicy(root),
  commit: "abc1234",
});

test("Stop blocks when the bundle is missing, naming what is absent", async () => {
  const root = taskRepo();
  const g = await gate("dod");
  const r = await g.check(stopCtx(root));
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /typecheck|tests|evidence/i);
});

test("Stop passes on a complete, fresh bundle", async () => {
  const root = taskRepo();
  await captureEvidence({ root, taskId: "TASK-1", commit: "abc1234", runVerb: ok, verbs: ["typecheck", "test:affected"] });
  const g = await gate("dod");
  assert.equal((await g.check(stopCtx(root))).verdict, "pass");
});

test("Stop NEVER invokes a capture verb — zero invocations, asserted", async () => {
  // The property C3 exists for, and it can only be established by counting.
  const root = taskRepo();
  await captureEvidence({ root, taskId: "TASK-1", commit: "abc1234", runVerb: ok, verbs: ["typecheck", "test:affected"] });

  /** @type {string[]} */
  const invoked = [];
  const spy = async (/** @type {string} */ verb) => {
    invoked.push(verb);
    return { verb, command: "x", code: 0, stdout: "", stderr: "", timedOut: false };
  };

  const g = await gate("dod");
  await g.check({ ...stopCtx(root), runVerb: spy });
  assert.deepEqual(invoked, [], "the Stop gate ran a verb; every refusal now costs a full run");

  // And again on the failing path, which is where the temptation lives.
  const bare = taskRepo();
  await g.check({ ...stopCtx(bare), runVerb: spy });
  assert.deepEqual(invoked, [], "the Stop gate ran a verb while blocking");
});

test("Stop blocks a stale bundle and says which commit it was captured at", async () => {
  const root = taskRepo();
  await captureEvidence({ root, taskId: "TASK-1", commit: "old0000", runVerb: ok, verbs: ["typecheck", "test:affected"] });
  const g = await gate("dod");
  const r = await g.check(stopCtx(root));
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /old0000/);
});

test("stop_hook_active true always allows the stop", async () => {
  // M6. The platform sets this when a previous Stop hook already kept Claude
  // running. Ignoring it is how a gate grinds a session to the block cap.
  const root = taskRepo();
  const g = await gate("dod");
  const r = await g.check(stopCtx(root, { stop_hook_active: true }));
  assert.equal(r.verdict, "pass", "an incomplete bundle must still allow the stop when re-entrant");
});

test("the retry ceiling escalates deliberately rather than being killed", async () => {
  // The ceiling is 3 here and the platform's default cap is 8, so the harness
  // reaches its own limit first and says something useful, instead of the
  // session ending with a platform warning nobody can act on.
  const root = taskRepo();
  const g = await gate("dod");

  /** @type {any} */
  let last;
  for (let i = 0; i < 4; i += 1) last = await g.check(stopCtx(root));

  assert.equal(last.verdict, "block");
  assert.equal(last.escalate, true, "at the ceiling the gate must escalate, not block again");
  assert.match(last.reason, /AC-1|criteri/i, "the escalation must name what was not met");

  const escalations = JSON.parse(
    readFileSync(join(root, ".harness", "tasks", "TASK-1", "evidence", "retries.json"), "utf8"),
  );
  assert.ok(escalations.count >= 3);
  assert.ok(escalations.escalated, "the escalation must be recorded, not merely returned");
});

test("the retry counter is keyed on session and task, not global", async () => {
  const root = taskRepo();
  const g = await gate("dod");
  for (let i = 0; i < 3; i += 1) await g.check(stopCtx(root, { session_id: "session-A" }));

  const other = await g.check(stopCtx(root, { session_id: "session-B" }));
  assert.notEqual(other.escalate, true, "a different session inherited another session's retry count");
});

test("TaskCompleted refuses completion on an incomplete bundle", async () => {
  const root = taskRepo();
  const g = await gate("task-completed");
  const r = await g.check({
    event: { hook_event_name: "TaskCompleted", session_id: "s", cwd: root, task_id: "TASK-1" },
    root,
    policy: { enabled: true, mode: "enforce" },
    commit: "abc1234",
  });
  assert.equal(r.verdict, "block");
});

test("TaskCompleted accepts a complete, fresh bundle", async () => {
  const root = taskRepo();
  await captureEvidence({ root, taskId: "TASK-1", commit: "abc1234", runVerb: ok, verbs: ["typecheck", "test:affected"] });
  const g = await gate("task-completed");
  const r = await g.check({
    event: { hook_event_name: "TaskCompleted", session_id: "s", cwd: root, task_id: "TASK-1" },
    root,
    policy: { enabled: true, mode: "enforce" },
    commit: "abc1234",
  });
  assert.equal(r.verdict, "pass");
});

test("evidence capture runs at PostToolBatch, where the test run already happens", async () => {
  // C3's other half. Capture belongs where the affected-test run is already
  // occurring; anywhere else and it is a second run of the same thing.
  const root = taskRepo();
  /** @type {string[]} */
  const invoked = [];
  const spy = async (/** @type {string} */ verb) => {
    invoked.push(verb);
    return { verb, command: `run ${verb}`, code: 0, stdout: "ok", stderr: "", timedOut: false };
  };

  const g = await gate("evidence-capture");
  const r = await g.check({
    event: { hook_event_name: "PostToolBatch", session_id: "s", cwd: root },
    root,
    policy: { enabled: true, mode: "enforce" },
    commit: "abc1234",
    runVerb: spy,
  });

  assert.ok(invoked.length > 0, "capture must actually invoke verbs");
  assert.equal(r.verdict, "pass", "capture reports, it does not block");
  assert.ok(existsSync(join(root, ".harness", "tasks", "TASK-1", "evidence", "manifest.yaml")));
});
