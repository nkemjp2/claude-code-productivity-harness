import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

import { runMode, ModeRefused } from "../../src/commands/mode.mjs";
import { parse } from "../../src/lib/yaml.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const BIN = resolve(HERE, "..", "..", "bin", "harness.mjs");

/**
 * `harness mode` — changing the enforcement level is itself an event.
 *
 * A mode change is the single most consequential thing anybody does to the
 * harness: it is how enforcement gets switched off. If it leaves no trace,
 * then "the gates were on" becomes unanswerable after the fact, and the
 * gate-failure taxonomy in R-M1.3 silently develops a hole shaped exactly like
 * the period somebody muted it.
 *
 * So the reason is required, not optional. A mode change with no stated reason
 * is the one you most want to read six weeks later.
 */

function initialised() {
  const dir = mkdtempSync(join(tmpdir(), "harness-mode-"));
  mkdirSync(join(dir, ".harness"), { recursive: true });
  writeFileSync(join(dir, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(dir, ".harness", "policy.yaml"), "enabled: true\nmode: observe\n");
  return dir;
}

/** @param {string} root */
function records(root) {
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

test("a mode change is written to policy and recorded in the event log", async () => {
  const root = initialised();
  await runMode({ root, mode: "enforce", reason: "observe week complete; taxonomy reviewed" });

  assert.equal(/** @type {any} */ (parse(readFileSync(join(root, ".harness", "policy.yaml"), "utf8"))).mode, "enforce");

  const changes = records(root).filter((r) => r.event === "harness.mode");
  assert.equal(changes.length, 1);
  assert.equal(changes[0].from, "observe");
  assert.equal(changes[0].to, "enforce");
  assert.match(changes[0].reason, /taxonomy reviewed/);
  assert.ok(changes[0].ts, "the record must be timestamped");
});

test("a mode change with no reason is refused", async () => {
  const root = initialised();
  await assert.rejects(
    () => runMode({ root, mode: "dormant", reason: "" }),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.ok(err instanceof ModeRefused);
      assert.match(err.message, /reason/i);
      return true;
    },
  );
  assert.equal(
    /** @type {any} */ (parse(readFileSync(join(root, ".harness", "policy.yaml"), "utf8"))).mode,
    "observe",
    "a refused change must not have been written",
  );
});

test("an unknown mode is refused and names the three that exist", async () => {
  const root = initialised();
  await assert.rejects(
    () => runMode({ root, mode: "strict", reason: "typo" }),
    (err) => {
      if (!(err instanceof Error)) throw err;
      assert.match(err.message, /dormant/);
      assert.match(err.message, /observe/);
      assert.match(err.message, /enforce/);
      return true;
    },
  );
});

test("mode refuses in a repository the harness was never initialised in", async () => {
  const bare = mkdtempSync(join(tmpdir(), "harness-bare-mode-"));
  await assert.rejects(() => runMode({ root: bare, mode: "enforce", reason: "x" }), ModeRefused);
});

test("the CLI requires a reason too, and says so usefully", () => {
  const root = initialised();
  const r = spawnSync(process.execPath, [BIN, "mode", "enforce"], {
    encoding: "utf8",
    cwd: root,
    env: { ...process.env, CLAUDE_PROJECT_DIR: root },
  });
  assert.notEqual(r.status, 0);
  assert.match(r.stderr, /reason/i);
});
