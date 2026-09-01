import { stageRepo } from "./_stage.mjs";

/** Completion declared with nothing behind it. */
export const meta = { gate: "task-completed", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root, taskId } = stageRepo({ plan: true });
  return {
    root,
    event: { hook_event_name: "TaskCompleted", session_id: "canary", cwd: root, task_id: taskId },
    commit: "canary-commit",
  };
}
