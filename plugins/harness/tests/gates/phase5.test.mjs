import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname, isAbsolute } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { loadAdapter, AdapterRefused } from "../../src/lib/adapter.mjs";
import { checkLicences } from "../../src/lib/licence.mjs";
import { discoverCandidates, probe } from "../../src/lib/probe.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const GATES = resolve(HERE, "..", "..", "src", "gates");
const gate = async (/** @type {string} */ id) => await import(pathToFileURL(join(GATES, `${id}.mjs`)).href);

/**
 * Phase 5: the inner loop, the adapter boundary, and licence enforcement.
 *
 * The inner loop is the highest-yield layer per unit of effort, because
 * feedback at the edit reaches the agent while the edit is still in working
 * context. Feedback at CI arrives minutes later, to nobody.
 */

function repo(/** @type {{ verbs?: string }} */ opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "harness-p5-"));
  mkdirSync(join(root, ".harness", "tasks", "TASK-1"), { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), opts.verbs ?? "verbs: {}\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");
  writeFileSync(join(root, ".harness", "current-task"), "TASK-1\n");
  writeFileSync(
    join(root, ".harness", "tasks", "TASK-1", "contract.yaml"),
    'id: TASK-1\nblast_radius:\n  - "src/**"\ncriteria:\n  - id: AC-1\n    statement: The system shall work.\n',
  );
  writeFileSync(join(root, ".harness", "tasks", "TASK-1", "plan.md"), "# Plan\n");
  return root;
}

/* ---------- per-edit validation (L3.1) ---------- */

test("per-edit check surfaces a typecheck failure on the very next turn", async () => {
  // PostToolUse cannot undo the tool, but exit 2 surfaces stderr to Claude —
  // a compiler-grade signal while the edit is still in working context.
  const root = repo({ verbs: "verbs:\n  typecheck:\n    command: node\n    required: false\n" });
  const g = await gate("per-edit-check");
  const r = await g.check({
    event: { hook_event_name: "PostToolUse", session_id: "s", cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "src", "x.ts") } },
    root,
    policy: { enabled: true, mode: "enforce" },
    manifest: { verbs: { typecheck: { command: "node", required: false } } },
    runVerb: async (/** @type {string} */ v) => ({ verb: v, command: "tsc", code: 2, stdout: "", stderr: "src/x.ts(3,1): error TS2304", timedOut: false }),
  });
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /TS2304/, "the compiler's own message is the whole value; it must survive");
});

test("per-edit check passes a clean file without comment", async () => {
  const root = repo();
  const g = await gate("per-edit-check");
  const r = await g.check({
    event: { hook_event_name: "PostToolUse", session_id: "s", cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "src", "x.ts") } },
    root,
    policy: { enabled: true, mode: "enforce" },
    manifest: { verbs: { typecheck: { command: "node", required: false } } },
    runVerb: async (/** @type {string} */ v) => ({ verb: v, command: "tsc", code: 0, stdout: "", stderr: "", timedOut: false }),
  });
  assert.equal(r.verdict, "pass");
});

test("a missing OPTIONAL verb degrades to skip, so work continues", async () => {
  // M13. The alternative is a harness that blocks every edit on a machine
  // where one tool is not installed.
  const root = repo();
  const g = await gate("per-edit-check");
  const r = await g.check({
    event: { hook_event_name: "PostToolUse", session_id: "s", cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "src", "x.ts") } },
    root,
    policy: { enabled: true, mode: "enforce" },
    manifest: { verbs: {} },
    runVerb: async (/** @type {string} */ v) => ({ verb: v, command: "x", code: 127, stdout: "", stderr: "not configured", timedOut: false }),
  });
  assert.equal(r.verdict, "skip");
  assert.match(String(r.why), /not configured|typecheck/i);
});

