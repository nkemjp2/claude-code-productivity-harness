import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "./yaml.mjs";

/**
 * Enforcement policy: whether the harness is on, and how hard.
 *
 * `observe` is the mode `harness init` leaves a repository in, and it is the
 * reason adoption is survivable: every block verdict is downgraded to a logged
 * warn, so a week of real data arrives before anything is refused. A noisy
 * gate is then retired under R-F2.5 rather than trained around.
 *
 * @typedef {"dormant" | "observe" | "enforce"} Mode
 * @typedef {{ enabled: boolean, mode: Mode, budgets: Record<string, number> }} Policy
 */

/**
 * Budgets travel with the policy because the gates need them and the runner is
 * the only thing that reads from disk. A gate reaching for policy.yaml itself
 * would be a second reader of the same file, and the two would drift.
 *
 * @type {Policy}
 */
const DEFAULT = { enabled: true, mode: "observe", budgets: {} };

/**
 * @param {string} root
 * @returns {Policy}
 */
export function loadPolicy(root) {
  const path = join(root, ".harness", "policy.yaml");
  if (!existsSync(path)) return DEFAULT;

  let parsed;
  try {
    parsed = parse(readFileSync(path, "utf8"));
  } catch {
    // An unreadable policy is not permission to enforce. Falling back to
    // `observe` keeps the session working and logs everything, which is the
    // conservative direction for a *policy* failure — the opposite call from a
    // gate failure, where fail-closed blocks.
    return DEFAULT;
  }

  const enabled = parsed["enabled"];
  const mode = parsed["mode"];
  const rawBudgets = parsed["budgets"];
  /** @type {Record<string, number>} */
  const budgets = {};
  if (typeof rawBudgets === "object" && rawBudgets !== null && !Array.isArray(rawBudgets)) {
    for (const [k, v] of Object.entries(rawBudgets)) if (typeof v === "number") budgets[k] = v;
  }
  return {
    enabled: enabled === undefined ? DEFAULT.enabled : enabled === true,
    mode: mode === "dormant" || mode === "observe" || mode === "enforce" ? mode : DEFAULT.mode,
    budgets,
  };
}
