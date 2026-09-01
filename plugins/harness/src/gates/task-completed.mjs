import { bundleProblems } from "../lib/evidence.mjs";
import { activeTaskId } from "../lib/task.mjs";

/**
 * Completion is a machine predicate over artefacts, not a declaration (P4).
 *
 * The same check as the Stop gate, at the point where a task is marked done.
 * Both exist because they catch different moments: Stop catches the agent
 * finishing a turn, TaskCompleted catches the task being closed, and either
 * can happen without the other.
 */
export const meta = {
  id: "task-completed",
  events: ["TaskCompleted"],
  blocking: true,
  failClosed: true,
  timeoutMs: 5000,
  handlerTimeoutMs: 20000,
  mutatesInput: false,
  securityRelevant: false,
  // Required by the generator for this event: TaskCompleted carries no
  // re-entrancy flag, so without a counter a blocking gate here grinds until
  // the platform ends the session (M6).
  retryCounter: "session+task",
  canaryCase: "task-completed-without-evidence",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const taskId = typeof ctx?.event?.task_id === "string" && ctx.event.task_id !== ""
    ? ctx.event.task_id
    : activeTaskId(ctx.root);
  if (taskId === null) return { verdict: "skip", why: "no task id on the event and no active task" };

  const commit = typeof ctx.commit === "string" ? ctx.commit : "unknown";
  const problems = bundleProblems(ctx.root, taskId, commit);
  if (problems.length === 0) return { verdict: "pass" };

  return {
    verdict: "block",
    reason: `${taskId} cannot be completed: ${problems.join("; ")}`,
  };
}
