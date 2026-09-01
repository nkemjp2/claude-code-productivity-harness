import { matchesGlob, relativePath } from "../lib/task.mjs";

/**
 * Effort routing, and an honest account of what it cannot do (R-G6.1, G6.3).
 *
 * The design wanted a model floor on protected-path work, enforced by
 * `PreModelSwitch`. That event does not exist in the client (ADR-0003), so no
 * hook can block a model switch and the floor is unbuildable.
 *
 * What IS available is `CLAUDE_EFFORT`, confirmed present in a spawned
 * environment. So this observes the effort actually in force when protected
 * paths are touched and says so — which is the honest remainder of the
 * requirement rather than a substitute pretending to be the whole thing. It
 * warns; it does not claim to have enforced a floor.
 */
export const meta = {
  id: "effort-routing",
  events: ["PreToolUse"],
  matcher: "Edit|Write|NotebookEdit",
  blocking: false,
  failClosed: false,
  timeoutMs: 3000,
  handlerTimeoutMs: 10000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "effort-on-protected-path",
};

const PROTECTED = [
  ".github/workflows/**",
  "**/migrations/**",
  "*.lock",
  "**/*.lock",
  ".harness/policy.yaml",
  ".claude/settings.json",
];

/**
 * @param {import("../lib/context.mjs").GateContext & { effort?: string }} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const target = ctx?.event?.tool_input?.file_path;
  if (typeof target !== "string" || target === "") return { verdict: "pass" };

  const effort = String(ctx.effort ?? process.env.CLAUDE_EFFORT ?? "").toLowerCase();
  if (effort === "" || effort === "high" || effort === "max") return { verdict: "pass" };

  const rel = relativePath(ctx.root, target);
  if (!PROTECTED.some((p) => matchesGlob(p, rel))) return { verdict: "pass" };

  return {
    verdict: "warn",
    message:
      `${rel} is a protected path and the session is running at '${effort}' effort. The design asks ` +
      "for a model floor here, but PreModelSwitch does not exist in this client, so nothing can block " +
      "a switch — this is an observation, not an enforced floor. Raise the effort deliberately if the " +
      "change warrants it.",
  };
}
