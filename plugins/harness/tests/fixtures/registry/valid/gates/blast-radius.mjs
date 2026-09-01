export const meta = {
  id: "blast-radius", events: ["PreToolUse"], matcher: "Edit|Write",
  blocking: true, failClosed: true, timeoutMs: 5000, handlerTimeoutMs: 30000,
  mutatesInput: false, securityRelevant: false, retryCounter: null,
  canaryCase: "blast-radius-escape",
};
export async function check(ctx) {
  const path = String(ctx?.event?.tool_input?.file_path ?? "");
  return path.startsWith("/allowed/")
    ? { verdict: "pass" }
    : { verdict: "block", reason: `write to ${path} is outside the declared blast radius` };
}
