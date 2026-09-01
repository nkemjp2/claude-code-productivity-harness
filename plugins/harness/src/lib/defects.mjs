import { appendRecord } from "./log.mjs";

/**
 * The defect side of the substrate (R-L7.3a).
 *
 * Attribution alone is half of it: commits carry the session, model and
 * harness version, but without defect records naming the commits they are
 * attributed to there is no denominator, and O1 — the primary objective this
 * whole system is judged on — stays unmeasurable.
 *
 * That half is a convention enforced at defect close, and this is the part of
 * the convention that belongs in code: recording it, and refusing a defect
 * that names no commit.
 */

/**
 * @param {string} root
 * @param {{ id: string, commits: string[], note: string }} input
 * @returns {{ id: string, commits: string[] }}
 */
export function recordDefect(root, input) {
  const commits = (input.commits ?? []).filter((c) => typeof c === "string" && c.trim() !== "");
  if (commits.length === 0) {
    throw new Error(
      `defect ${input.id} names no commit. Attribution is only half the substrate (R-L7.3a): without ` +
        "the commits a defect is attributed to there is no denominator, and escape rate — the primary " +
        "objective — cannot be computed at all.",
    );
  }

  appendRecord(root, "cli", {
    ts: new Date().toISOString(),
    session_id: "cli",
    event: "harness.defect",
    verdict: "recorded",
    id: input.id,
    commits,
    note: input.note ?? "",
  });

  return { id: input.id, commits };
}

/**
 * @param {{ defects: number, agentAuthoredChanges: number }} input
 * @returns {{ available: boolean, value: any, reason: string }}
 */
export function escapeRate(input) {
  if (input.agentAuthoredChanges === 0) {
    return {
      available: false,
      value: null,
      reason:
        "no agent-authored changes are recorded, so there is no denominator. Reporting 0 here would " +
        "be a claim of perfection assembled from an empty table — the distinction between 'no defects " +
        "escaped' and 'no defects were recorded' is the whole point of this measure.",
    };
  }
  return {
    available: true,
    value: {
      defects: input.defects,
      changes: input.agentAuthoredChanges,
      rate: Number((input.defects / input.agentAuthoredChanges).toFixed(4)),
    },
    reason: "",
  };
}
