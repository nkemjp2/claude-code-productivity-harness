/**
 * Per-batch validation (R-L3.2).
 *
 * `PostToolBatch` fires after a batch of parallel tool calls resolves and
 * before the next model call, so exit 2 halts the agentic loop rather than
 * merely commenting on it. Diff-scoped lint belongs here: running it per edit
 * would be noise, running it at CI would be too late.
 */
export const meta = {
  id: "per-batch-lint",
  events: ["PostToolBatch"],
  blocking: true,
  failClosed: false,
  timeoutMs: 45000,
  handlerTimeoutMs: 90000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "per-batch-lint-fails",
  requires: [{ verb: "lint:diff", required: false }],
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  if (typeof ctx.runVerb !== "function") return { verdict: "skip", why: "no verb runner in this context" };

  const spec = ctx.manifest?.verbs?.["lint:diff"] ?? ctx.manifest?.verbs?.["lint"];
  if (spec === undefined) return { verdict: "skip", why: "no lint:diff verb is configured" };

  const verb = ctx.manifest?.verbs?.["lint:diff"] !== undefined ? "lint:diff" : "lint";
  const result = await ctx.runVerb(verb);
  if (result.code === 0) return { verdict: "pass" };

  if (result.code === 127 || result.timedOut) {
    return spec.required === true
      ? { verdict: "error", detail: `required verb ${verb} could not run: ${result.stderr || "no output"}` }
      : { verdict: "skip", why: `optional verb ${verb} could not run` };
  }

  return {
    verdict: "block",
    reason: `${verb} failed on this batch:\n${(result.stdout || result.stderr).trim()}\n\n(${result.command}, exit ${result.code})`,
  };
}
