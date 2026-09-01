import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/**
 * The mutation ratchet (R-L5.1).
 *
 * Mutation score is the only objective measure of assertion strength: it asks
 * whether the tests notice when the implementation changes. Coverage asks only
 * whether a line ran.
 *
 * Two properties, both learned from how ratchets normally fail:
 *
 *   **It can only tighten.** A ratchet that follows the score downwards is a
 *   report, not a ratchet.
 *
 *   **The first measurement sets the baseline.** Initialising at a target
 *   fires on day one against a standard the repository has never met, and the
 *   credible response to that is to switch the harness off.
 *
 * @typedef {{ verdict: "pass" | "block" | "error", reason?: string, newRatchet?: number, note?: string }} MutationVerdict
 */

/** @param {string} root */
function ratchetPath(root) {
  return join(root, ".harness", "ratchets.json");
}

/**
 * @param {string} root
 * @param {string} name
 * @returns {number | null}
 */
export function readRatchet(root, name) {
  const path = ratchetPath(root);
  if (!existsSync(path)) return null;
  try {
    const value = JSON.parse(readFileSync(path, "utf8"))[name];
    return typeof value === "number" ? value : null;
  } catch {
    return null;
  }
}

/**
 * Write a ratchet, refusing to loosen one.
 *
 * @param {string} root
 * @param {string} name
 * @param {number} value
 * @returns {number} the value actually in force afterwards
 */
export function writeRatchet(root, name, value) {
  const current = readRatchet(root, name);
  const next = current === null ? value : Math.max(current, value);
  /** @type {Record<string, unknown>} */
  let all = {};
  try {
    if (existsSync(ratchetPath(root))) all = JSON.parse(readFileSync(ratchetPath(root), "utf8"));
  } catch {
    all = {};
  }
  all[name] = next;
  writeFileSync(ratchetPath(root), `${JSON.stringify(all, null, 2)}\n`, "utf8");
  return next;
}

/**
 * @param {{ score: number | null, ratchet: number | null }} input
 * @returns {MutationVerdict}
 */
export function judgeMutation(input) {
  if (input.score === null) {
    return {
      verdict: "error",
      reason:
        "no mutation score is available for this change. An absent score is not a passing score — " +
        "reporting one would make the only objective measure of assertion strength optional.",
    };
  }

  if (input.ratchet === null) {
    return {
      verdict: "pass",
      newRatchet: input.score,
      note: `first measurement: baseline set at ${input.score}. Ratchets start at what this repository actually scores, never at a target.`,
    };
  }

  if (input.score < input.ratchet) {
    return {
      verdict: "block",
      reason:
        `mutation score ${input.score} is below the ratchet ${input.ratchet}. Surviving mutants mean ` +
        "the tests do not notice when the implementation changes, so the assertions are weaker than " +
        "they were on the last change.",
    };
  }

  return { verdict: "pass", newRatchet: Math.max(input.ratchet, input.score) };
}
