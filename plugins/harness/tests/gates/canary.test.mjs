import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runCanaries } from "../../src/canary.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "..", "..", "src");
const FIX = resolve(HERE, "..", "fixtures", "registry");
const RUNNER = join(SRC, "runner.mjs");
const FIXTURE_GATES = resolve(HERE, "..", "fixtures", "gates");

/**
 * The canary suite: stage a real violation per gate and assert it is refused.
 *
 * This is the countermeasure to the failure that makes every other
 * countermeasure worthless — a gate that has quietly stopped firing. A gate
 * with a unit test and no canary proves its logic and nothing about whether it
 * is still wired in.
 */

test("canaries run each gate against its staged violation and report per gate", async () => {
  const results = await runCanaries({
    gateRoot: join(FIX, "valid", "gates"),
    canaryRoot: join(FIX, "valid", "canary"),
  });

  assert.equal(results.length, 2);
  for (const r of results) {
    assert.equal(r.pass, true, `${r.gate} did not block its own canary: ${r.detail}`);
    assert.equal(r.expected, "block");
    assert.equal(r.actual, "block");
  }
  assert.deepEqual(results.map((r) => r.gate).sort(), ["blast-radius", "dod"]);
});

test("a gate that stops blocking its canary is reported as a failure, not an error", async () => {
  // What a regression actually looks like: the gate loads, runs, returns a
  // verdict, and the verdict is now wrong. If that surfaced as a crash it
  // would be easy; it surfaces as a pass.
  const dir = mkdtempSync(join(tmpdir(), "harness-canary-"));
  mkdirSync(join(dir, "gates"), { recursive: true });
  mkdirSync(join(dir, "canary"), { recursive: true });
  writeFileSync(
    join(dir, "gates", "regressed.mjs"),
    'export const meta = { id: "regressed", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000, canaryCase: "c" };\n' +
      'export async function check() { return { verdict: "pass" }; }\n',
  );
  writeFileSync(
    join(dir, "canary", "c.mjs"),
    'export const meta = { gate: "regressed", expect: "block" };\n' +
      'export function event() { return { hook_event_name: "PreToolUse" }; }\n',
  );

  const results = await runCanaries({ gateRoot: join(dir, "gates"), canaryRoot: join(dir, "canary") });
  assert.equal(results.length, 1);
  const only = results[0];
  assert.ok(only);
  assert.equal(only.pass, false);
  assert.equal(only.actual, "pass");
  assert.match(String(only.detail), /expected block/i);
});

test("canaries execute the gate directly, so a repo left in observe still passes doctor", async () => {
  // M2, and the reason canaries do not go through the installed hook path:
  // `harness init` deliberately leaves a repository in `observe`, where every
  // block is downgraded to a warn. A canary run through the hooks would fail
  // on every freshly initialised repo, and a preflight that fails by design is
  // a preflight nobody runs.
  const results = await runCanaries({
    gateRoot: join(FIX, "valid", "gates"),
    canaryRoot: join(FIX, "valid", "canary"),
    // The forced context is what makes this independent of repo policy.
    policy: { enabled: true, mode: "observe" },
  });
  assert.ok(results.every((r) => r.pass), "observe mode must not change a canary outcome");
});

test("the forced-enforce context is unreachable from the runner", async () => {
  // The property that keeps the previous test from being a bypass. If the
  // runner could reach the canary path, a hook invocation could force enforce
  // — turning a preflight convenience into an escalation route.
  const seen = new Set();
  /** @param {string} file */
  const walk = (file) => {
    if (seen.has(file) || !existsSync(file)) return;
    seen.add(file);
    const src = readFileSync(file, "utf8");
    for (const m of src.matchAll(/from\s+"(\.[^"]+)"/g)) {
      const spec = m[1];
      if (spec === undefined) continue;
      walk(resolve(dirname(file), spec));
    }
  };
  walk(RUNNER);

  const reachable = [...seen].map((f) => f.replace(SRC, ""));
  assert.ok(
    !reachable.some((f) => f.includes("canary")),
    `the runner's import graph reaches the canary harness: ${reachable.join(", ")}`,
  );
});

test("no environment variable can force enforce during a hook invocation", async () => {
  // The other half. Even if the module graph is clean, an env-var switch would
  // let a hook escalate its own mode. The forced context is a parameter, not a
  // variable, so none of these can do anything.
  const repo = mkdtempSync(join(tmpdir(), "harness-force-"));
  mkdirSync(join(repo, ".harness"), { recursive: true });
  writeFileSync(join(repo, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(repo, ".harness", "policy.yaml"), "enabled: true\nmode: observe\n");

  for (const key of ["HARNESS_FORCE_ENFORCE", "HARNESS_MODE", "HARNESS_CANARY", "HARNESS_ENFORCE"]) {
    const r = spawnSync(process.execPath, [RUNNER, "block"], {
      input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "s", cwd: repo }),
      encoding: "utf8",
      cwd: repo,
      env: {
        ...process.env,
        HARNESS_GATE_ROOT: FIXTURE_GATES,
        CLAUDE_PROJECT_DIR: repo,
        [key]: "1",
      },
    });
    assert.equal(r.status, 0, `${key} escalated observe mode into a block`);
  }
});
