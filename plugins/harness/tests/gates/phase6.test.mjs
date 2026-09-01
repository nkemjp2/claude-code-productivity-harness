import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertionDensity } from "../../src/lib/assertions.mjs";
import { judgeMutation, readRatchet, writeRatchet } from "../../src/lib/mutation.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATES = resolve(HERE, "..", "..", "src", "gates");
const gate = async (/** @type {string} */ id) => await import(pathToFileURL(join(GATES, `${id}.mjs`)).href);

/**
 * Phase 6: assertion integrity — the layer nothing else in the stack covers.
 *
 * A bad assertion looks exactly like a test. That is why diff reviewers are
 * weak here and why coverage is a floor rather than a signal: a test that
 * executes a line and asserts nothing about it raises coverage and proves
 * nothing at all.
 */

function repo() {
  const root = mkdtempSync(join(tmpdir(), "harness-p6-"));
  mkdirSync(join(root, ".harness", "tasks", "TASK-1"), { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");
  writeFileSync(join(root, ".harness", "current-task"), "TASK-1\n");
  writeFileSync(
    join(root, ".harness", "tasks", "TASK-1", "contract.yaml"),
    'id: TASK-1\nblast_radius:\n  - "src/**"\n  - "tests/**"\ncriteria:\n  - id: AC-1\n    statement: The system shall work.\n',
  );
  writeFileSync(join(root, ".harness", "tasks", "TASK-1", "plan.md"), "# Plan\n");
  return root;
}

/* ---------- assertion density (R-L5.6) ---------- */

test("a test body with no assertion is rejected", () => {
  const src = `
    test("does a thing", () => {
      doTheThing();
    });
  `;
  const r = assertionDensity(src);
  assert.equal(r.tests, 1);
  assert.equal(r.withoutAssertions.length, 1);
  const name = r.withoutAssertions[0];
  assert.ok(name);
  assert.match(name, /does a thing/);
});

test("a test that asserts is accepted", () => {
  const src = `
    test("does a thing", () => {
      assert.equal(doTheThing(), 42);
    });
  `;
  assert.deepEqual(assertionDensity(src).withoutAssertions, []);
});

test("expect-style assertions count too", () => {
  const src = `it("works", () => { expect(value()).toBe(3); });`;
  assert.deepEqual(assertionDensity(src).withoutAssertions, []);
});

test("a test whose only assertion is on a mock call is flagged as wiring-only", () => {
  // The pattern worth catching before the mutation ratchet ever runs: it
  // asserts the code called what it was told to call, and nothing about what
  // the code actually does.
  const src = `
    test("saves the record", () => {
      save(record);
      expect(db.insert).toHaveBeenCalledWith(record);
    });
  `;
  const r = assertionDensity(src);
  assert.equal(r.wiringOnly.length, 1, "a mock-call-only assertion is not a behavioural assertion");
});

test("the gate blocks a test file with an assertion-free test", async () => {
  const root = repo();
  const g = await gate("assertion-density");
  const r = await g.check({
    event: {
      hook_event_name: "PreToolUse", session_id: "s", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, "tests", "a.test.ts"), content: 'test("x", () => { run(); });' },
    },
    root,
    policy: { enabled: true, mode: "enforce" },
  });
  assert.equal(r.verdict, "block");
  assert.match(String(r.reason), /assert/i);
});

test("the gate ignores non-test files", async () => {
  const root = repo();
  const g = await gate("assertion-density");
  const r = await g.check({
    event: {
      hook_event_name: "PreToolUse", session_id: "s", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, "src", "a.ts"), content: "export const x = 1;" },
    },
    root,
    policy: { enabled: true, mode: "enforce" },
  });
  assert.equal(r.verdict, "pass");
});

/* ---------- mutation ratchet (R-L5.1) ---------- */

test("a ratchet can only tighten", () => {
  const root = repo();
  writeRatchet(root, "mutation_score", 62);
  writeRatchet(root, "mutation_score", 55);
  assert.equal(readRatchet(root, "mutation_score"), 62, "a ratchet that loosens is not a ratchet");
});

test("a score below the ratchet blocks and names both numbers", () => {
  const r = judgeMutation({ score: 48, ratchet: 62 });
  assert.equal(r.verdict, "block");
  assert.match(String(r.reason), /48/);
  assert.match(String(r.reason), /62/);
});

