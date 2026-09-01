import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const HERE = dirname(fileURLToPath(import.meta.url));
const RUNNER = resolve(HERE, "..", "..", "src", "runner.mjs");
const FIXTURE_GATES = resolve(HERE, "..", "fixtures", "gates");

/**
 * M26: concurrent appends.
 *
 * Matching hooks run in parallel — that is why M14 exists — so several runners
 * append in the same instant. O_APPEND is atomic only up to PIPE_BUF, a record
 * carrying a long block reason exceeds it, and Windows behaves differently
 * again. Interleaving does not announce itself: it produces a file that mostly
 * parses, with a few corrupt lines, and every metric in R-M1.3 quietly wrong.
 *
 * The countermeasure is one file per process. This test is what proves it,
 * because "we write one file per process" is unfalsifiable without running
 * writers at the same time and reading the result.
 */

test("concurrent runners produce intact per-process files that merge cleanly", async () => {
  const repo = mkdtempSync(join(tmpdir(), "harness-conc-"));
  mkdirSync(join(repo, ".harness"), { recursive: true });
  writeFileSync(join(repo, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(repo, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");

  const N = 12;
  const event = JSON.stringify({
    hook_event_name: "PreToolUse",
    session_id: "sess-concurrent",
    cwd: repo,
    tool_name: "Edit",
    // A long reason, deliberately past PIPE_BUF, because a short record would
    // pass even with a shared handle and prove nothing.
    tool_input: { file_path: "/tmp/x.ts", padding: "y".repeat(6000) },
  });

  await Promise.all(
    Array.from({ length: N }, () =>
      new Promise((done) => {
        setImmediate(() => {
          spawnSync(process.execPath, [RUNNER, "block"], {
            input: event,
            encoding: "utf8",
            cwd: repo,
            env: { ...process.env, HARNESS_GATE_ROOT: FIXTURE_GATES, CLAUDE_PROJECT_DIR: repo },
          });
          done(undefined);
        });
      }),
    ),
  );

  const dir = join(repo, ".harness", "events");
  const files = readdirSync(dir);
  assert.equal(files.length, N, `expected one log file per process, saw ${files.length}`);

  /** @type {any[]} */
  const merged = [];
  for (const f of files) {
    const text = readFileSync(join(dir, f), "utf8");
    for (const line of text.split("\n")) {
      if (line.trim() === "") continue;
      // The real assertion. A torn write yields a line that is not valid JSON,
      // and that is precisely what silent interleaving looks like.
      assert.doesNotThrow(() => JSON.parse(line), `torn record in ${f}: ${line.slice(0, 120)}`);
      merged.push(JSON.parse(line));
    }
  }

  assert.equal(merged.length, N, "every run must contribute exactly one record");
  for (const record of merged) {
    assert.equal(record.gate, "block");
    assert.equal(record.session_id, "sess-concurrent");
  }
});

test("log file names carry session and pid, so two processes cannot collide", () => {
  const repo = mkdtempSync(join(tmpdir(), "harness-name-"));
  mkdirSync(join(repo, ".harness"), { recursive: true });
  writeFileSync(join(repo, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(repo, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");

  spawnSync(process.execPath, [RUNNER, "pass"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "sess-abc", cwd: repo }),
    encoding: "utf8",
    cwd: repo,
    env: { ...process.env, HARNESS_GATE_ROOT: FIXTURE_GATES, CLAUDE_PROJECT_DIR: repo },
  });

  const files = readdirSync(join(repo, ".harness", "events"));
  assert.equal(files.length, 1);
  assert.match(String(files[0]), /sess-abc/, "the session id must be in the file name");
  assert.match(String(files[0]), /\d+/, "the pid must be in the file name");
  assert.match(String(files[0]), /\.jsonl$/);
});

test("an oversized reason is spilled to a sidecar rather than written inline", () => {
  // M15/M26. A record must stay small enough to be written atomically; the
  // full text goes beside it and is referenced by path.
  const repo = mkdtempSync(join(tmpdir(), "harness-spill-"));
  mkdirSync(join(repo, ".harness"), { recursive: true });
  writeFileSync(join(repo, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(repo, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");

  const gateDir = mkdtempSync(join(tmpdir(), "harness-gates-"));
  writeFileSync(
    join(gateDir, "huge.mjs"),
    'export const meta = { id: "huge", events: ["PreToolUse"], blocking: true, failClosed: true, timeoutMs: 1000, handlerTimeoutMs: 5000 };\n' +
      'export async function check() { return { verdict: "block", reason: "R".repeat(20000) }; }\n',
  );

  spawnSync(process.execPath, [RUNNER, "huge"], {
    input: JSON.stringify({ hook_event_name: "PreToolUse", session_id: "sess-spill", cwd: repo }),
    encoding: "utf8",
    cwd: repo,
    env: { ...process.env, HARNESS_GATE_ROOT: gateDir, CLAUDE_PROJECT_DIR: repo },
  });

  const dir = join(repo, ".harness", "events");
  const logFile = readdirSync(dir).find((f) => f.endsWith(".jsonl"));
  assert.ok(logFile);
  const line = readFileSync(join(dir, logFile), "utf8").trim();
  assert.ok(line.length < 8000, `record was ${line.length} bytes; it must be capped`);
  const record = JSON.parse(line);
  assert.ok(record.reason_ref, "an oversized reason must leave a sidecar reference behind");
});
