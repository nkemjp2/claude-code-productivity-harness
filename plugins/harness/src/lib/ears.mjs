/**
 * EARS shape validation — and deliberately nothing more.
 *
 * The notation is borrowed rather than invented because it collapses a
 * requirement into a single testable claim with unambiguous scope, trigger and
 * response. That is what makes criterion-to-test mapping mechanical: a
 * criterion in this shape has exactly one thing to assert.
 *
 * What this cannot decide is whether a well-formed criterion is *true*,
 * achievable, or the one the author meant. None of that is decidable, and a
 * validator implying otherwise would be worse than none — it would put a green
 * tick beside a criterion nobody has thought about, which is the same defect
 * class as a gate that passes because it never ran.
 *
 * So: shape only, and the module says so where anyone reading it will look.
 *
 * @typedef {"ubiquitous" | "event-driven" | "state-driven" | "unwanted-behaviour" | "optional-feature"} EarsPattern
 */

/** @type {ReadonlySet<EarsPattern>} */
export const EARS_PATTERNS = new Set([
  "ubiquitous",
  "event-driven",
  "state-driven",
  "unwanted-behaviour",
  "optional-feature",
]);

/**
 * `shall` is required. "should" and "will" are the words a criterion hides in
 * when nobody has decided whether it is a requirement, and a criterion nobody
 * has decided on cannot be traced to a test.
 */
const SHALL = /\bshall\b/;

/**
 * @param {string} statement
 * @returns {EarsPattern | null} null when it matches no template
 */
export function classify(statement) {
  const s = String(statement ?? "").trim();
  if (s === "" || !SHALL.test(s)) return null;

  if (/^When\s+.+,\s*the\s+.+\bshall\b/i.test(s)) return "event-driven";
  if (/^While\s+.+,\s*the\s+.+\bshall\b/i.test(s)) return "state-driven";
  if (/^If\s+.+,\s*then\s+the\s+.+\bshall\b/i.test(s)) return "unwanted-behaviour";
  if (/^Where\s+.+,\s*the\s+.+\bshall\b/i.test(s)) return "optional-feature";
  if (/^The\s+.+\bshall\b/i.test(s)) return "ubiquitous";
  return null;
}

/**
 * @param {ReadonlyArray<{ id?: string, statement?: string }>} criteria
 * @returns {string[]} problems, empty when every criterion is well shaped
 */
export function validateCriteria(criteria) {
  /** @type {string[]} */
  const problems = [];
  for (const [index, c] of criteria.entries()) {
    const id = typeof c.id === "string" ? c.id.trim() : "";
    if (id === "") {
      problems.push(
        `criterion ${index + 1} has no id. The id appears in the contract, in test names, in the ` +
          "commit trailer and in the pull request body (R-L7.1); an anonymous criterion cannot be traced.",
      );
      continue;
    }
    if (classify(c.statement ?? "") === null) {
      problems.push(
        `${id} matches none of the five EARS templates: ubiquitous ("The <system> shall …"), ` +
          `event-driven ("When <trigger>, the <system> shall …"), state-driven ("While <state>, …"), ` +
          `unwanted-behaviour ("If <trigger>, then the <system> shall …"), optional-feature ` +
          `("Where <feature>, the <system> shall …"). Note this checks shape only; it says nothing ` +
          "about whether the criterion is true.",
      );
    }
  }
  return problems;
}
