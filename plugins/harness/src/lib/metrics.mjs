/**
 * The R-M1.3 metrics, computed from the event log alone.
 *
 * Four of the eight compute today. The other four cannot, and the important
 * property of this module is that they say so — with a reason — rather than
 * being omitted or reported as zero.
 *
 * That is not pedantry. A metrics table missing "escape rate" reads as a
 * system with no escaped defects, and a zero reads as a measurement. Both are
 * the most flattering possible misreading of an absent measurement, and O1 is
 * the primary objective this whole harness is judged on.
 *
 * @typedef {{ available: boolean, value: any, reason: string }} Metric
 */

/** All eight, named here so none can be quietly dropped. */
export const METRICS = [
  "gate_failure_taxonomy",
  "rework_rate",
  "mutation_score_trend",
  "time_to_green",
  "intervention_count",
  "escape_rate",
  "rule_load_coverage",
  "cost_per_completed_task",
];

/** @param {any} value @returns {Metric} */
const available = (value) => ({ available: true, value, reason: "" });
/** @param {string} reason @returns {Metric} */
const unavailable = (reason) => ({ available: false, value: null, reason });

/**
 * @param {ReadonlyArray<Record<string, any>>} log
 * @returns {Record<string, Metric>}
 */
export function computeMetrics(log) {
  const empty = log.length === 0;

  /** @type {Record<string, Metric>} */
  const report = {};

  // 1. Gate-failure taxonomy — which rule fires most, and where context is failing.
  if (empty) {
    report["gate_failure_taxonomy"] = unavailable("no events in the log yet, so there is nothing to count");
  } else {
    /** @type {Record<string, Record<string, number>>} */
    const byGate = {};
    for (const r of log) {
      const gate = typeof r["gate"] === "string" ? r["gate"] : null;
      if (gate === null) continue;
      const verdict = String(r["verdict"] ?? "unknown");
      byGate[gate] ??= {};
      byGate[gate][verdict] = (byGate[gate][verdict] ?? 0) + 1;
    }
    report["gate_failure_taxonomy"] = available(byGate);
  }

  // 2. Rework rate — a file edited repeatedly in one session is thrash, and
  //    thrash is usually ambiguity upstream rather than incompetence downstream.
  if (empty) {
    report["rework_rate"] = unavailable("no events in the log yet");
  } else {
    /** @type {Map<string, number>} */
    const counts = new Map();
    for (const r of log) {
      const target = r["target"];
      if (typeof target !== "string" || target === "") continue;
      const key = `${String(r["session_id"] ?? "")}::${target}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    const thrashing = [...counts.entries()]
      .filter(([, n]) => n > 1)
      .map(([key, n]) => ({ target: key.split("::")[1] ?? "", edits: n }))
      .sort((a, b) => b.edits - a.edits);
    report["rework_rate"] = available({ threshold: 2, thrashing_files: thrashing });
  }

  // 3. Mutation score trend — Phase 6.
  report["mutation_score_trend"] = unavailable(
    "no mutation runner ships in this build (deferred to Phase 6), so no score has ever been recorded. " +
      "Reporting a number here would be inventing the only objective measure of assertion strength.",
  );

  // 4. Time-to-green — first edit to first green batch.
  if (empty) {
    report["time_to_green"] = unavailable("no events in the log yet");
  } else {
    const firstEdit = log.find((r) => r["event"] === "PreToolUse" && typeof r["target"] === "string");
    const firstGreen = log.find((r) => r["event"] === "PostToolBatch" && r["verdict"] === "pass");
    report["time_to_green"] =
      firstEdit === undefined || firstGreen === undefined
        ? unavailable(
            "needs a first edit and a first green PostToolBatch in the same session; one or both is absent",
          )
        : available({
            seconds: Math.round(
              (new Date(String(firstGreen["ts"])).getTime() - new Date(String(firstEdit["ts"])).getTime()) / 1000,
            ),
            from: firstEdit["ts"],
            to: firstGreen["ts"],
          });
  }

  // 5. Intervention count — how much human attention each task cost.
  if (empty) {
    report["intervention_count"] = unavailable("no events in the log yet");
  } else {
    report["intervention_count"] = available({
      escalations: log.filter((r) => r["escalate"] === true).length,
      mode_changes: log.filter((r) => r["event"] === "harness.mode").length,
    });
  }

  // 6. Escape rate — the primary outcome. Computable only once BOTH halves of
  //    R-L7.3a exist: attribution on the commit side, and defect records naming
  //    the commits they are attributed to. `harness defect` supplies the second.
  const defects = log.filter((r) => r["event"] === "harness.defect");
  const changes = new Set(
    log.filter((r) => typeof r["commit"] === "string" && r["commit"] !== "").map((r) => String(r["commit"])),
  );
  report["escape_rate"] =
    defects.length === 0 || changes.size === 0
      ? unavailable(
          "needs both halves of R-L7.3a. Attribution is on the commit side already; the other half is " +
            "defect records naming the commits they are attributed to, recorded with `harness defect`. " +
            `Currently ${defects.length} defect(s) and ${changes.size} attributed change(s). Reporting 0 ` +
            "would be a claim of perfection assembled from an empty table.",
        )
      : available({
          defects: defects.length,
          changes: changes.size,
          rate: Number((defects.length / changes.size).toFixed(4)),
        });

  // 7. Rule-load coverage — needs the InstructionsLoaded gate.
  report["rule_load_coverage"] = unavailable(
    "needs an InstructionsLoaded gate to record which rules actually reached context (Phase 6). Most " +
      "'it ignored the rule' incidents are really 'the rule was not in context', and this is the only " +
      "measure that separates them — so an invented value here would hide the distinction it exists for.",
  );

  // 8. Cost per completed task — tokens are not in the hook payload.
  report["cost_per_completed_task"] = unavailable(
    "token counts are not present in any hook payload verified against the client, so wall clock is " +
      "the only half available and half a cost measure is not a cost measure. OpenTelemetry carries " +
      "the rest; correlating it via prompt_id is Phase 7 work.",
  );

  return report;
}

/**
 * @param {Record<string, Metric>} report
 * @returns {string}
 */
export function formatMetrics(report) {
  const lines = ["harness metrics", ""];
  for (const name of METRICS) {
    const m = report[name];
    if (m === undefined) continue;
    lines.push(
      m.available
        ? `  ${name}\n      ${JSON.stringify(m.value)}`
        : `  ${name}\n      unavailable — ${m.reason}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
