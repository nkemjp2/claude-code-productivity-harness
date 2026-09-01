import { loadContract } from "../lib/task.mjs";
import { validateCriteria } from "../lib/ears.mjs";

/**
 * A task with no contract is a task with no definition of done (R-L4.3).
 *
 * Rejecting it here is cheap; discovering it at the Stop gate means the work
 * is already done and there is nothing to check it against. Defect rate is a
 * function of task size and spec ambiguity, and this is the only point where
 * ambiguity is still cheap to fix.
 */
export const meta = {
  id: "task-created",
  events: ["TaskCreated"],
  blocking: true,
  failClosed: true,
  timeoutMs: 3000,
  handlerTimeoutMs: 15000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "task-without-contract",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const taskId = ctx?.event?.task_id;
  if (typeof taskId !== "string" || taskId === "") {
    return { verdict: "skip", why: "the event carried no task id" };
  }

  const contract = loadContract(ctx.root, taskId);
  if (contract === null) {
    return {
      verdict: "block",
      reason:
        `${taskId} has no contract at .harness/tasks/${taskId}/contract.yaml. A task with no contract ` +
        "has no declared blast radius and no acceptance criteria, so nothing downstream can check " +
        "whether it was done — the completion gate would have nothing to read.",
    };
  }

  if (contract.malformed === true) {
    return {
      verdict: "block",
      reason: `.harness/tasks/${taskId}/contract.yaml could not be parsed. A malformed contract is not an empty one.`,
    };
  }

  const problems = validateCriteria(contract.criteria);
  if (problems.length > 0) {
    return { verdict: "block", reason: `${taskId}: ${problems.join(" ")}` };
  }

  return { verdict: "pass" };
}
