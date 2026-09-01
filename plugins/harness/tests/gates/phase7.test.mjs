import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { resolveSession, CLASSIFICATIONS, classify, REMEDIES } from "../../src/lib/loop.mjs";
import { runStatus } from "../../src/commands/status.mjs";
import { appendRecord } from "../../src/lib/log.mjs";

/**
 * Phase 7: the loop that makes the system improve rather than ossify.
 *
 * The event log is only useful if a session's artefacts can be found together,
 * and only durable if every escaped defect turns into a change. M2 and M3 are
 * a workflow, and the part that belongs in code is the part that refuses to
 * let a classification exist without its mandated remedy.
 */

function repo() {
  const root = mkdtempSync(join(tmpdir(), "harness-p7-"));
  mkdirSync(join(root, ".harness", "tasks", "TASK-1", "evidence"), { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), "enabled: true\nmode: observe\n");
  writeFileSync(join(root, ".harness", "current-task"), "TASK-1\n");
  writeFileSync(join(root, ".harness", "tasks", "TASK-1", "evidence", "manifest.yaml"), "task: TASK-1\n");
  return root;
}

/* ---------- session replay (R-M1.4) ---------- */

test("a session id resolves its transcript, event log and evidence together", () => {
  const root = repo();
  appendRecord(root, "sess-9", { ts: "2026-09-01T10:00:00Z", session_id: "sess-9", event: "PreToolUse", gate: "blast-radius", verdict: "pass", task: "TASK-1", transcript_path: "/tmp/t.jsonl" });

  const s = resolveSession(root, "sess-9");
  assert.equal(s.sessionId, "sess-9");
  assert.equal(s.events.length, 1);
  assert.equal(s.transcriptPath, "/tmp/t.jsonl");
  assert.ok(s.evidenceBundles.some((b) => b.includes("TASK-1")), "the bundle must be addressable from the session");
});

test("an unknown session resolves to nothing, and says so rather than throwing", () => {
  const s = resolveSession(repo(), "never-existed");
  assert.equal(s.events.length, 0);
  assert.equal(s.transcriptPath, null);
  assert.match(s.note, /no events/i);
});

/* ---------- classification and codification (M2, M3) ---------- */

test("the five classifications are exactly five", () => {
  assert.deepEqual(
    [...CLASSIFICATIONS].sort(),
    ["ambiguous-contract", "missing-context", "missing-gate", "missing-rule", "model-error"],
  );
});

test("every classification maps to a mandated remedy", () => {
  // M3.1. A classification with no remedy is a retrospective note, and a
  // retrospective note is what this whole loop exists to replace.
  for (const c of CLASSIFICATIONS) {
    assert.ok(REMEDIES[c], `${c} has no mandated remedy`);
    assert.ok(REMEDIES[c].length > 20, `${c}'s remedy is too vague to act on`);
  }
});

test("a classification is recorded with its remedy and the incident it came from", () => {
  const root = repo();
  const r = classify(root, {
    incident: "INC-4",
    classification: "missing-gate",
    note: "nothing checked that migrations carry a rollback",
  });
  assert.equal(r.classification, "missing-gate");
  assert.match(r.remedy, /gate/i);
  assert.match(r.remedy, /canary/i, "a new gate without a canary is the failure M2 describes");

  const recorded = resolveSession(root, "cli").events.filter((e) => e["event"] === "harness.classify");
  assert.equal(recorded.length, 1);
  const entry = recorded[0];
  assert.ok(entry);
  assert.equal(entry["incident"], "INC-4");
});

test("an unknown classification is refused, naming the five", () => {
  assert.throws(
    () => classify(repo(), { incident: "INC-5", classification: "just-a-bug", note: "x" }),
    /missing-context|missing-gate|five/i,
  );
});

test("a classification with no incident is refused", () => {
  // R-L2.2: every learned constraint links to the incident that produced it.
  // Without the link, a rule accumulates with nothing to review it against.
  assert.throws(() => classify(repo(), { incident: "", classification: "missing-rule", note: "x" }), /incident/i);
});

/* ---------- status, now fully reported ---------- */

test("status reports gates that have not fired, rather than omitting them", async () => {
  const root = repo();
  appendRecord(root, "s", { ts: "2026-09-01T10:00:00Z", session_id: "s", event: "PreToolUse", gate: "blast-radius", verdict: "pass" });

  const report = await runStatus({ root, knownGates: ["blast-radius", "dod", "plan-first"] });
  assert.ok(Array.isArray(report.silentGates));
  assert.deepEqual(report.silentGates.sort(), ["dod", "plan-first"]);
});

test("status reports open escalations", async () => {
  const root = repo();
  appendRecord(root, "s", { ts: "2026-09-01T10:00:00Z", session_id: "s", event: "Stop", gate: "dod", verdict: "block", escalate: true, reason: "criteria unmet" });

  const report = await runStatus({ root });
  assert.equal(report.escalations.length, 1);
  const esc = report.escalations[0];
  assert.ok(esc);
  assert.match(esc.reason, /criteria unmet/);
});

test("status no longer lists replay or escalations as deferred", async () => {
  // The deferred list is load-bearing: it must shrink when the thing is built,
  // or it becomes a list nobody trusts.
  const report = await runStatus({ root: repo() });
  assert.ok(!report.deferred.join(" ").match(/escalation/i), "escalations are implemented now");
  assert.ok(!report.deferred.join(" ").match(/have not fired/i), "silent gates are implemented now");
});
