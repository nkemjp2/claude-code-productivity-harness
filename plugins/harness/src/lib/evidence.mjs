import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "./yaml.mjs";
import { taskDir } from "./task.mjs";

/**
 * The evidence bundle — written by the runner, never by the agent.
 *
 * This is the load-bearing distinction in the design (R-L4.4a, P4). An
 * agent-authored bundle is an *attestation*: the agent saying the tests
 * passed. That collapses "evidence, not assertion" back into the assertion it
 * was built to replace, and the collapse is invisible, because a bundle the
 * agent wrote and one the runner wrote are the same shape.
 *
 * So provenance lives inside the bundle. Every element records the verb, the
 * exact command, the exit code, and `written_by: runner`. An element without
 * that record is not evidence, and `bundleProblems` says so.
 *
 * @typedef {{ verb: string, command: string, code: number, stdout: string, stderr: string, timedOut: boolean }} VerbResult
 * @typedef {(verb: string) => Promise<VerbResult>} RunVerb
 */

/** Verb name to bundle key. The bundle's vocabulary is stable; the manifest's is per-repo. */
const KEY = { typecheck: "typecheck", "test:affected": "tests_affected", test: "tests_affected", "lint:diff": "lint" };

/** Elements a complete bundle must carry, and why each one matters. */
const REQUIRED = [
  { key: "typecheck", why: "a clean typecheck at this commit" },
  { key: "tests_affected", why: "a green affected-test run at this commit, with the command recorded" },
];

/**
 * Invoke each verb and write what came back. The runner is the only caller.
 *
 * @param {{ root: string, taskId: string, commit: string, runVerb: RunVerb, verbs: string[] }} opts
 * @returns {Promise<Record<string, unknown>>}
 */
export async function captureEvidence(opts) {
  const dir = join(taskDir(opts.root, opts.taskId), "evidence");
  mkdirSync(dir, { recursive: true });

  const existing = readBundle(opts.root, opts.taskId) ?? {};
  /** @type {Record<string, unknown>} */
  const bundle = { ...existing, task: opts.taskId, commit: opts.commit, captured_at: new Date().toISOString() };

  for (const verb of opts.verbs) {
    const result = await opts.runVerb(verb);
    const key = KEY[/** @type {keyof typeof KEY} */ (verb)] ?? verb.replace(/[^a-z0-9]+/gi, "_");
    const outFile = `${key}.txt`;

    writeFileSync(join(dir, outFile), `${result.stdout}\n${result.stderr}`.trim() + "\n", "utf8");

    bundle[key] = {
      status: result.timedOut ? "timeout" : result.code === 0 ? "pass" : "fail",
      verb,
      command: result.command,
      exit_code: result.code,
      output: outFile,
      // The provenance stamp. Its absence is what distinguishes an attestation
      // from evidence, so it is checked rather than assumed.
      written_by: "runner",
    };
  }

  // Mutation is Phase 6. Recorded as unavailable rather than omitted: a
  // missing key reads as an oversight and a zero reads as a measurement, and
  // both are worse than saying plainly that nothing ran.
  bundle["mutation"] = {
    status: "unavailable",
    score: null,
    note:
      "no mutation runner ships in this build (deferred to Phase 6). The bundle records the absence " +
      "rather than a number, because a zero here would read as a measured score of zero.",
  };

  writeFileSync(join(dir, "manifest.yaml"), renderBundle(bundle), "utf8");
  return bundle;
}

/**
 * @param {string} root
 * @param {string} taskId
 * @returns {Record<string, unknown> | null}
 */
export function readBundle(root, taskId) {
  const path = join(taskDir(root, taskId), "evidence", "manifest.yaml");
  if (!existsSync(path)) return null;
  try {
    return parse(readFileSync(path, "utf8"));
  } catch {
    return null;
  }
}

/**
 * What is missing, stale, or failing — one line each, naming the element.
 *
 * "The bundle is incomplete" is not actionable. The agent reading this needs
 * to know which element and why, or the next attempt is a guess.
 *
 * @param {string} root
 * @param {string} taskId
 * @param {string} commit
 * @returns {string[]}
 */
export function bundleProblems(root, taskId, commit) {
  const bundle = readBundle(root, taskId);
  if (bundle === null) {
    return [
      `no evidence bundle exists for ${taskId}. It is written by the runner at PostToolBatch; ` +
        "if none exists, no batch has completed in this task yet.",
    ];
  }

  /** @type {string[]} */
  const problems = [];

  const captured = bundle["commit"];
  if (typeof captured !== "string" || captured === "") {
    problems.push("the bundle records no commit, so nothing can be said about which code it describes");
  } else if (captured !== commit) {
    problems.push(
      `the bundle is stale: captured at ${captured}, current commit is ${commit}. Evidence about ` +
        "an earlier commit is not evidence about this one.",
    );
  }

  for (const { key, why } of REQUIRED) {
    const element = bundle[key];
    if (element === undefined || element === null) {
      problems.push(`${key} is missing from the bundle — it requires ${why}`);
      continue;
    }
    const e = /** @type {Record<string, unknown>} */ (element);
    if (e["status"] !== "pass") {
      problems.push(`${key} did not pass (status ${String(e["status"])}, exit ${String(e["exit_code"])})`);
    }
    if (e["written_by"] !== "runner") {
      problems.push(
        `${key} carries no runner provenance. An element the runner did not write is an attestation, ` +
          "not evidence (R-L4.4a).",
      );
    }
    if (typeof e["command"] !== "string" || e["command"] === "") {
      problems.push(`${key} records no command, so its result cannot be reproduced or checked`);
    }
  }

  return problems;
}

/**
 * Render the bundle in the YAML subset this repository can read back.
 *
 * @param {Record<string, unknown>} bundle
 * @returns {string}
 */
function renderBundle(bundle) {
  const lines = [
    "# Evidence bundle — written by the runner, never by the agent (R-L4.4a).",
    "# Every element records the verb, the exact command and the exit code, so a",
    "# claim in here can be checked rather than believed.",
  ];
  for (const [key, value] of Object.entries(bundle)) {
    if (value === null || value === undefined) {
      lines.push(`${key}: null`);
    } else if (typeof value === "object") {
      lines.push(`${key}:`);
      for (const [k, v] of Object.entries(/** @type {Record<string, unknown>} */ (value))) {
        lines.push(`  ${k}: ${v === null ? "null" : typeof v === "number" || typeof v === "boolean" ? String(v) : JSON.stringify(String(v))}`);
      }
    } else {
      lines.push(`${key}: ${JSON.stringify(String(value))}`);
    }
  }
  return `${lines.join("\n")}\n`;
}
