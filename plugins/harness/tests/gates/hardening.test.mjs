import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { loadPolicy, modeForGate } from "../../src/lib/policy.mjs";
import { gateLatency } from "../../src/lib/latency.mjs";
import { recordDefect, escapeRate } from "../../src/lib/defects.mjs";
import { computeMetrics } from "../../src/lib/metrics.mjs";
import { readRecords } from "../../src/lib/log.mjs";

/**
 * Hardening driven by the five objections raised after the build.
 *
 * Each of these exists because a specific criticism was credible, and the
 * answer to a credible criticism is a mechanism rather than a reassurance.
 */

function repo(/** @type {string} */ policy) {
  const root = mkdtempSync(join(tmpdir(), "harness-hard-"));
  mkdirSync(join(root, ".harness"), { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), policy);
  return root;
}

/* ---------- 1. Per-gate mode: enforce three, observe twelve ---------- */

test("a gate can be enforced while the repository stays in observe", () => {
  // The objection: fifteen gates go to enforce together, one noisy gate poisons
  // the set, and the credible response is to switch the harness off. Per-gate
  // mode is what lets the three high-value gates block while the rest keep
  // collecting evidence about whether they deserve to.
  const root = repo("enabled: true\nmode: observe\ngates:\n  dod: enforce\n  blast-radius: enforce\n");
  const policy = loadPolicy(root);

  assert.equal(modeForGate(policy, "dod"), "enforce");
  assert.equal(modeForGate(policy, "blast-radius"), "enforce");
  assert.equal(modeForGate(policy, "assertion-density"), "observe", "an unlisted gate follows the repository mode");
});

test("a gate can be observed while the repository is enforcing", () => {
  // The other direction, which is how a noisy gate is demoted without
  // abandoning enforcement everywhere else (R-F2.5).
  const root = repo("enabled: true\nmode: enforce\ngates:\n  assertion-density: observe\n");
  const policy = loadPolicy(root);
  assert.equal(modeForGate(policy, "assertion-density"), "observe");
  assert.equal(modeForGate(policy, "dod"), "enforce");
});

test("a gate set to dormant does not run at all", () => {
  const root = repo("enabled: true\nmode: enforce\ngates:\n  thrash-breaker: dormant\n");
  assert.equal(modeForGate(loadPolicy(root), "thrash-breaker"), "dormant");
});

test("an unrecognised per-gate mode falls back to the repository mode", () => {
  // Rather than to enforce. A typo in policy.yaml must never silently escalate
  // a gate into blocking.
  const root = repo("enabled: true\nmode: observe\ngates:\n  dod: strict\n");
  assert.equal(modeForGate(loadPolicy(root), "dod"), "observe");
});

/* ---------- 2. Latency, measured rather than assumed ---------- */

test("latency is reported per gate, with p50 and p95", () => {
  // The objection with the best chance of killing adoption: fifteen gates, a
  // process per matching tool call. It cannot be argued about usefully without
  // numbers, and duration_ms is already on every record.
  const log = [
    ...Array.from({ length: 20 }, (_, i) => ({ gate: "blast-radius", duration_ms: 10 + i })),
    ...Array.from({ length: 20 }, (_, i) => ({ gate: "per-edit-check", duration_ms: 900 + i * 50 })),
  ];
  const report = gateLatency(log);

  const slow = report.find((r) => r.gate === "per-edit-check");
  assert.ok(slow);
  assert.ok(slow.p95 > slow.p50, "p95 must be above p50 on a spread distribution");
  assert.ok(slow.p95 >= 1800, `expected a slow p95, got ${slow.p95}`);

  const fast = report.find((r) => r.gate === "blast-radius");
  assert.ok(fast && fast.p95 < 100);
});

test("latency ranks the worst offender first, because that is the one to fix", () => {
  const report = gateLatency([
    { gate: "fast", duration_ms: 5 },
    { gate: "slow", duration_ms: 5000 },
    { gate: "medium", duration_ms: 300 },
  ]);
  assert.deepEqual(report.map((r) => r.gate), ["slow", "medium", "fast"]);
});

test("a gate with no recorded runs is absent, not reported as zero", () => {
  // Zero milliseconds reads as "instant". Absent reads as "never ran", which
  // is what it means and is separately actionable.
  assert.deepEqual(gateLatency([]), []);
});

/* ---------- 3. Escape rate: the missing denominator ---------- */

