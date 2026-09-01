import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { pathToFileURL } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATES = resolve(HERE, "..", "..", "src", "gates");

/**
 * The first real gates.
 *
 * Everything before this phase was machinery. These are the rules themselves,
 * and each one is written against a specific way agentic work goes wrong:
 * editing outside what was agreed, editing before there is a plan, rewriting
 * the test until it passes, and declaring completion with nothing behind it.
 */

/** @param {string} id */
async function gate(id) {
  return await import(pathToFileURL(join(GATES, `${id}.mjs`)).href);
}

/** @param {{ blastRadius?: string[], plan?: boolean, override?: boolean }} [opts] */
function repo(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "harness-gates-"));
  const task = join(root, ".harness", "tasks", "TASK-1");
  mkdirSync(task, { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");
  writeFileSync(join(root, ".harness", "current-task"), "TASK-1\n");

  const radius = opts.blastRadius ?? ["src/**", "tests/**"];
  writeFileSync(
    join(task, "contract.yaml"),
    [
      "id: TASK-1",
      "intent: a sample task",
      "blast_radius:",
      ...radius.map((p) => `  - ${JSON.stringify(p)}`),
      "criteria:",
      "  - id: AC-1",
      "    statement: The system shall work.",
      "overrides:",
      `  test_edit: ${opts.override === true}`,
    ].join("\n") + "\n",
  );
  if (opts.plan === true) writeFileSync(join(task, "plan.md"), "# Plan\n\nDo the thing.\n");
  return root;
}

/** @param {string} root @param {string} path @param {object} [extra] */
const write = (root, path, extra = {}) => ({
  event: { hook_event_name: "PreToolUse", session_id: "s", cwd: root, tool_name: "Write", tool_input: { file_path: path }, ...extra },
  root,
  policy: { enabled: true, mode: "enforce" },
  events: [],
});

/* ---------- blast radius ---------- */

test("blast-radius denies a write outside the declared paths and names the contract", async () => {
  const root = repo();
  const g = await gate("blast-radius");
  const r = await g.check(write(root, join(root, "infra", "terraform.tf")));
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /contract\.yaml|TASK-1/, "the refusal must name the contract it is enforcing");
  assert.match(r.reason, /blast radius/i);
});

test("blast-radius permits a write inside the declared paths", async () => {
  const root = repo();
  const g = await gate("blast-radius");
  assert.equal((await g.check(write(root, join(root, "src", "thing.ts")))).verdict, "pass");
});

test("blast-radius permits plan.md and handoff.md for the active task", async () => {
  // R-L0.4. Task artefacts are written during normal work; protecting the
  // whole tree would block the agent from its own plan.
  const root = repo();
  const g = await gate("blast-radius");
  for (const file of ["plan.md", "handoff.md"]) {
    const path = join(root, ".harness", "tasks", "TASK-1", file);
    assert.equal((await g.check(write(root, path))).verdict, "pass", `${file} must stay writable`);
  }
});

test("blast-radius denies the agent any write to evidence/", async () => {
  // R-L4.4a, and the reason the bundle is worth anything. An agent-authored
  // bundle is an attestation wearing evidence's clothes.
  const root = repo();
  const g = await gate("blast-radius");
  const path = join(root, ".harness", "tasks", "TASK-1", "evidence", "tests.txt");
  const r = await g.check(write(root, path));
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /evidence/i);
  assert.match(r.reason, /runner/i, "the reason must say who does write it");
});

test("blast-radius is dormant when there is no active task", async () => {
  // No contract means nothing to enforce against. Blocking every write in
  // that state would make the harness unusable outside a task.
  const root = repo();
  writeFileSync(join(root, ".harness", "current-task"), "\n");
  const g = await gate("blast-radius");
  assert.equal((await g.check(write(root, join(root, "anywhere.ts")))).verdict, "skip");
});

/* ---------- plan first ---------- */

test("plan-first denies an edit when the active task has no plan", async () => {
  const root = repo({ plan: false });
  const g = await gate("plan-first");
  const r = await g.check(write(root, join(root, "src", "x.ts")));
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /plan\.md/, "the refusal must name the missing artefact");
});

test("plan-first permits the edit once a plan exists", async () => {
  const root = repo({ plan: true });
  const g = await gate("plan-first");
  assert.equal((await g.check(write(root, join(root, "src", "x.ts")))).verdict, "pass");
});

