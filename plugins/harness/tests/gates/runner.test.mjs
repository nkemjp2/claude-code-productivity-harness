import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, "..", "..", "src", "runner.mjs");
const FIXTURE_GATES = resolve(HERE, "..", "fixtures", "gates");

/**
 * The runner as a process, which is the only way these properties are real.
 *
 * A unit test can assert that a mapping function returns 2. It cannot assert
 * that the process exits 2, that stdout carried exactly one JSON object, or
 * that nothing was written when the harness is dormant — and those are the
 * properties the client actually observes.
 */

/** A repository with the harness installed. */
function initialisedRepo() {
  const dir = mkdtempSync(join(tmpdir(), "harness-repo-"));
  mkdirSync(join(dir, ".harness"), { recursive: true });
  writeFileSync(join(dir, ".harness", "manifest.yaml"), "verbs:\n  typecheck:\n    command: true\n    required: false\n");
  writeFileSync(join(dir, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");
  return dir;
}

/** A repository that never opted in. */
function bareRepo() {
  return mkdtempSync(join(tmpdir(), "harness-bare-"));
}

/**
 * @param {string} gateId
 * @param {object} event
 * @param {{ cwd?: string, env?: Record<string,string>, input?: string }} [opts]
 */
function runGate(gateId, event, opts = {}) {
  const cwd = opts.cwd ?? process.cwd();
  const result = spawnSync(process.execPath, [RUNNER, gateId], {
    input: opts.input ?? JSON.stringify(event),
    encoding: "utf8",
    cwd,
    env: {
      ...process.env,
      HARNESS_GATE_ROOT: FIXTURE_GATES,
      CLAUDE_PROJECT_DIR: cwd,
      ...(opts.env ?? {}),
    },
  });
  return { status: result.status, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

/** @param {string} root */
function eventRecords(root) {
  const dir = join(root, ".harness", "events");
  if (!existsSync(dir)) return [];
  /** @type {any[]} */
  const out = [];
  for (const f of readdirSync(dir)) {
    for (const line of readFileSync(join(dir, f), "utf8").split("\n")) {
      if (line.trim() !== "") out.push(JSON.parse(line));
    }
  }
  return out;
}

/** @param {string} cwd */
const preToolUse = (cwd) => ({
  hook_event_name: "PreToolUse",
  session_id: "sess-1",
  cwd,
  tool_name: "Edit",
  tool_input: { file_path: "/tmp/x.ts" },
});

test("a passing gate exits 0 and prints nothing", () => {
  const repo = initialisedRepo();
  const r = runGate("pass", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("a blocking gate exits 2 and prints exactly one JSON object", () => {
  const repo = initialisedRepo();
  const r = runGate("block", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 2);
  const parsed = JSON.parse(r.stdout);
  assert.equal(parsed.hookSpecificOutput.permissionDecision, "deny");
  assert.match(parsed.hookSpecificOutput.permissionDecisionReason, /blast radius/);
});

test("a gate that writes diagnostics does not corrupt stdout", () => {
  // The single-writer rule, observed rather than asserted. Diagnostics belong
  // on stderr; one stray byte on stdout and the client cannot parse the
  // decision — the same failure an echo in .bashrc causes with shell-form
  // handlers, which is why every handler is exec form.
  const repo = initialisedRepo();
  const r = runGate("noisy", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 2);
  assert.doesNotThrow(() => JSON.parse(r.stdout), "stdout was not exactly one JSON object");
  assert.match(r.stderr, /diagnostics/);
});

test("a shell profile that prints cannot reach stdout", () => {
  // Handlers spawn node directly, so no profile is ever sourced. BASH_ENV is
  // set to a script that echoes; if a shell were involved, this output would
  // prepend the JSON and break the parse.
  const repo = initialisedRepo();
  const noisyProfile = join(repo, "noisy-profile.sh");
  writeFileSync(noisyProfile, 'echo "PROFILE NOISE"\n');
  const r = runGate("block", preToolUse(repo), { cwd: repo, env: { BASH_ENV: noisyProfile, ENV: noisyProfile } });
  assert.equal(r.status, 2);
  assert.doesNotThrow(() => JSON.parse(r.stdout));
  assert.ok(!r.stdout.includes("PROFILE NOISE"));
});

test("malformed JSON exits 0", () => {
  // The client sent something unusable. There is no event to act on, and
  // blocking every tool call because one payload was garbled would be worse
  // than the problem.
  const repo = initialisedRepo();
  const r = runGate("block", {}, { cwd: repo, input: "{not json at all" });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("a truncated read on a failClosed gate exits 2", () => {
  // Distinct from malformed JSON: the gate never saw its input at all. The
  // gate id arrives in argv, so failClosed is knowable without parsing stdin.
  const repo = initialisedRepo();
  const r = runGate("block", {}, { cwd: repo, input: "", env: { HARNESS_SIMULATE_READ_FAILURE: "1" } });
  assert.equal(r.status, 2);
  assert.match(r.stderr + r.stdout, /read/i);
});

test("a truncated read in a repo with no manifest still exits 0 (ADR-0009)", () => {
  // The ordering that matters. Fail-closed must not fire where the harness was
  // never installed, or a user-scope install changes behaviour in every repo
  // on the machine — which is exactly what M11 forbids.
  const repo = bareRepo();
  const r = runGate("block", {}, { cwd: repo, input: "", env: { HARNESS_SIMULATE_READ_FAILURE: "1" } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("no manifest means exit 0, no stdout, and no event record", () => {
  const repo = bareRepo();
  const r = runGate("block", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
  assert.deepEqual(eventRecords(repo), [], "a dormant exit must write nothing (R-M1.1)");
  assert.equal(existsSync(join(repo, ".harness")), false, "dormancy must not create .harness");
});

test("HARNESS_DISABLE=1 exits 0 even in an initialised repo", () => {
  const repo = initialisedRepo();
  const r = runGate("block", preToolUse(repo), { cwd: repo, env: { HARNESS_DISABLE: "1" } });
  assert.equal(r.status, 0);
  assert.equal(r.stdout, "");
});

test("observe mode downgrades a block to a logged warn", () => {
  const repo = initialisedRepo();
  writeFileSync(join(repo, ".harness", "policy.yaml"), "enabled: true\nmode: observe\n");
  const r = runGate("block", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 0, "observe mode must never block");
  const records = eventRecords(repo);
  assert.equal(records.at(-1)?.verdict, "warn");
  assert.equal(records.at(-1)?.downgraded_from, "block");
});

test("policy.enabled false is a kill switch", () => {
  const repo = initialisedRepo();
  writeFileSync(join(repo, ".harness", "policy.yaml"), "enabled: false\nmode: enforce\n");
  const r = runGate("block", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 0);
});

test("a gate above the client version is skipped, never an error", () => {
  const repo = initialisedRepo();
  const r = runGate("future", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 0, "a newer gate on an older client must skip, not fail");
  const records = eventRecords(repo);
  assert.equal(records.at(-1)?.verdict, "skip");
});

test("the watchdog fires on a blocking gate and names the timeout", () => {
  // M5: a timed-out PreToolUse command hook does NOT block the tool call, so a
  // stalled gate silently fails open. The internal watchdog turns that into a
  // deterministic block before the platform gets the chance.
  const repo = initialisedRepo();
  const r = runGate("slow", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 2);
  assert.match(r.stdout + r.stderr, /timed out|timeout|exceeded/i);
});

test("a throwing gate exits 2 when failClosed", () => {
  const repo = initialisedRepo();
  const r = runGate("throws-failclosed", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 2);
});

test("a throwing gate exits 0 with a systemMessage when not failClosed", () => {
  const repo = initialisedRepo();
  const r = runGate("throws-failopen", preToolUse(repo), { cwd: repo });
  assert.equal(r.status, 0);
  const parsed = JSON.parse(r.stdout);
  assert.match(parsed.systemMessage, /exploded|error/i);
});

test("one event record is written for every outcome past the dormancy check", () => {
  const repo = initialisedRepo();
  for (const gate of ["pass", "skip", "warn", "block"]) {
    runGate(gate, preToolUse(repo), { cwd: repo });
  }
  const records = eventRecords(repo);
  assert.equal(records.length, 4);
  for (const r of records) {
    assert.ok(r.ts && r.session_id && r.event && r.gate && r.verdict, `incomplete record: ${JSON.stringify(r)}`);
    assert.equal(typeof r.duration_ms, "number");
    assert.ok(r.harness_version, "every record carries the harness version (R-G1.3)");
  }
});

test("the repo root resolves to the worktree, not the session root", () => {
  // M9. CLAUDE_PROJECT_DIR stays where the session started; cwd follows the
  // agent into the worktree. A gate reading the wrong one judges the wrong
  // tree, and it does so silently.
  const main = initialisedRepo();
  /** @param {string[]} args @param {string} cwd */
  const git = (args, cwd) => execFileSync("git", args, { cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
  git(["init", "-q", "-b", "main"], main);
  git(["config", "user.email", "t@example.com"], main);
  git(["config", "user.name", "t"], main);
  git(["add", "-A"], main);
  git(["commit", "-qm", "init"], main);

  const wt = join(mkdtempSync(join(tmpdir(), "harness-wt-")), "feature");
  git(["worktree", "add", "-q", "-b", "feature", wt], main);

  assert.ok(existsSync(join(wt, ".harness", "manifest.yaml")), "worktree should carry the tracked manifest");

  const r = runGate("block", preToolUse(wt), { cwd: wt, env: { CLAUDE_PROJECT_DIR: main } });
  assert.equal(r.status, 2);

  const inWorktree = eventRecords(wt);
  assert.equal(inWorktree.length, 1, "the record belongs to the worktree the agent is in");
});
