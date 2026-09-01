import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runDoctor, foreignHandlers } from "../../src/commands/doctor.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, "..", "..", "bin", "harness.mjs");
const FIX = resolve(HERE, "..", "fixtures", "registry");

/**
 * `harness doctor` — the load-bearing preflight.
 *
 * It exists because almost everything the harness relies on is invisible when
 * it breaks: a gate whose handler path stopped resolving, a verb whose binary
 * is missing on this machine, a `.cmd` shim that cannot be spawned, a foreign
 * handler someone added in their own settings file. Each of those produces a
 * session that looks normal and enforces less than you think.
 */

function repoWith(/** @type {string} */ manifest) {
  const dir = mkdtempSync(join(tmpdir(), "harness-doctor-"));
  mkdirSync(join(dir, ".harness"), { recursive: true });
  writeFileSync(join(dir, ".harness", "manifest.yaml"), manifest);
  writeFileSync(join(dir, ".harness", "policy.yaml"), "enabled: true\nmode: observe\n");
  return dir;
}

test("doctor reports every required section as a pass/fail table", async () => {
  const repo = repoWith("verbs:\n  typecheck:\n    command: node\n    required: true\n");
  const report = await runDoctor({
    root: repo,
    gateRoot: join(FIX, "valid", "gates"),
    canaryRoot: join(FIX, "valid", "canary"),
  });

  const names = report.checks.map((c) => c.name);
  for (const required of [
    "platform",
    "node version",
    "client version",
    "runtime dependencies",
    "json purity",
    "worktree resolution",
    "canaries",
  ]) {
    assert.ok(
      names.some((n) => n.toLowerCase().includes(required)),
      `doctor did not report '${required}'; it reported ${names.join(", ")}`,
    );
  }
  for (const c of report.checks) {
    assert.ok(["pass", "fail", "warn"].includes(c.status), `${c.name} had status ${c.status}`);
    assert.ok(typeof c.detail === "string" && c.detail.length > 0, `${c.name} reported no detail`);
  }
});

test("JSON purity is checked by piping a real event through the runner", async () => {
  // Not a claim about the code — an observation of the process. This is the
  // check that would catch a shell profile writing to stdout, which is the
  // failure that makes every decision object unreadable.
  const repo = repoWith("verbs: {}\n");
  const report = await runDoctor({
    root: repo,
    gateRoot: join(FIX, "valid", "gates"),
    canaryRoot: join(FIX, "valid", "canary"),
  });
  const purity = report.checks.find((c) => c.name.toLowerCase().includes("json purity"));
  assert.ok(purity);
  assert.equal(purity.status, "pass", purity.detail);
});

test("a missing REQUIRED verb fails; a missing optional verb only warns", async () => {
  // M13. A missing optional tool degrades so work continues. A missing
  // required tool must not: a typechecker that quietly skips is exactly the
  // silently disabled gate this whole design exists to prevent (R-F2.4).
  const optional = repoWith("verbs:\n  mutate:\n    command: definitely-not-on-this-machine\n    required: false\n");
  const optionalReport = await runDoctor({
    root: optional,
    gateRoot: join(FIX, "valid", "gates"),
    canaryRoot: join(FIX, "valid", "canary"),
  });
  const optDeps = optionalReport.checks.find((c) => c.name.toLowerCase().includes("runtime dependencies"));
  assert.equal(optDeps?.status, "warn", optDeps?.detail);

  const required = repoWith("verbs:\n  typecheck:\n    command: definitely-not-on-this-machine\n    required: true\n");
  const requiredReport = await runDoctor({
    root: required,
    gateRoot: join(FIX, "valid", "gates"),
    canaryRoot: join(FIX, "valid", "canary"),
  });
  const reqDeps = requiredReport.checks.find((c) => c.name.toLowerCase().includes("runtime dependencies"));
  assert.equal(reqDeps?.status, "fail", reqDeps?.detail);
  assert.match(String(reqDeps?.detail), /typecheck/);
});

