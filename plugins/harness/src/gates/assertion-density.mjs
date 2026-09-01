import { assertionDensity } from "../lib/assertions.mjs";
import { isTestFile, relativePath } from "../lib/task.mjs";

/**
 * A test body with no assertion fails the gate (R-L5.6).
 *
 * Cheap, and it runs before the mutation ratchet ever does. A test that
 * executes code and asserts nothing raises coverage while establishing
 * nothing, and it is indistinguishable from a real test in a diff.
 */
export const meta = {
  id: "assertion-density",
  events: ["PreToolUse"],
  matcher: "Edit|Write",
  blocking: true,
  failClosed: false,
  timeoutMs: 4000,
  handlerTimeoutMs: 15000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "vacuous-test",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const target = ctx?.event?.tool_input?.file_path;
  const content = ctx?.event?.tool_input?.content ?? ctx?.event?.tool_input?.new_string;
  if (typeof target !== "string" || typeof content !== "string") return { verdict: "pass" };
  if (!isTestFile(relativePath(ctx.root, target))) return { verdict: "pass" };

  const density = assertionDensity(content);
  if (density.withoutAssertions.length > 0) {
    return {
      verdict: "block",
      reason:
        `these tests assert nothing: ${density.withoutAssertions.join(", ")}. A test that runs the ` +
        "code without asserting on it raises coverage and establishes nothing — and it looks exactly " +
        "like a real test in the diff, which is why this is checked rather than reviewed.",
    };
  }

  if (density.wiringOnly.length > 0) {
    return {
      verdict: "warn",
      message:
        `these tests assert only that a mock was called: ${density.wiringOnly.join(", ")}. That is a ` +
        "restatement of the implementation rather than a claim about behaviour, and it survives almost " +
        "every mutation.",
    };
  }

  return { verdict: "pass" };
}
