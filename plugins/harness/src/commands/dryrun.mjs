import { spawnSync } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadGates } from "../build/registry.mjs";
import { activeTaskId } from "../lib/task.mjs";

/**
 * `harness dry-run` — what WOULD have fired, over real history.
 *
 * The honest objection to fifteen gates is that nobody knows which are noisy
 * until they have been lived with, and the credibility rule (R-F2.5) says a
 * gate that fires falsely and is not fixed gets removed. That is a week of
 * waiting before the first decision can be made.
 *
 * This shortens it. Recent commits already contain real file changes made by
 * real people solving real problems; replaying them through the gates gives a
 * noise estimate *before* anything blocks, from evidence rather than intuition.
 *
 * It is an estimate and says so. A commit's file list is not a tool call: there
 * is no ordering within a commit, no plan artefact at the time, no session. So
 * this over-reports gates that depend on sequence and under-reports ones that
 * depend on session state. It is calibration, not measurement.
 *
 * @typedef {{ gate: string, fired: number, sampled: number, rate: number, examples: string[] }} GateNoise
 */

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * @param {{ root: string, commits?: number, gateRoot?: string }} opts
 * @returns {Promise<{ files: number, commits: number, gates: GateNoise[], caveat: string }>}
 */
export async function runDryRun(opts) {
  const count = opts.commits ?? 50;
  const log = spawnSync(
    "git",
    ["log", `-${count}`, "--name-only", "--pretty=format:%H", "--no-merges"],
    { cwd: opts.root, encoding: "utf8" },
  );

  /** @type {string[]} */
  const files = [];
  for (const line of (log.stdout ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed === "" || /^[0-9a-f]{40}$/.test(trimmed)) continue;
    if (!files.includes(trimmed)) files.push(trimmed);
  }

  // Resolved against the PLUGIN root, not the repository being surveyed. The
  // first version resolved it against the repo and quietly loaded nothing —
  // reporting "no gate would fire" when no gate had been loaded. That is the
  // silently-disabled-gate failure occurring inside the tool built to measure
  // gate noise, and it is the most dangerous shape this particular report can
  // take, because a reassuring answer is exactly what it looks like.
  const gates = await loadGates(opts.gateRoot ?? join(PLUGIN_ROOT, "src", "gates"));
  if (gates.length === 0) {
    throw new Error(
      `no gates were loaded from ${opts.gateRoot ?? join(PLUGIN_ROOT, "src", "gates")}. A noise survey ` +
        "with no gates reports silence, which is indistinguishable from gates that never fire.",
    );
  }
  const taskId = activeTaskId(opts.root);

  /** @type {GateNoise[]} */
  const results = [];

  for (const gate of gates) {
    const events = /** @type {string[]} */ (gate.meta["events"] ?? []);
    if (!events.includes("PreToolUse")) continue;

    let fired = 0;
    /** @type {string[]} */
    const examples = [];

    for (const file of files) {
      const ctx = {
        event: {
          hook_event_name: "PreToolUse",
          session_id: "dry-run",
          cwd: opts.root,
          tool_name: "Write",
          tool_input: { file_path: join(opts.root, file) },
        },
        root: opts.root,
        policy: { enabled: true, mode: "enforce", budgets: {}, gates: {} },
        events: [],
        manifest: { verbs: {} },
      };
      try {
        const outcome = await gate.check(ctx);
        if (outcome?.verdict === "block") {
          fired += 1;
          if (examples.length < 3) examples.push(file);
        }
      } catch {
        // A gate that throws on a real path is itself a finding, but not one
        // that should end the survey.
      }
    }

    results.push({
      gate: gate.id,
      fired,
      sampled: files.length,
      rate: files.length === 0 ? 0 : Number((fired / files.length).toFixed(3)),
      examples,
    });
  }

  return {
    files: files.length,
    commits: count,
    gates: results.sort((a, b) => b.rate - a.rate),
    caveat:
      `Estimate, not measurement${taskId === null ? " (no active task, so contract-dependent gates skipped)" : ""}. ` +
      "A commit's file list is not a tool call: there is no ordering inside a commit, no plan artefact " +
      "as of then, and no session state. Gates that depend on sequence are under-reported here and " +
      "gates that depend on a contract are over-reported. Use it to rank, not to conclude.",
  };
}

/**
 * @param {Awaited<ReturnType<typeof runDryRun>>} report
 * @returns {string}
 */
export function formatDryRun(report) {
  const lines = [
    `harness dry-run — ${report.files} distinct files across ${report.commits} commits`,
    "",
    "  would-block rate per PreToolUse gate:",
  ];
  for (const g of report.gates) {
    const pct = `${(g.rate * 100).toFixed(1)}%`.padStart(6);
    lines.push(`   ${pct}  ${g.gate.padEnd(22)} ${g.fired}/${g.sampled}${g.examples.length > 0 ? `  e.g. ${g.examples.join(", ")}` : ""}`);
  }
  lines.push("", `  ${report.caveat}`);
  return `${lines.join("\n")}\n`;
}