test("doctor names a foreign handler and the settings file it came from", async () => {
  // M23. A third-party tool registering its own handler sits outside the
  // verdict protocol entirely, and nothing in this repository can see it — the
  // merged configuration is the only place it appears.
  const dir = mkdtempSync(join(tmpdir(), "harness-settings-"));
  const settings = join(dir, "settings.json");
  writeFileSync(
    settings,
    JSON.stringify({
      hooks: {
        PreToolUse: [
          {
            matcher: "Edit",
            hooks: [
              { type: "command", command: "node", args: ["${CLAUDE_PLUGIN_ROOT}/src/runner.mjs", "blast-radius"] },
              { type: "command", command: "some-other-tool", args: ["--scan"] },
            ],
          },
        ],
      },
    }),
  );

  const found = foreignHandlers([settings]);
  assert.equal(found.length, 1);
  const first = found[0];
  assert.ok(first);
  assert.match(first.source, /settings\.json$/, "the warning must name its source settings file");
  assert.match(first.detail, /some-other-tool/);
});

test("doctor is invocable from CI through bin/harness.mjs", () => {
  // CI cannot invoke a slash command, which is why bin/harness.mjs is the
  // canonical surface and commands/ are thin wrappers over it.
  const repo = repoWith("verbs: {}\n");
  const r = spawnSync(process.execPath, [BIN, "doctor"], {
    encoding: "utf8",
    cwd: repo,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  assert.ok(r.status === 0 || r.status === 1, `doctor exited ${r.status}`);
  const output = r.stdout + r.stderr;
  assert.match(output, /platform/i);
  assert.match(output, /pass|fail|warn/i);
});

test("doctor exits non-zero when any check fails", () => {
  const repo = repoWith("verbs:\n  typecheck:\n    command: definitely-not-on-this-machine\n    required: true\n");
  const r = spawnSync(process.execPath, [BIN, "doctor"], {
    encoding: "utf8",
    cwd: repo,
    env: { ...process.env, CLAUDE_PROJECT_DIR: repo },
  });
  assert.equal(r.status, 1, "a failing preflight that exits 0 is a preflight CI ignores");
});

test("doctor and init agree about whether a verb resolves", async () => {
  // Found by adopting a real repository: init reported four verbs configured
  // while doctor reported the same four unresolvable, because doctor checked
  // only PATH and probe had learned to look in node_modules/.bin.
  //
  // Two components answering the same question differently is worse than
  // either answer being wrong, because there is no way for a reader to know
  // which to believe. Verb resolution has one owner.
  const dir = mkdtempSync(join(tmpdir(), "harness-agree-"));
  mkdirSync(join(dir, "node_modules", ".bin"), { recursive: true });
  writeFileSync(join(dir, "node_modules", ".bin", "faketool"), "#!/bin/sh\nexit 0\n", { mode: 0o755 });
  mkdirSync(join(dir, ".harness"), { recursive: true });
  writeFileSync(join(dir, ".harness", "manifest.yaml"), "verbs:\n  lint:\n    command: faketool\n    required: false\n");
  writeFileSync(join(dir, ".harness", "policy.yaml"), "enabled: true\nmode: observe\n");

  const report = await runDoctor({
    root: dir,
    gateRoot: join(FIX, "valid", "gates"),
    canaryRoot: join(FIX, "valid", "canary"),
  });
  const deps = report.checks.find((c) => c.name.toLowerCase().includes("runtime dependencies"));
  assert.ok(deps);
  assert.equal(deps.status, "pass", `doctor could not resolve a local bin that probe can: ${deps.detail}`);
  assert.match(deps.detail, /node_modules/);
});

test("doctor does not write into the event log of the repo it inspects", async () => {
  // Found by adopting a real repository: every doctor run left __doctor_probe__
  // records in .harness/events/. That log is the substrate every R-M1.3 metric
  // computes from, so a diagnostic writing into it corrupts the gate-failure
  // taxonomy with a gate that does not exist.
  const dir = mkdtempSync(join(tmpdir(), "harness-nopollute-"));
  mkdirSync(join(dir, ".harness"), { recursive: true });
  writeFileSync(join(dir, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(dir, ".harness", "policy.yaml"), "enabled: true\nmode: observe\n");

  await runDoctor({
    root: dir,
    gateRoot: join(FIX, "valid", "gates"),
    canaryRoot: join(FIX, "valid", "canary"),
  });

  const events = join(dir, ".harness", "events");
  const written = existsSync(events) ? readdirSync(events) : [];
  assert.deepEqual(written, [], `doctor wrote ${written.join(", ")} into the inspected repo's log`);
});
