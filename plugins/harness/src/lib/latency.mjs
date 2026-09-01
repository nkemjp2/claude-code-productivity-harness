/**
 * Per-gate latency, from the durations already on every record (M5).
 *
 * Hooks run on every matching tool call, so fifteen gates is fifteen processes
 * per edit in the worst case. That is the objection most likely to end an
 * adoption, and it cannot be argued about usefully without numbers — which is
 * why gate duration was recorded from the first phase, before anything needed
 * it.
 *
 * p95 rather than a mean. A gate that is fast on average and occasionally
 * takes four seconds is experienced as a slow gate, and the mean hides exactly
 * that.
 *
 * @typedef {{ gate: string, runs: number, p50: number, p95: number, max: number }} GateLatency
 */

/**
 * @param {ReadonlyArray<Record<string, any>>} log
 * @returns {GateLatency[]} slowest p95 first — the one to fix is the one to see
 */
export function gateLatency(log) {
  /** @type {Map<string, number[]>} */
  const byGate = new Map();
  for (const r of log) {
    const gate = r["gate"];
    const ms = r["duration_ms"];
    if (typeof gate !== "string" || typeof ms !== "number") continue;
    const list = byGate.get(gate) ?? [];
    list.push(ms);
    byGate.set(gate, list);
  }

  /** @param {number[]} sorted @param {number} q */
  const percentile = (sorted, q) => {
    if (sorted.length === 0) return 0;
    const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil(q * sorted.length) - 1));
    return sorted[index] ?? 0;
  };

  return [...byGate.entries()]
    .map(([gate, values]) => {
      const sorted = [...values].sort((a, b) => a - b);
      return {
        gate,
        runs: sorted.length,
        p50: percentile(sorted, 0.5),
        p95: percentile(sorted, 0.95),
        max: sorted[sorted.length - 1] ?? 0,
      };
    })
    .sort((a, b) => b.p95 - a.p95);
}
