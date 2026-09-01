import { stageRepo } from "./_stage.mjs";

/**
 * The one canary whose expectation is `pass`.
 *
 * Capture is non-blocking by design: its job is to record, and a recording
 * failure must not halt the loop. What this asserts is that it still RUNS —
 * a capture gate that silently skipped would leave every later Stop gate
 * refusing for want of a bundle nobody was writing.
 */
export const meta = { gate: "evidence-capture", expect: "pass" };
export function event() { return {}; }
export async function stage() {
  const { root } = stageRepo({ plan: true });
  return {
    root,
    event: { hook_event_name: "PostToolBatch", session_id: "canary", cwd: root },
    commit: "canary-commit",
    manifest: { verbs: { typecheck: { command: "node", args: ["--version"], required: false } } },
    runVerb: async (/** @type {string} */ verb) => ({
      verb,
      command: `canary stub for ${verb}`,
      code: 0,
      stdout: "ok",
      stderr: "",
      timedOut: false,
    }),
  };
}
