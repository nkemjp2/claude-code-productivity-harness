import { isTestFile, relativePath } from "../lib/task.mjs";

/**
 * Who wrote this test, and in what kind of session (R-L5.2, M7).
 *
 * Two refusals, and the first is the one the moat spec could not previously
 * make.
 *
 * **Fork.** A fork inherits the entire conversation with identical system
 * prompt and tools, so a "test-author" reached by fork has already seen the
 * implementation. `agent_type` cannot see this — it names the role, not the
 * isolation mode — which is why a provenance-only gate returned `pass` for
 * precisely this attack. `SessionStart.source === "fork"` is the discriminator,
 * recorded by session-provenance and correlated here by session id.
 *
 * **Role.** A test written by the implementer, or by the main conversation, is
 * a test written by the thing it is meant to check.
 *
 * When the session's origin was never recorded, this warns rather than passing
 * or blocking. Claiming to know would be the overclaim M7 caught; blocking on
 * missing data would make every session without a recorded start unusable.
 */
export const meta = {
  id: "authoring-provenance",
  events: ["PreToolUse"],
  matcher: "Edit|Write",
  blocking: true,
  failClosed: false,
  timeoutMs: 4000,
  handlerTimeoutMs: 15000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "test-authored-in-fork",
};

const IMPLEMENTER_ROLES = new Set(["implementer", "implementor"]);

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const target = ctx?.event?.tool_input?.file_path;
  if (typeof target !== "string" || target === "") return { verdict: "pass" };
  if (!isTestFile(relativePath(ctx.root, target))) return { verdict: "pass" };

  const sessionId = String(ctx?.event?.session_id ?? "");
  const start = (ctx.events ?? []).find(
    (r) => r?.["event"] === "SessionStart" && r?.["session_id"] === sessionId,
  );
  const source = start?.["session_source"];

  if (source === "fork") {
    return {
      verdict: "block",
      reason:
        `${relativePath(ctx.root, target)} is a test file being written in a FORKED session. A fork ` +
        "inherits the entire parent conversation, so whatever role this session reports, it has " +
        "already seen the implementation — and a test written with the implementation in view is a " +
        "test shaped to pass it. Author tests in a subagent, which gets a genuinely fresh context.",
    };
  }

  const role = ctx?.event?.agent_type;
  if (typeof role === "string" && IMPLEMENTER_ROLES.has(role)) {
    return {
      verdict: "block",
      reason:
        `${relativePath(ctx.root, target)} is being written by the '${role}' role. The implementer ` +
        "does not author its own tests (R-L5.2): a test written by the thing it checks tends to " +
        "check what that thing happens to do.",
    };
  }

  if (source === undefined) {
    return {
      verdict: "warn",
      message:
        `this session's origin was never recorded, so whether it is a fork is unknown. The ` +
        "authoring-provenance check cannot make a claim here, and says so rather than passing " +
        "silently — register the session-provenance gate on SessionStart to close this.",
    };
  }

  return { verdict: "pass" };
}
