/**
 * Record how this session began (M7).
 *
 * The moat spec left this open: whether anything distinguishes a fork from its
 * parent was unverified, and a provenance-only gate would return `pass` for
 * exactly the attack it was written to stop. Reading the client settled it —
 * `SessionStart` carries `source ∈ startup | resume | clear | compact | fork`.
 *
 * So the discriminator exists, but only here. Tool events do not carry it, and
 * `agent_type` names the ROLE rather than the isolation mode. This gate writes
 * the session's origin into the event log so the authoring-provenance gate can
 * correlate by session id on every later write.
 *
 * SessionStart cannot block. This records; it does not refuse.
 */
export const meta = {
  id: "session-provenance",
  events: ["SessionStart"],
  blocking: false,
  failClosed: false,
  timeoutMs: 3000,
  handlerTimeoutMs: 10000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "session-provenance-records",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict & { record?: Record<string, unknown> }>}
 */
export async function check(ctx) {
  const source = typeof ctx?.event?.source === "string" ? ctx.event.source : "unknown";
  return {
    verdict: "pass",
    record: {
      session_source: source,
      agent_type: typeof ctx?.event?.agent_type === "string" ? ctx.event.agent_type : null,
    },
  };
}
