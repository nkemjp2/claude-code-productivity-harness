import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { appendRecord, readRecords } from "./log.mjs";

/**
 * The improvement loop: replay, classification, codification (M1.4, M2, M3).
 *
 * The part of a retrospective that belongs in code is the part that refuses to
 * let a classification exist without its mandated remedy. Everything else is a
 * conversation; this is the bit that stops the conversation evaporating.
 *
 * @typedef {"missing-context" | "missing-gate" | "missing-rule" | "ambiguous-contract" | "model-error"} Classification
 */

/** @type {ReadonlySet<Classification>} */
export const CLASSIFICATIONS = new Set([
  "missing-context",
  "missing-gate",
  "missing-rule",
  "ambiguous-contract",
  "model-error",
]);

/**
 * M3.1's mapping, verbatim in effect: each classification has exactly one
 * mandated remedy, and each remedy names the artefact that must exist
 * afterwards. "Add a gate" is advice; "a gate plus a canary case" is a
 * checkable outcome — and a gate with no canary is the failure M2 describes.
 *
 * @type {Record<string, string>}
 */
export const REMEDIES = {
  "missing-context": "a new or corrected rule file, plus a load-verification check that it reached context",
  "missing-gate": "a new gate, plus the canary case that proves it fires — a gate with no canary cannot be shown to still work",
  "missing-rule": "the rule, plus the gate that enforces it; an unenforced rule is deleted rather than demoted (P5)",
  "ambiguous-contract": "a change to the contract template, so the next task cannot be written the same way",
  "model-error": "a prompt or subagent change, plus an eval-set case so the change is measured rather than assumed",
};

/**
 * Everything belonging to one session, addressable together (R-M1.4).
 *
 * @param {string} root
 * @param {string} sessionId
 * @returns {{ sessionId: string, events: Record<string, any>[], transcriptPath: string | null,
 *             evidenceBundles: string[], note: string }}
 */
export function resolveSession(root, sessionId) {
  const events = readRecords(root).filter((r) => r["session_id"] === sessionId);
  const withTranscript = events.find((r) => typeof r["transcript_path"] === "string");

  /** @type {string[]} */
  const bundles = [];
  const tasksDir = join(root, ".harness", "tasks");
  if (existsSync(tasksDir)) {
    for (const task of readdirSync(tasksDir)) {
      const manifest = join(tasksDir, task, "evidence", "manifest.yaml");
      if (existsSync(manifest)) bundles.push(manifest);
    }
  }

  return {
    sessionId,
    events,
    transcriptPath: withTranscript === undefined ? null : String(withTranscript["transcript_path"]),
    evidenceBundles: bundles,
    note: events.length === 0 ? `no events recorded for session ${sessionId}` : "",
  };
}

/**
 * Record a classification with its mandated remedy.
 *
 * @param {string} root
 * @param {{ incident: string, classification: string, note: string }} input
 * @returns {{ classification: string, remedy: string }}
 */
export function classify(root, input) {
  const incident = String(input.incident ?? "").trim();
  if (incident === "") {
    throw new Error(
      "a classification must name the incident it came from (R-L2.2). Without the link, the rule it " +
        "produces accumulates with nothing to review it against.",
    );
  }

  if (!CLASSIFICATIONS.has(/** @type {Classification} */ (input.classification))) {
    throw new Error(
      `'${input.classification}' is not one of the five classifications: ${[...CLASSIFICATIONS].join(", ")}. ` +
        "The five exist so that every escaped defect maps to a remedy; a sixth bucket is a defect with no remedy.",
    );
  }

  const remedy = REMEDIES[input.classification] ?? "";
  appendRecord(root, "cli", {
    ts: new Date().toISOString(),
    session_id: "cli",
    event: "harness.classify",
    verdict: "classified",
    incident,
    classification: input.classification,
    remedy,
    note: input.note,
  });

  return { classification: input.classification, remedy };
}
