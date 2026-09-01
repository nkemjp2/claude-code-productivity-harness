import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

/**
 * Stage a repository for a canary.
 *
 * A canary has to run against something real. A gate pointed at a nonexistent
 * root resolves no active task and returns `skip` — and a canary that passes
 * because the gate skipped is exactly the silently-disabled gate the canary
 * suite exists to detect, wearing a green tick.
 *
 * @param {{ plan?: boolean, contract?: boolean, criteria?: string, blastRadius?: string[] }} [opts]
 * @returns {{ root: string, taskId: string }}
 */
export function stageRepo(opts = {}) {
  const root = mkdtempSync(join(tmpdir(), "harness-canary-"));
  const taskId = "CANARY-1";
  mkdirSync(join(root, ".harness", "tasks", taskId), { recursive: true });
  writeFileSync(join(root, ".harness", "manifest.yaml"), "verbs: {}\n");
  writeFileSync(join(root, ".harness", "policy.yaml"), "enabled: true\nmode: enforce\n");
  writeFileSync(join(root, ".harness", "current-task"), `${taskId}\n`);

  if (opts.contract !== false) {
    const radius = opts.blastRadius ?? ["src/**"];
    writeFileSync(
      join(root, ".harness", "tasks", taskId, "contract.yaml"),
      [
        `id: ${taskId}`,
        "blast_radius:",
        ...radius.map((p) => `  - ${JSON.stringify(p)}`),
        "criteria:",
        "  - id: AC-1",
        `    statement: ${opts.criteria ?? "The system shall refuse the staged violation."}`,
        "overrides:",
        "  test_edit: false",
      ].join("\n") + "\n",
    );
  }
  if (opts.plan === true) writeFileSync(join(root, ".harness", "tasks", taskId, "plan.md"), "# Plan\n");
  return { root, taskId };
}

/** @param {string} root @param {string} rel @param {object} [extra] */
export function writeEvent(root, rel, extra = {}) {
  return {
    hook_event_name: "PreToolUse",
    session_id: "canary",
    cwd: root,
    tool_name: "Write",
    tool_input: { file_path: join(root, rel) },
    ...extra,
  };
}
