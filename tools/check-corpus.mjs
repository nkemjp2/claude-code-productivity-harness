import { existsSync, readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

import { lintCorpus } from "../plugins/harness/src/lib/corpus.mjs";
import { checkLicences } from "../plugins/harness/src/lib/licence.mjs";

/**
 * Corpus lint and licence check as CI entry points (G2.1, M24).
 *
 * Both fail the build. A licence check that only warns is decoration, and a
 * corpus lint that only warns leaves the contradictions in place — which is
 * the state that produces "it ignored the rule" incidents nobody can diagnose.
 */
const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** @type {{ path: string, text: string }[]} */
const corpus = [];
for (const rel of ["CLAUDE.md"]) {
  const p = join(root, rel);
  if (existsSync(p)) corpus.push({ path: rel, text: readFileSync(p, "utf8") });
}
const rulesDir = join(root, ".claude", "rules");
if (existsSync(rulesDir)) {
  for (const f of readdirSync(rulesDir)) {
    if (f.endsWith(".md")) corpus.push({ path: `.claude/rules/${f}`, text: readFileSync(join(rulesDir, f), "utf8") });
  }
}

const corpusProblems = corpus.length === 0 ? [] : lintCorpus(corpus);
for (const p of corpusProblems) process.stderr.write(`corpus: ${p}\n`);

const pkg = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));
const allowlist = JSON.parse(readFileSync(join(root, ".harness", "licence-allowlist.json"), "utf8"));
// Declared dev dependencies only: this plugin ships no runtime dependencies at
// all, which is the strongest form the M24 countermeasure can take.
const declared = Object.fromEntries(
  Object.keys(pkg.devDependencies ?? {}).map((name) => {
    try {
      return [name, JSON.parse(readFileSync(join(root, "node_modules", name, "package.json"), "utf8")).license ?? "UNKNOWN"];
    } catch {
      return [name, "UNKNOWN"];
    }
  }),
);
const licenceProblems = checkLicences({ devDependencies: declared }, allowlist);
for (const p of licenceProblems) process.stderr.write(`licence: ${p}\n`);

const total = corpusProblems.length + licenceProblems.length;
if (total > 0) {
  process.stderr.write(`\n${total} governance problem(s).\n`);
  process.exitCode = 1;
} else {
  process.stderr.write(`check:governance — clean (${corpus.length} corpus file(s), ${Object.keys(declared).length} dependencies)\n`);
}
