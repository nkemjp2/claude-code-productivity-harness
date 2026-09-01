import { activeTaskId, loadContract, isTestFile, relativePath } from "../lib/task.mjs";

/**
 * No test edits after the first implementation edit in the same task (R-L5.4).
 *
 * Ordering, not prohibition. A same-task ban on editing tests would forbid
 * red-green outright, since R-L5.3 requires the failing test to be authored in
 * this task. What distinguishes writing a test from retrofitting one is *when*:
 * before the implementation exists, or after it does.
 *
 * This closes "make it pass by changing the test", which is the failure a diff
 * reviewer is least able to see, because the diff looks like ordinary work.
 */
export const meta = {
  id: "test-tampering",
  events: ["PreToolUse"],
  matcher: "Edit|Write|NotebookEdit",
  if: null,
  blocking: true,
  failClosed: true,
  timeoutMs: 4000,
  handlerTimeoutMs: 15000,
  mutatesInput: false,
  securityRelevant: false,
  retryCounter: null,
  canaryCase: "test-retrofit",
};

/**
 * @param {import("../lib/context.mjs").GateContext} ctx
 * @returns {Promise<import("../lib/context.mjs").Verdict>}
 */
export async function check(ctx) {
  const target = ctx?.event?.tool_input?.file_path;
  if (typeof target !== "string" || target === "") return { verdict: "pass" };

  const taskId = activeTaskId(ctx.root);
  if (taskId === null) return { verdict: "skip", why: "no active task" };

  const rel = relativePath(ctx.root, target);
  if (!isTestFile(rel)) return { verdict: "pass" };

  // Scoped to this task. Without the scope, the second task of the day could
  // never author a test, because the first one edited an implementation file.
  const priorImplementation = (ctx.events ?? []).find(
    (/** @type {Record<string, any>} */ record) =>
      record?.task === taskId &&
      record?.event === "PreToolUse" &&
      typeof record?.target === "string" &&
      !isTestFile(relativePath(ctx.root, record.target)) &&
      record?.verdict === "pass",
  );

  if (priorImplementation === undefined) return { verdict: "pass" };

  const contract = loadContract(ctx.root, taskId);
  const offending = relativePath(ctx.root, String(priorImplementation.target));

  if (contract?.overrides?.["test_edit"] === true) {
    return {
      verdict: "warn",
      message:
        `editing ${rel} after implementation began, permitted by the test_edit override in ` +
        `.harness/tasks/${taskId}/contract.yaml. The override is recorded here so it is visible in ` +
        "the log rather than only in the contract.",
    };
  }

  return {
    verdict: "block",
    reason:
      `${rel} is a test file, and implementation work already began in this task (${offending}). ` +
      "A test written before the implementation proves something; a test adjusted afterwards proves " +
      "the implementation passes the adjusted test. If the test was genuinely wrong, set " +
      `overrides.test_edit in .harness/tasks/${taskId}/contract.yaml — deliberately, and on the record.`,
  };
}
