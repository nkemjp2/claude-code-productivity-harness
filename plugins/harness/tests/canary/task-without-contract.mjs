import { stageRepo } from "./_stage.mjs";

/** A task created with no contract, so nothing downstream could check it. */
export const meta = { gate: "task-created", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ contract: false });
  return {
    root,
    event: { hook_event_name: "TaskCreated", session_id: "canary", cwd: root, task_id: "CANARY-NEW" },
  };
}