test("a score at or above the ratchet passes, and proposes the new floor", () => {
  const r = judgeMutation({ score: 71, ratchet: 62 });
  assert.equal(r.verdict, "pass");
  assert.equal(r.newRatchet, 71);
});

test("no ratchet yet means the first measurement sets the baseline, never blocks", () => {
  // Initialising at a target would fire on day one against a standard the
  // repository has never met, and the credible response is to switch it off.
  const r = judgeMutation({ score: 41, ratchet: null });
  assert.equal(r.verdict, "pass");
  assert.equal(r.newRatchet, 41);
  assert.match(String(r.note), /baseline/i);
});

test("an unavailable score does not silently pass", () => {
  const r = judgeMutation({ score: null, ratchet: 62 });
  assert.equal(r.verdict, "error");
  assert.match(String(r.reason), /no mutation score/i);
});

/* ---------- fork and role provenance (M7, R-L5.2) ---------- */

test("SessionStart records the session source, including fork", async () => {
  // The discriminator M7 asked for, and said to verify before planning this
  // phase: SessionStart carries source ∈ startup|resume|clear|compact|fork.
  const root = repo();
  const g = await gate("session-provenance");
  const r = await g.check({
    event: { hook_event_name: "SessionStart", session_id: "s1", cwd: root, source: "fork" },
    root,
    policy: { enabled: true, mode: "enforce" },
  });
  assert.equal(r.verdict, "pass", "SessionStart cannot block; it records");
  assert.equal(r.record.session_source, "fork");
});

test("a test authored in a FORKED session is refused", async () => {
  // The threat M7 describes precisely: a fork inherits the whole conversation,
  // so a "test-author" reached by fork has already seen the implementation.
  // agent_type names the role, not the isolation mode — so the role check
  // alone returns pass for exactly this attack.
  const root = repo();
  const g = await gate("authoring-provenance");
  const r = await g.check({
    event: {
      hook_event_name: "PreToolUse", session_id: "s1", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, "tests", "a.test.ts") }, agent_type: "test-author",
    },
    root,
    policy: { enabled: true, mode: "enforce" },
    events: [{ event: "SessionStart", session_id: "s1", session_source: "fork" }],
  });
  assert.equal(r.verdict, "block");
  assert.match(String(r.reason), /fork/i);
});

test("a test authored by the implementer role is refused", async () => {
  const root = repo();
  const g = await gate("authoring-provenance");
  const r = await g.check({
    event: {
      hook_event_name: "PreToolUse", session_id: "s1", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, "tests", "a.test.ts") }, agent_type: "implementer",
    },
    root,
    policy: { enabled: true, mode: "enforce" },
    events: [{ event: "SessionStart", session_id: "s1", session_source: "startup" }],
  });
  assert.equal(r.verdict, "block");
  assert.match(String(r.reason), /implementer/i);
});

test("a test authored by the test-author in a clean session passes", async () => {
  const root = repo();
  const g = await gate("authoring-provenance");
  const r = await g.check({
    event: {
      hook_event_name: "PreToolUse", session_id: "s1", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, "tests", "a.test.ts") }, agent_type: "test-author",
    },
    root,
    policy: { enabled: true, mode: "enforce" },
    events: [{ event: "SessionStart", session_id: "s1", session_source: "startup" }],
  });
  assert.equal(r.verdict, "pass");
});

test("provenance says what it cannot see when the session source is unknown", async () => {
  // Honest degradation. Without a recorded SessionStart there is no way to
  // know whether this session is a fork, and claiming otherwise would be the
  // overclaim M7 caught in the previous revision of the spec.
  const root = repo();
  const g = await gate("authoring-provenance");
  const r = await g.check({
    event: {
      hook_event_name: "PreToolUse", session_id: "unknown-session", cwd: root, tool_name: "Write",
      tool_input: { file_path: join(root, "tests", "a.test.ts") }, agent_type: "test-author",
    },
    root,
    policy: { enabled: true, mode: "enforce" },
    events: [],
  });
  assert.equal(r.verdict, "warn");
  assert.match(String(r.message), /unknown|not recorded/i);
});
