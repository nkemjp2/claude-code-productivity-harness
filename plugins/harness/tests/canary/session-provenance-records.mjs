import { stageRepo } from "./_stage.mjs";

/** SessionStart cannot block; what it must do is record. */
export const meta = { gate: "session-provenance", expect: "pass" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true });
  return { root, event: { hook_event_name: "SessionStart", session_id: "canary", cwd: root, source: "fork" } };
}
