import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { captureEvidence, readBundle, bundleProblems } from "../../src/lib/evidence.mjs";
import { parse } from "../../src/lib/yaml.mjs";

/**
 * The evidence bundle, written by the runner and never by the agent.
 *
 * This is the load-bearing distinction in the whole design (R-L4.4a). An
 * agent-authored bundle is an *attestation* — the agent saying the tests
 * passed — which collapses "evidence, not assertion" back into the assertion
 * it was meant to replace. The difference is invisible in the file: a bundle
 * the agent wrote and a bundle the runner wrote look identical.
 *
 * So provenance travels inside the bundle. Every captured output records the
 * verb that produced it, the exact command, the exit code and the commit, and
 * a bundle element with no such record is not evidence.
 */

function taskRepo() {
  const root = mkdtempSync(join(tmpdir(), "harness-evidence-"));
  mkdirSync(join(root, ".harness", "tasks", "TASK-1"), { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), "verbs:\n  typecheck:\n    command: node\n    required: true\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");
  writeFileSync(join(root, ".harness", "current-task"), "TASK-1\n");
  writeFileSync(
    join(root, ".harness", "tasks", "TASK-1", "contract.yaml"),
    'id: TASK-1\nblast_radius:\n  - "src/**"\ncriteria:\n  - id: AC-1\n    statement: The system shall work.\n',
  );
  return root;
}

test("capture writes outputs the runner produced, with the command recorded", async () => {
  const root = taskRepo();
  /** @type {string[]} */
  const invoked = [];
  const runVerb = async (/** @type {string} */ verb) => {
    invoked.push(verb);
    return { verb, command: `node --version (${verb})`, code: 0, stdout: "v22.0.0", stderr: "", timedOut: false };
  };

  await captureEvidence({ root, taskId: "TASK-1", commit: "abc1234", runVerb, verbs: ["typecheck"] });

  assert.deepEqual(invoked, ["typecheck"]);
  const bundle = /** @type {any} */ (readBundle(root, "TASK-1"));
  assert.equal(bundle.typecheck.status, "pass");
  assert.equal(bundle.typecheck.command, "node --version (typecheck)");
  assert.equal(bundle.commit, "abc1234");
  assert.ok(existsSync(join(root, ".harness", "tasks", "TASK-1", "evidence", "typecheck.txt")));
});

test("a failing verb is recorded as failing, never omitted", async () => {
  // R-F2.4: never suppress a validator's failure. An absent element and a
  // failed element look the same in a bundle that only records successes,
  // and only one of them is a reason to stop.
  const root = taskRepo();
  const runVerb = async (/** @type {string} */ verb) => ({
    verb,
    command: "tsc --noEmit",
    code: 2,
    stdout: "",
    stderr: "type error in src/x.ts",
    timedOut: false,
  });

  await captureEvidence({ root, taskId: "TASK-1", commit: "abc1234", runVerb, verbs: ["typecheck"] });
  const bundle = /** @type {any} */ (readBundle(root, "TASK-1"));
  assert.equal(bundle.typecheck.status, "fail");
  assert.match(readFileSync(join(root, ".harness", "tasks", "TASK-1", "evidence", "typecheck.txt"), "utf8"), /type error/);
});

test("mutation is recorded as absent rather than faked", async () => {
  // Phase 6 work. The bundle says so explicitly, because a missing key reads
  // as an oversight and a zero reads as a measurement.
  const root = taskRepo();
  const runVerb = async (/** @type {string} */ verb) => ({ verb, command: "x", code: 0, stdout: "", stderr: "", timedOut: false });
  await captureEvidence({ root, taskId: "TASK-1", commit: "abc1234", runVerb, verbs: ["typecheck"] });

  const bundle = /** @type {any} */ (readBundle(root, "TASK-1"));
  assert.equal(bundle.mutation.status, "unavailable");
  assert.ok(String(bundle.mutation.note).length > 0);
  assert.equal(bundle.mutation.score, null, "an unavailable mutation score must not carry a number");
});

test("the DoD check names exactly which element is missing", async () => {
  const root = taskRepo();
  const runVerb = async (/** @type {string} */ verb) => ({ verb, command: "x", code: 0, stdout: "ok", stderr: "", timedOut: false });
  await captureEvidence({ root, taskId: "TASK-1", commit: "abc1234", runVerb, verbs: ["typecheck"] });

  const problems = bundleProblems(root, "TASK-1", "abc1234");
  assert.ok(problems.length > 0, "a bundle with no test run is not complete");
  assert.match(problems.join(" "), /tests_affected|test/i);
  for (const p of problems) assert.ok(p.length > 12, `unhelpfully terse problem: ${p}`);
});

test("a complete bundle at the current commit has no problems", async () => {
  const root = taskRepo();
  const runVerb = async (/** @type {string} */ verb) => ({ verb, command: `run ${verb}`, code: 0, stdout: "ok", stderr: "", timedOut: false });
  await captureEvidence({
    root,
    taskId: "TASK-1",
    commit: "abc1234",
    runVerb,
    verbs: ["typecheck", "test:affected"],
  });
  assert.deepEqual(bundleProblems(root, "TASK-1", "abc1234"), []);
});

test("a bundle captured at a different commit is stale, and says so", async () => {
  // The freshness property. A bundle proving the tests passed three commits
  // ago is not evidence about this commit, and it is the most convincing
  // possible artefact to be wrong about.
  const root = taskRepo();
  const runVerb = async (/** @type {string} */ verb) => ({ verb, command: `run ${verb}`, code: 0, stdout: "ok", stderr: "", timedOut: false });
  await captureEvidence({ root, taskId: "TASK-1", commit: "old0000", runVerb, verbs: ["typecheck", "test:affected"] });

  const problems = bundleProblems(root, "TASK-1", "new1111");
  assert.ok(problems.length > 0);
  assert.match(problems.join(" "), /stale|commit/i);
  assert.match(problems.join(" "), /old0000/);
});

test("every captured element is traceable to a runner-invoked verb", async () => {
  const root = taskRepo();
  const runVerb = async (/** @type {string} */ verb) => ({ verb, command: `real-command-for-${verb}`, code: 0, stdout: "ok", stderr: "", timedOut: false });
  await captureEvidence({ root, taskId: "TASK-1", commit: "abc1234", runVerb, verbs: ["typecheck", "test:affected"] });

  const bundle = /** @type {any} */ (readBundle(root, "TASK-1"));
  for (const key of ["typecheck", "tests_affected"]) {
    assert.ok(bundle[key], `${key} missing`);
    assert.match(String(bundle[key].command), /real-command-for-/, `${key} has no recorded command`);
    assert.equal(typeof bundle[key].exit_code, "number", `${key} has no recorded exit code`);
    assert.equal(bundle[key].written_by, "runner", `${key} does not record who wrote it`);
  }
});

test("the bundle is valid input to the YAML subset parser", () => {
  // It is written by us and read by us, so a construct our own parser rejects
  // would be a build failure discovered at the worst possible moment.
  const root = taskRepo();
  const path = join(root, ".harness", "tasks", "TASK-1", "evidence", "manifest.yaml");
  mkdirSync(join(root, ".harness", "tasks", "TASK-1", "evidence"), { recursive: true });
  writeFileSync(path, "task: TASK-1\ncommit: abc\ntypecheck:\n  status: pass\n");
  assert.doesNotThrow(() => parse(readFileSync(path, "utf8")));
});
