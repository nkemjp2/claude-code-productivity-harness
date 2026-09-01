import { activeTaskId } from "../lib/task.mjs";
import { captureEvidence } from "../lib/evidence.mjs";

/**
 * Capture the evidence, at the point where the work has already been done.
 *
 * PostToolBatch is where the affected-test run is already occurring, so
 * capturing here costs one run rather than two (C3). Capturing at Stop would
 * mean a full run on every refusal, up to the retry ceiling.
 *
 * Non-blocking on purpose. This gate's job is to *record*, and a recording
 * failure must not halt the loop — the Stop gate is what refuses, and it
 * refuses precisely because the record is absent.
 */
export const meta = {
  id: "evidence-capture",
  events: ["PostToolBatch"],
  blocking: false,
  failClosed: false,
  timeoutMs: 60000,
  handlerTimeoutMs: 120000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "evidence-capture-runs",
  requires: [
    { verb: "typecheck", required: false },
    { verb: "test:affected", required: false },
  ],
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const taskId = activeTaskId(ctx.root);
  if (taskId === null) return { verdict: "skip", why: "no active task to capture evidence for" };
  if (typeof ctx.runVerb !== "function") {
    return { verdict: "skip", why: "no verb runner available in this context" };
  }

  const declared = Object.keys(ctx?.manifest?.verbs ?? {});
  const wanted = ["typecheck", "test:affected", "test"].filter((v) => declared.includes(v));
  const verbs = wanted.length > 0 ? wanted : ["typecheck", "test:affected"];

  await captureEvidence({
    root: ctx.root,
    taskId,
    commit: typeof ctx.commit === "string" ? ctx.commit : "unknown",
    runVerb: ctx.runVerb,
    verbs,
  });

  return { verdict: "pass" };
}
