import { stageRepo, writeEvent } from "./_stage.mjs";

/** An edit in a task that has no plan.md yet. */
export const meta = { gate: "plan-first", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: false });
  return { root, event: writeEvent(root, "src/thing.ts") };
}