test("a defect records the commits it is attributed to", () => {
  // R-L7.3a. Attribution alone is half the substrate; without the defect side
  // there is no denominator, and O1 — the primary objective — is unmeasurable.
  const root = repo("enabled: true\nmode: observe\n");
  recordDefect(root, { id: "DEF-1", commits: ["abc1234", "def5678"], note: "release stranded" });

  const records = readRecords(root).filter((r) => r["event"] === "harness.defect");
  assert.equal(records.length, 1);
  const first = records[0];
  assert.ok(first);
  assert.deepEqual(first["commits"], ["abc1234", "def5678"]);
});

test("a defect with no attributed commit is refused", () => {
  const root = repo("enabled: true\nmode: observe\n");
  assert.throws(() => recordDefect(root, { id: "DEF-2", commits: [], note: "x" }), /commit/i);
});

test("escape rate computes once both halves exist", () => {
  const rate = escapeRate({ defects: 3, agentAuthoredChanges: 60 });
  assert.equal(rate.available, true);
  assert.equal(rate.value.defects, 3);
  assert.equal(rate.value.changes, 60);
  assert.equal(rate.value.rate, 0.05);
});

test("escape rate still refuses to report zero when no defects are recorded", () => {
  // The distinction that matters: "no defects have been recorded" is not
  // "no defects escaped". Reporting 0 would be a claim of perfection built
  // from an empty table.
  const rate = escapeRate({ defects: 0, agentAuthoredChanges: 0 });
  assert.equal(rate.available, false);
  assert.match(rate.reason, /no agent-authored changes|denominator/i);
});

test("metrics picks up escape rate from the log once defects are recorded", () => {
  const log = [
    { event: "harness.defect", id: "DEF-1", commits: ["a"] },
    { event: "PostToolBatch", gate: "evidence-capture", verdict: "pass", commit: "a" },
    { event: "PostToolBatch", gate: "evidence-capture", verdict: "pass", commit: "b" },
  ];
  const m = computeMetrics(log)["escape_rate"];
  assert.ok(m);
  assert.equal(m.available, true, `escape rate should compute now: ${m.reason}`);
});

/* ---------- 4. test:affected degrades honestly ---------- */

test("the bundle records which verb actually satisfied the test requirement", async () => {
  // The objection: most repositories have `test`, not `test:affected`, so the
  // DoD gate would demand something they cannot cheaply produce. Falling back
  // is right; falling back silently is not — the bundle says which ran, so
  // "the affected tests passed" is never claimed when the full suite ran.
  const { captureEvidence, readBundle } = await import("../../src/lib/evidence.mjs");
  const root = repo("enabled: true\nmode: observe\n");
  mkdirSync(join(root, ".harness", "tasks", "T1"), { recursive: true });

  await captureEvidence({
    root,
    taskId: "T1",
    commit: "abc",
    verbs: ["typecheck", "test"],
    runVerb: async (/** @type {string} */ v) => ({ verb: v, command: `run ${v}`, code: 0, stdout: "ok", stderr: "", timedOut: false }),
  });

  const bundle = /** @type {any} */ (readBundle(root, "T1"));
  assert.ok(bundle.tests_affected, "the full-suite run must still satisfy the requirement");
  assert.equal(bundle.tests_affected.verb, "test");
  assert.match(String(bundle.tests_affected.scope), /full/i, "the bundle must say the scope was the whole suite");
});

/* ---------- 5. dry-run: a noise survey that cannot report false silence ---------- */

test("dry-run refuses to survey with no gates loaded", async () => {
  // Found by running it: the gate root resolved against the repository being
  // surveyed rather than the plugin, so it loaded nothing and reported that no
  // gate would fire. A reassuring answer produced by a broken tool is worse
  // than an error, because nobody investigates good news.
  const { runDryRun } = await import("../../src/commands/dryrun.mjs");
  const root = repo("enabled: true\nmode: observe\n");
  await assert.rejects(
    () => runDryRun({ root, commits: 5, gateRoot: join(root, "does-not-exist") }),
    /no gates were loaded/i,
  );
});

test("dry-run loads the real gates by default", async () => {
  const { runDryRun } = await import("../../src/commands/dryrun.mjs");
  const root = repo("enabled: true\nmode: observe\n");
  const report = await runDryRun({ root, commits: 1 });
  assert.ok(report.gates.length > 0, "the default gate root must resolve against the plugin");
  assert.ok(report.gates.some((g) => g.gate === "blast-radius"));
});
