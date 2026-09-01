import { activeTaskId, loadContract } from "../lib/task.mjs";

/**
 * Wall-clock budget per task, enforced rather than hoped for (R-G5.1).
 *
 * Checked at PostToolBatch, where the loop already pauses, so the budget is
 * observed between batches rather than mid-edit. Wall clock only: token counts
 * are not present in any hook payload verified against the client, and half a
 * cost measure presented as a budget would be worse than none.
 */
export const meta = {
  id: "budget",
  events: ["PostToolBatch"],
  blocking: true,
  failClosed: false,
  timeoutMs: 4000,
  handlerTimeoutMs: 15000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "budget-exhausted",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const taskId = activeTaskId(ctx.root);
  if (taskId === null) return { verdict: "skip", why: "no active task, so no budget applies" };

  const minutes = Number(loadContract(ctx.root, taskId)?.budget?.["minutes"] ?? 0);
  if (minutes <= 0) return { verdict: "skip", why: `task ${taskId} declares no wall-clock budget` };

  const forTask = (ctx.events ?? []).filter((r) => r?.["task"] === taskId && typeof r?.["ts"] === "string");
  const first = forTask[0];
  if (first === undefined) return { verdict: "pass" };

  const elapsed = (Date.now() - new Date(String(first["ts"])).getTime()) / 60000;
  if (elapsed <= minutes) return { verdict: "pass" };

  return {
    verdict: "block",
    escalate: true,
    reason:
      `${taskId} has run ${Math.round(elapsed)} minutes against a declared budget of ${minutes}. ` +
      "The budget is in the contract because a task that overruns it is usually the wrong size rather " +
      "than nearly finished, and that is a decision to take rather than a limit to raise silently.",
  };
}