test("a missing REQUIRED verb is an error, never a silent skip", async () => {
  // R-F2.4 forbids the opposite: a typechecker that quietly skips is the
  // silently disabled gate this whole design exists to prevent.
  const root = repo();
  const g = await gate("per-edit-check");
  const r = await g.check({
    event: { hook_event_name: "PostToolUse", session_id: "s", cwd: root, tool_name: "Edit", tool_input: { file_path: join(root, "src", "x.ts") } },
    root,
    policy: { enabled: true, mode: "enforce" },
    manifest: { verbs: { typecheck: { command: "nope", required: true } } },
    runVerb: async (/** @type {string} */ v) => ({ verb: v, command: "nope", code: 127, stdout: "", stderr: "command not found", timedOut: false }),
  });
  assert.equal(r.verdict, "error");
});

/* ---------- per-batch diff lint (L3.2) ---------- */

test("per-batch lint halts the loop before the next model call", async () => {
  const root = repo();
  const g = await gate("per-batch-lint");
  const r = await g.check({
    event: { hook_event_name: "PostToolBatch", session_id: "s", cwd: root },
    root,
    policy: { enabled: true, mode: "enforce" },
    manifest: { verbs: { "lint:diff": { command: "eslint", required: false } } },
    runVerb: async (/** @type {string} */ v) => ({ verb: v, command: "eslint --diff", code: 1, stdout: "src/x.ts:3 no-unused-vars", stderr: "", timedOut: false }),
  });
  assert.equal(r.verdict, "block");
  assert.match(r.reason, /no-unused-vars/);
});

/* ---------- adapters (M25) ---------- */

test("an adapter declaring an out-of-range upstream is refused at load", async () => {
  await assert.rejects(
    () => loadAdapter({ id: "x", upstream: { name: "tool", versions: ">=2.0 <3.0" }, licence: "MIT", invoke: "process", parse: () => ({ verdict: "pass" }) }, "1.4.0"),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.ok(err instanceof AdapterRefused);
      assert.match(err.message, /1\.4\.0/);
      assert.match(err.message, />=2\.0/);
      return true;
    },
  );
});

test("an adapter with a non-allowlisted licence is refused", async () => {
  await assert.rejects(
    () => loadAdapter({ id: "x", upstream: { name: "tool", versions: ">=1.0 <2.0" }, licence: "GPL-3.0", invoke: "process", parse: () => ({ verdict: "pass" }) }, "1.4.0"),
    /licence|GPL/i,
  );
});

test("an adapter that imports rather than spawning is refused", async () => {
  // M24. Crossing a process boundary is what keeps an upstream licence out of
  // this plugin's own source.
  await assert.rejects(
    () => loadAdapter({ id: "x", upstream: { name: "tool", versions: ">=1.0 <2.0" }, licence: "MIT", invoke: "import", parse: () => ({ verdict: "pass" }) }, "1.4.0"),
    /process boundary|invoke/i,
  );
});

test("an in-range, permissively licensed adapter loads", async () => {
  const a = await loadAdapter(
    { id: "x", upstream: { name: "tool", versions: ">=1.0 <2.0" }, licence: "MIT", invoke: "process", parse: () => ({ verdict: "pass" }) },
    "1.4.0",
  );
  assert.equal(a.id, "x");
});

/* ---------- licence enforcement (M24, R-L6.3) ---------- */

test("a copyleft dependency fails the licence check", () => {
  const problems = checkLicences(
    { dependencies: { "a-tool": "GPL-3.0-only" } },
    { allowed: ["MIT"], deniedFamilies: ["GPL"], vendoredPaths: [] },
  );
  assert.equal(problems.length, 1);
  const first = problems[0];
  assert.ok(first);
  assert.match(first, /a-tool/);
  assert.match(first, /GPL/);
});

test("an unknown licence fails rather than passing by default", () => {
  // The direction that matters. An unrecognised licence defaulting to allowed
  // is how copyleft reaches a plugin installed across every repository.
  const problems = checkLicences(
    { dependencies: { "a-tool": "SOME-NEW-LICENCE" } },
    { allowed: ["MIT"], deniedFamilies: ["GPL"], vendoredPaths: [] },
  );
  assert.equal(problems.length, 1);
  const only = problems[0];
  assert.ok(only);
  assert.match(only, /not on the allowlist|unknown/i);
});

