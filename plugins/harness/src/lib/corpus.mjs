/**
 * Instruction-corpus lint (G2.1, R-L2.3).
 *
 * Conflicting instructions across CLAUDE.md, rules files, skills and subagents
 * are a common and genuinely hard-to-diagnose source of nondeterminism: the
 * agent is not ignoring the rule, it is obeying a different one.
 *
 * And rules accumulate. Each is added for one incident and then consumes
 * context budget indefinitely, so a rule with no review date is debt with no
 * maturity date — hence the requirement that each names its incident, its
 * review date, and the gate that enforces it (P5, R-L2.2).
 *
 * @typedef {{ path: string, text: string }} CorpusFile
 */

const CLAIM = /\b(?:always|must|never)\s+(.{4,60}?)\s*[.\n]/gi;

/**
 * @param {CorpusFile[]} files
 * @returns {string[]} problems
 */
export function lintCorpus(files) {
  /** @type {string[]} */
  const problems = [];

  /** @type {Map<string, { path: string, negated: boolean }[]>} */
  const claims = new Map();
  for (const file of files) {
    for (const m of file.text.matchAll(CLAIM)) {
      const negated = /\bnever\b/i.test(m[0] ?? "");
      const predicate = (m[1] ?? "").trim().toLowerCase();
      const list = claims.get(predicate) ?? [];
      list.push({ path: file.path, negated });
      claims.set(predicate, list);
    }
  }
  for (const [predicate, list] of claims) {
    if (list.some((c) => c.negated) && list.some((c) => !c.negated)) {
      const paths = [...new Set(list.map((c) => c.path))];
      problems.push(
        `contradiction: '${predicate}' is both required and forbidden across ${paths.join(" and ")}. ` +
          "Contradictory instructions do not produce a compromise; they produce nondeterminism nobody can diagnose.",
      );
    }
  }

  /** @type {Map<string, string[]>} */
  const sentences = new Map();
  for (const file of files) {
    for (const raw of file.text.split(/\n+/)) {
      const line = raw.trim();
      if (line.length < 25 || line.startsWith("#") || /^(Incident|Review by|Enforced by):/i.test(line)) continue;
      const list = sentences.get(line) ?? [];
      if (!list.includes(file.path)) list.push(file.path);
      sentences.set(line, list);
    }
  }
  for (const [line, paths] of sentences) {
    if (paths.length > 1) {
      problems.push(
        `duplicated across ${paths.join(" and ")}: "${line.slice(0, 60)}". Two copies drift, and the ` +
          "one nobody updates is the one the agent reads.",
      );
    }
  }

  for (const file of files) {
    if (!file.path.includes(".claude/rules/")) continue;
    if (!/Review by:\s*\d{4}-\d{2}-\d{2}/i.test(file.text)) {
      problems.push(
        `${file.path} carries no review date. A rule added for one incident consumes context budget ` +
          "indefinitely unless something forces it to be re-justified (R-L2.3).",
      );
    }
    if (!/Enforced by:/i.test(file.text)) {
      problems.push(
        `${file.path} does not name the gate that enforces it. A rule no gate reads is deleted rather ` +
          "than demoted (P5) — carrying it costs context and buys nothing.",
      );
    }
  }

  return problems;
}
