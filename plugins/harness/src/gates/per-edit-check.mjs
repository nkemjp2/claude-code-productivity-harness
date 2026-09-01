/**
 * Per-edit validation (R-L3.1). The highest-yield layer per unit of effort.
 *
 * `PostToolUse` cannot undo the tool — but exit 2 surfaces stderr to Claude,
 * which lands a compiler-grade signal on the very next turn, while the edit is
 * still in working context. Feedback at CI arrives minutes later, to nobody.
 *
 * The verb's own output is passed through verbatim. A summarised type error is
 * a type error the agent has to guess at, and the compiler already wrote the
 * most useful sentence available.
 */
export const meta = {
  id: "per-edit-check",
  events: ["PostToolUse"],
  matcher: "Edit|Write|NotebookEdit",
  blocking: false,
  failClosed: false,
  timeoutMs: 20000,
  handlerTimeoutMs: 45000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "per-edit-typecheck-fails",
  requires: [{ verb: "typecheck", required: false }],
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const target = ctx?.event?.tool_input?.file_path;
  if (typeof target !== "string" || target === "") return { verdict: "pass" };
  if (typeof ctx.runVerb !== "function") return { verdict: "skip", why: "no verb runner in this context" };

  const spec = ctx.manifest?.verbs?.["typecheck"];
  if (spec === undefined) {
    // Not configured is an expected state: `harness init` reports a verb it
    // could not resolve rather than writing it. Skipping keeps work moving.
    return { verdict: "skip", why: "no typecheck verb is configured in .harness/manifest.yaml" };
  }

  const result = await ctx.runVerb("typecheck");
  if (result.code === 0) return { verdict: "pass" };

  // M13/R-F2.4: a REQUIRED tool that cannot run is an error, never a skip. A
  // typechecker that quietly skips is the silently disabled gate this whole
  // design exists to prevent.
  if (result.code === 127 || result.timedOut) {
    return spec.required === true
      ? { verdict: "error", detail: `required verb typecheck could not run: ${result.stderr || "no output"}` }
      : { verdict: "skip", why: `optional verb typecheck could not run: ${result.stderr || "no output"}` };
  }

  return {
    verdict: "block",
    reason:
      `typecheck failed after editing ${target}:\n${(result.stderr || result.stdout).trim()}\n\n` +
      `(${result.command}, exit ${result.code})`,
  };
}
