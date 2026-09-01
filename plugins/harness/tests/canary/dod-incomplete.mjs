import { stageRepo } from "./_stage.mjs";

/** A stop with no evidence bundle at all. */
export const meta = { gate: "dod", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true });
  return {
    root,
    event: { hook_event_name: "Stop", session_id: "canary", cwd: root },
    commit: "canary-commit",
  };
}
