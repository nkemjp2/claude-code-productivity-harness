import { test } from "node:test";
import assert from "node:assert/strict";

import { computeMetrics, METRICS } from "../../src/lib/metrics.mjs";

/**
 * Fetch a metric, failing loudly if it is absent. A metric that vanished from
 * the report is exactly the silent omission these tests exist to catch, so it
 * must be an assertion rather than an optional chain.
 *
 * @param {Record<string, any>} report
 * @param {string} name
 * @returns {{ available: boolean, value: any, reason: string }}
 */
function metric(report, name) {
  const m = report[name];
  assert.ok(m, `${name} is missing from the report entirely`);
  return m;
}

/**
 * The R-M1.3 metrics, computed from the event log alone.
 *
 * The important property is not that four of them compute. It is that the
 * other four say why they cannot. A metrics table that silently omits escape
 * rate reads as a system with no escaped defects, which is the most flattering
 * possible misreading of an empty measurement.
 */

const log = [
  { ts: "2026-09-01T10:00:00Z", session_id: "s1", task: "T1", event: "PreToolUse", gate: "blast-radius", verdict: "pass", target: "/r/src/a.ts", duration_ms: 4 },
  { ts: "2026-09-01T10:01:00Z", session_id: "s1", task: "T1", event: "PreToolUse", gate: "blast-radius", verdict: "block", target: "/r/infra/x.tf", duration_ms: 5 },
  { ts: "2026-09-01T10:02:00Z", session_id: "s1", task: "T1", event: "PreToolUse", gate: "plan-first", verdict: "block", target: "/r/src/a.ts", duration_ms: 3 },
  { ts: "2026-09-01T10:03:00Z", session_id: "s1", task: "T1", event: "PreToolUse", gate: "blast-radius", verdict: "pass", target: "/r/src/a.ts", duration_ms: 4 },
  { ts: "2026-09-01T10:04:00Z", session_id: "s1", task: "T1", event: "PreToolUse", gate: "blast-radius", verdict: "pass", target: "/r/src/a.ts", duration_ms: 4 },
  { ts: "2026-09-01T10:10:00Z", session_id: "s1", task: "T1", event: "PostToolBatch", gate: "evidence-capture", verdict: "pass", duration_ms: 900 },
  { ts: "2026-09-01T10:20:00Z", session_id: "s1", task: "T1", event: "Stop", gate: "dod", verdict: "block", escalate: true, duration_ms: 7 },
];

test("all eight R-M1.3 metrics are named, none silently dropped", () => {
  assert.equal(METRICS.length, 8);
  const report = computeMetrics(log);
  for (const name of METRICS) {
    assert.ok(name in report, `${name} is not in the report at all`);
    assert.ok("available" in metric(report, name), `${name} does not say whether it is available`);
  }
});

test("gate-failure taxonomy counts by gate and verdict", () => {
  const t = metric(computeMetrics(log), "gate_failure_taxonomy");
  assert.equal(t.available, true);
  assert.equal(t.value["blast-radius"].block, 1);
  assert.equal(t.value["blast-radius"].pass, 3);
  assert.equal(t.value["plan-first"].block, 1);
});

test("rework rate counts files edited more than once in a session", () => {
  const r = metric(computeMetrics(log), "rework_rate");
  assert.equal(r.available, true);
  // /r/src/a.ts appears four times in session s1.
  assert.equal(r.value.thrashing_files[0].target, "/r/src/a.ts");
  assert.equal(r.value.thrashing_files[0].edits, 4);
});

test("time-to-green measures first edit to first green batch", () => {
  const t = metric(computeMetrics(log), "time_to_green");
  assert.equal(t.available, true);
  assert.equal(t.value.seconds, 600, "10:00 to 10:10 is ten minutes");
});

test("intervention count reads escalations", () => {
  const i = metric(computeMetrics(log), "intervention_count");
  assert.equal(i.available, true);
  assert.equal(i.value.escalations, 1);
});

test("the four that cannot be computed say so, and say why", () => {
  const report = computeMetrics(log);
  for (const name of ["mutation_score_trend", "escape_rate", "rule_load_coverage", "cost_per_completed_task"]) {
    const m = metric(report, name);
    assert.equal(m.available, false, `${name} claims to be available`);
    assert.equal(m.value, null, `${name} carries a value it cannot have`);
    assert.ok(m.reason.length > 20, `${name} does not explain its absence: ${m.reason}`);
  }
});

test("escape rate names the missing half rather than reporting zero", () => {
  // R-L7.3a: attribution is only half the substrate. Without defect-side
  // linkage there is no denominator, and reporting 0 would be a claim of
  // perfection built from missing data.
  const r = metric(computeMetrics(log), "escape_rate");
  assert.match(r.reason, /defect/i);
});

test("an empty log yields no metrics rather than zeroes", () => {
  const report = computeMetrics([]);
  const t = metric(report, "gate_failure_taxonomy");
  assert.equal(t.available, false);
  assert.match(t.reason, /no events|empty/i);
});