test("plan-first does not block writing the plan itself", async () => {
  // Otherwise the only way to satisfy the gate is blocked by the gate.
  const root = repo({ plan: false });
  const g = await gate("plan-first");
  const path = join(root, ".harness", "tasks", "TASK-1", "plan.md");
  assert.equal((await g.check(write(root, path))).verdict, "pass");
});

/* ---------- test tampering, ordering-based ---------- */

const editEvent = (/** @type {string} */ path, /** @type {string} */ task) => ({
  event: "PreToolUse",
  tool: "Edit",
  target: path,
  task,
  verdict: "pass",
});

test("tamper gate permits writing a test before any implementation edit", async () => {
  // Red-green requires the test to be authored in this task. A same-task
  // prohibition would forbid the practice it is meant to protect.
  const root = repo({ plan: true });
  const g = await gate("test-tampering");
  const ctx = { ...write(root, join(root, "tests", "thing.test.ts")), events: [] };
  assert.equal((await g.check(ctx)).verdict, "pass");
});

test("tamper gate denies a test edit after the first implementation edit", async () => {
  const root = repo({ plan: true });
  const g = await gate("test-tampering");
  const ctx = {
    ...write(root, join(root, "tests", "thing.test.ts")),
    events: [editEvent(join(root, "src", "thing.ts"), "TASK-1")],
  };
  const r = await g.check(ctx);
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /implementation/i);
  assert.match(r.reason, /thing\.ts/, "the refusal must name the edit that closed the window");
});

test("an implementation edit in a DIFFERENT task does not close the window", async () => {
  // The counter to the obvious over-broad implementation: ordering is scoped
  // to the task, or the second task of the day can never author a test.
  const root = repo({ plan: true });
  const g = await gate("test-tampering");
  const ctx = {
    ...write(root, join(root, "tests", "thing.test.ts")),
    events: [editEvent(join(root, "src", "thing.ts"), "TASK-0")],
  };
  assert.equal((await g.check(ctx)).verdict, "pass");
});

test("the contract override reopens the window, and the reason records it", async () => {
  const root = repo({ plan: true, override: true });
  const g = await gate("test-tampering");
  const ctx = {
    ...write(root, join(root, "tests", "thing.test.ts")),
    events: [editEvent(join(root, "src", "thing.ts"), "TASK-1")],
  };
  const r = await g.check(ctx);
  assert.equal(r.verdict, "warn");
  assert.match(r.message, /override/i);
});

test("tamper gate ignores non-test files entirely", async () => {
  const root = repo({ plan: true });
  const g = await gate("test-tampering");
  const ctx = {
    ...write(root, join(root, "src", "other.ts")),
    events: [editEvent(join(root, "src", "thing.ts"), "TASK-1")],
  };
  assert.equal((await g.check(ctx)).verdict, "pass");
});

/* ---------- task lifecycle ---------- */

test("TaskCreated rejects a task with no contract", async () => {
  const root = repo();
  const g = await gate("task-created");
  const ctx = {
    event: { hook_event_name: "TaskCreated", session_id: "s", cwd: root, task_id: "TASK-NEW" },
    root,
    policy: { enabled: true, mode: "enforce" },
  };
  const r = await g.check(ctx);
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /contract/i);
  assert.match(r.reason, /TASK-NEW/);
});

test("TaskCreated accepts a task whose contract validates", async () => {
  const root = repo();
  const g = await gate("task-created");
  const ctx = {
    event: { hook_event_name: "TaskCreated", session_id: "s", cwd: root, task_id: "TASK-1" },
    root,
    policy: { enabled: true, mode: "enforce" },
  };
  assert.equal((await g.check(ctx)).verdict, "pass");
});

test("TaskCreated rejects a contract whose criteria are not EARS-shaped", async () => {
  const root = repo();
  writeFileSync(
    join(root, ".harness", "tasks", "TASK-1", "contract.yaml"),
    'id: TASK-1\nblast_radius:\n  - "src/**"\ncriteria:\n  - id: AC-1\n    statement: make it fast\n',
  );
  const g = await gate("task-created");
  const ctx = {
    event: { hook_event_name: "TaskCreated", session_id: "s", cwd: root, task_id: "TASK-1" },
    root,
    policy: { enabled: true, mode: "enforce" },
  };
  const r = await g.check(ctx);
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /AC-1/);
});