test("allowlisted licences pass", () => {
  assert.deepEqual(
    checkLicences({ dependencies: { a: "MIT", b: "Apache-2.0" } }, { allowed: ["MIT", "Apache-2.0"], deniedFamilies: ["GPL"], vendoredPaths: [] }),
    [],
  );
});

/* ---------- probe reaches node_modules/.bin (the Phase 4 finding) ---------- */

test("probe resolves a tool in node_modules/.bin, not just PATH", () => {
  // Found by running init against this repository: tsc lives in
  // node_modules/.bin, so every JS repo reported its typechecker unresolvable.
  const root = mkdtempSync(join(tmpdir(), "harness-bin-"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  const bin = join(root, "node_modules", ".bin", "faketool");
  writeFileSync(bin, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { typecheck: "faketool --noEmit" } }));

  const candidates = discoverCandidates(root);
  const candidate = candidates.find((c) => c.verb === "typecheck");
  assert.ok(candidate, "typecheck should be a candidate");
  const result = probe(candidate, root);
  assert.notEqual(result.resolved, null, "a local bin must resolve");
  assert.match(String(result.resolved), /node_modules/);
});

test("a local bin resolves to an absolute path, never the bare shim name", () => {
  // M10. On Windows those entries are .cmd shims, which are not real
  // executables and cannot be spawned in exec form. Recording the resolved
  // path rather than the name is what keeps the spawn honest.
  const root = mkdtempSync(join(tmpdir(), "harness-bin2-"));
  mkdirSync(join(root, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(root, "node_modules", ".bin", "faketool"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  writeFileSync(join(root, "package.json"), JSON.stringify({ scripts: { lint: "faketool ." } }));

  const c = discoverCandidates(root).find((x) => x.verb === "lint");
  assert.ok(c);
  const r = probe(c, root);
  // isAbsolute, not startsWith("/"). The first version of this assertion was
  // Unix-centric and failed on Windows, where an absolute path is D:\… — in
  // the very test written to keep the Windows shim trap closed. The
  // implementation was right; the assertion was parochial.
  assert.ok(isAbsolute(String(r.resolved)), `expected an absolute path, got ${r.resolved}`);
});

/* ---------- CI-workflow discovery, found by adopting a real repository ---------- */

test("a workflow flag containing a verb name is not a verb", () => {
  // Found by running init against a real repository. The line
  //   run: pnpm exec playwright install --with-deps
  // matched the `deps` script name and wired deps:check to a BROWSER INSTALL —
  // a minutes-long, network-bound, side-effecting command mapped to a checking
  // verb. Worse than no verb at all.
  const root = mkdtempSync(join(tmpdir(), "harness-ci-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  e2e:\n    steps:\n      - run: pnpm exec playwright install --with-deps\n",
  );

  const candidates = discoverCandidates(root);
  assert.deepEqual(candidates, [], "a flag that merely contains a verb name is not a verb");

  // And the `- run:` list form is genuinely parsed, so the assertion above is
  // not passing simply because nothing was read. The first version of this
  // test did exactly that.
  writeFileSync(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  e2e:\n    steps:\n      - run: pnpm lint\n",
  );
  assert.deepEqual(discoverCandidates(root).map((c) => c.verb), ["lint"]);
});

test("a workflow line that DOES invoke a named script is discovered", () => {
  // The counterpart. CI config is the closest thing to ground truth about a
  // repository's commands, so narrowing must not throw that away.
  const root = mkdtempSync(join(tmpdir(), "harness-ci2-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  ci:\n    steps:\n      - run: npm run typecheck\n      - run: pnpm lint\n",
  );

  const verbs = discoverCandidates(root).map((c) => c.verb).sort();
  assert.deepEqual(verbs, ["lint", "typecheck"]);
});

test("a bare tool invocation in CI is not mistaken for a script", () => {
  const root = mkdtempSync(join(tmpdir(), "harness-ci3-"));
  mkdirSync(join(root, ".github", "workflows"), { recursive: true });
  writeFileSync(
    join(root, ".github", "workflows", "ci.yml"),
    "jobs:\n  ci:\n    steps:\n      - run: docker build --build-arg test=1 .\n",
  );
  assert.deepEqual(discoverCandidates(root), []);
});
