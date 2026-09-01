import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { sanitisedEnv, runChild } from "../../src/lib/exec.mjs";

/**
 * M4 and M10: children run with no terminal, no prompts, and no shim.
 *
 * Hooks run without a controlling terminal, so anything interactive hangs
 * until its timeout — and under M5 a timed-out PreToolUse gate does not block,
 * so the gate fails open silently. A prompt is therefore not an inconvenience
 * here; it is a disabled gate.
 */

test("the sanitised environment disarms every interactive prompt", () => {
  const env = sanitisedEnv({ PATH: "/usr/bin", HOME: "/home/x" });
  assert.equal(env.CI, "1");
  assert.equal(env.TERM, "dumb");
  assert.equal(env.NO_COLOR, "1");
  assert.equal(env.FORCE_COLOR, "0");
  assert.equal(env.GIT_TERMINAL_PROMPT, "0");
  assert.equal(env.GIT_PAGER, "cat");
  assert.equal(env.PAGER, "cat");
  assert.equal(env.npm_config_yes, "true");
  assert.equal(env.DEBIAN_FRONTEND, "noninteractive");
  assert.equal(env.PATH, "/usr/bin", "the inherited PATH must survive");
});

test("a child reading stdin gets EOF immediately rather than hanging", async () => {
  // The property that matters: a verb that waits for input must end, not stall
  // until the watchdog. Reading stdin here returns empty because stdin is
  // /dev/null, not a pipe nobody will ever write to.
  const dir = mkdtempSync(join(tmpdir(), "harness-exec-"));
  const script = join(dir, "reads-stdin.mjs");
  writeFileSync(
    script,
    "let data = '';\n" +
      "process.stdin.setEncoding('utf8');\n" +
      "process.stdin.on('data', (c) => { data += c; });\n" +
      "process.stdin.on('end', () => { process.stdout.write('READ:' + JSON.stringify(data)); });\n",
  );

  const result = await runChild(process.execPath, [script], { cwd: dir, timeoutMs: 5000 });
  assert.equal(result.timedOut, false, "the child hung waiting for stdin");
  assert.equal(result.stdout, 'READ:""');
});

test("a child that overruns its timeout is reported as timed out, not as success", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-exec-slow-"));
  const script = join(dir, "slow.mjs");
  writeFileSync(script, "setTimeout(() => process.stdout.write('late'), 10000);\n");

  const result = await runChild(process.execPath, [script], { cwd: dir, timeoutMs: 300 });
  assert.equal(result.timedOut, true);
  assert.notEqual(result.code, 0, "a timed-out child must never look like a clean exit");
});

test("the exit code and both streams are returned, never swallowed", async () => {
  // R-F2.4: never suppress a validator's failure. "Clean" and "the parser
  // could not read the file" must stay distinguishable.
  const dir = mkdtempSync(join(tmpdir(), "harness-exec-fail-"));
  const script = join(dir, "fails.mjs");
  writeFileSync(script, "process.stderr.write('could not parse');\nprocess.exitCode = 3;\n");

  const result = await runChild(process.execPath, [script], { cwd: dir, timeoutMs: 5000 });
  assert.equal(result.code, 3);
  assert.match(result.stderr, /could not parse/);
  assert.equal(result.timedOut, false);
});

test("no shell is involved, so a profile cannot contribute output", async () => {
  const dir = mkdtempSync(join(tmpdir(), "harness-exec-profile-"));
  const profile = join(dir, "profile.sh");
  writeFileSync(profile, 'echo "PROFILE NOISE"\n');
  const script = join(dir, "quiet.mjs");
  writeFileSync(script, "process.stdout.write('clean');\n");

  const result = await runChild(process.execPath, [script], {
    cwd: dir,
    timeoutMs: 5000,
    env: { BASH_ENV: profile, ENV: profile },
  });
  assert.equal(result.stdout, "clean");
});
