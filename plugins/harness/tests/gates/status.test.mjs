import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runStatus } from "../../src/commands/status.mjs";
import { runInit } from "../../src/commands/init.mjs";
import { runMode } from "../../src/commands/mode.mjs";

/**
 * `harness status` — what is on, and what is merely declared.
 *
 * The distinction it exists to make is between a ratchet that holds a measured
 * number and one that holds nothing yet. Both look like a configured ratchet in
 * the file; only one is enforcing anything, and reading the file is how people
 * come to believe the second is the first.
 */

async function initialised() {
  const dir = mkdtempSync(join(tmpdir(), "harness-status-"));
  writeFileSync(join(dir, "package.json"), JSON.stringify({ name: "s", scripts: { test: "node --test" } }));
  await runInit({ root: dir });
  return dir;
}

test("status reports the mode and every ratchet's measured state", async () => {
  const root = await initialised();
  const report = await runStatus({ root });

  assert.equal(report.mode, "observe");
  assert.ok(report.ratchets.length > 0);
  for (const r of report.ratchets) {
    assert.equal(typeof r.measured, "boolean");
    if (!r.measured) {
      assert.equal(r.value, null, `${r.name} shows a value it never measured`);
      assert.ok(r.note.length > 0, `${r.name} does not say why it is unmeasured`);
    }
  }
});

test("status distinguishes declared ratchets from enforcing ones", async () => {
  // The whole point. An unmeasured ratchet in the file looks identical to a
  // measured one until something says otherwise.
  const root = await initialised();
  const report = await runStatus({ root });
  assert.ok(report.summary.includes("enforcing"), report.summary);
  assert.ok(/declared|unmeasured/i.test(report.summary), report.summary);
});

test("status lists mode changes from the event log with their reasons", async () => {
  const root = await initialised();
  await runMode({ root, mode: "enforce", reason: "observe week reviewed, taxonomy clean" });

  const report = await runStatus({ root });
  assert.equal(report.mode, "enforce");
  assert.equal(report.modeChanges.length, 1);
  const change = report.modeChanges[0];
  assert.ok(change);
  assert.match(change.reason, /taxonomy clean/);
});

test("status reports the configured verbs and which are required", async () => {
  const root = await initialised();
  const report = await runStatus({ root });
  assert.ok(report.verbs.some((v) => v.name === "test"));
  for (const v of report.verbs) assert.equal(typeof v.required, "boolean");
});

test("status refuses in a repository that was never initialised", async () => {
  const bare = mkdtempSync(join(tmpdir(), "harness-status-bare-"));
  await assert.rejects(() => runStatus({ root: bare }), /not initialised|policy\.yaml/i);
});

test("status names what it cannot yet report, rather than omitting it", async () => {
  // A status page that silently leaves out escalations and gate-firing looks
  // like a system with none of either.
  const root = await initialised();
  const report = await runStatus({ root });
  assert.ok(report.deferred.length > 0);
  assert.match(report.deferred.join(" "), /escalation|gate/i);
});
