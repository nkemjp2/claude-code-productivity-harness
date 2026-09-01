import { stageRepo } from "./_stage.mjs";

/** A failing diff lint must halt the loop before the next model call. */
export const meta = { gate: "per-batch-lint", expect: "block" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true });
  return {
    root,
    event: { hook_event_name: "PostToolBatch", session_id: "canary", cwd: root },
    manifest: { verbs: { "lint:diff": { command: "node", required: false } } },
    runVerb: async (/** @type {string} */ v) => ({
      verb: v, command: "eslint --diff", code: 1,
      stdout: "src/x.ts:3:7  error  'foo' is assigned a value but never used", stderr: "", timedOut: false,
    }),
  };
}
