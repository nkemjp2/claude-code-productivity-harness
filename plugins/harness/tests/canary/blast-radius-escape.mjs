import { stageRepo, writeEvent } from "./_stage.mjs";

/** A write to infrastructure, from a task whose contract declares only src/**. */
export const meta = { gate: "blast-radius", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true, blastRadius: ["src/**"] });
  return { root, event: writeEvent(root, "infra/production.tf") };
}
