export const meta = {
  id: "dod", events: ["Stop"], blocking: true, failClosed: true,
  timeoutMs: 4000, handlerTimeoutMs: 30000, canaryCase: "dod-incomplete",
};
export async function check(ctx) {
  return ctx?.event?.evidence_complete === true
    ? { verdict: "pass" }
    : { verdict: "block", reason: "evidence bundle is incomplete" };
}
