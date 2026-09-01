import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

/**
 * The lint engine for the nine prohibitions.
 *
 * These rules are structural checks over source text rather than AST analyses
 * (ADR-0005). The threat model is accident, not evasion: they exist so a tired
 * evening does not leave a `process.exit()` in a gate, and every one ships with
 * a negative fixture proving it fires.
 *
 * @typedef {{ file: string, line: number, message: string }} Violation
 * @typedef {"source" | "hooks"} FileSet
 * @typedef {{
 *   id: string,
 *   prohibition: number,
 *   moat: string,
 *   describe: string,
 *   fileset: FileSet,
 *   appliesTo: (rel: string) => boolean,
 *   check: (text: string, rel: string) => Violation[]
 * }} Rule
 */

/**
 * Blank out comments and string bodies so a rule matches code and not prose.
 *
 * This is the part that decides whether the rules are usable. Without it the
 * words `process.exit` inside a doc comment fire a rule, somebody adds an
 * exception to quiet it, and the exception is where the next real violation
 * hides. Positions and line numbers are preserved so a violation still reports
 * the line it is on.
 *
 * @param {string} src
 * @returns {string}
 */
export function stripNonCode(src) {
  let out = "";
  let i = 0;
  /** @type {null | "line" | "block" | "'" | "\"" | "`"} */
  let mode = null;

  while (i < src.length) {
    const c = src[i];
    const d = src[i + 1];
    const keep = c === "\n" ? "\n" : " ";

    if (mode === null) {
      if (c === "/" && d === "/") { mode = "line"; out += "  "; i += 2; continue; }
      if (c === "/" && d === "*") { mode = "block"; out += "  "; i += 2; continue; }
      if (c === "'" || c === "\"" || c === "`") { mode = c; out += c; i += 1; continue; }
      out += c; i += 1; continue;
    }

    if (mode === "line") {
      if (c === "\n") { mode = null; out += "\n"; } else { out += " "; }
      i += 1; continue;
    }

    if (mode === "block") {
      if (c === "*" && d === "/") { mode = null; out += "  "; i += 2; continue; }
      out += keep; i += 1; continue;
    }

    // Inside a string or template literal.
    if (c === "\\") { out += "  "; i += 2; continue; }
    if (c === mode) { mode = null; out += c; i += 1; continue; }
    out += keep; i += 1;
  }
  return out;
}

/**
 * Line number (1-indexed) of a character offset.
 * @param {string} text
 * @param {number} index
 * @returns {number}
 */
export function lineAt(text, index) {
  let line = 1;
  for (let i = 0; i < index && i < text.length; i += 1) if (text[i] === "\n") line += 1;
  return line;
}

/**
 * Every match of `re` in stripped code, as violations.
 *
 * @param {string} text stripped source
 * @param {string} rel
 * @param {RegExp} re must carry the global flag
 * @param {(m: RegExpExecArray) => string} message
 * @returns {Violation[]}
 */
export function matchAll(text, rel, re, message) {
  /** @type {Violation[]} */
  const out = [];
  let m;
  const rx = new RegExp(re.source, re.flags.includes("g") ? re.flags : re.flags + "g");
  while ((m = rx.exec(text)) !== null) {
    out.push({ file: rel, line: lineAt(text, m.index), message: message(m) });
    if (m[0] === "") rx.lastIndex += 1;
  }
  return out;
}

const IGNORED_DIRS = new Set(["node_modules", ".git", "fixtures"]);

/**
 * Collect files under `root` matching an extension, skipping ignored trees.
 *
 * `fixtures` is skipped deliberately: those files are deliberate violations
 * that exist to prove a rule fires, so linting them would fail the build on
 * purpose-built wrongness.
 *
 * @param {string} root
 * @param {string} ext
 * @returns {string[]} absolute paths
 */
export function collect(root, ext) {
  /** @type {string[]} */
  const found = [];
  /** @param {string} dir */
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      if (IGNORED_DIRS.has(name)) continue;
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else if (name.endsWith(ext)) found.push(p);
    }
  };
  walk(root);
  return found;
}

/**
 * Run every rule over the repository.
 *
 * @param {string} root repository root
 * @param {Rule[]} rules
 * @returns {Violation[]}
 */
export function run(root, rules) {
  /** @type {Violation[]} */
  const violations = [];

  const sources = collect(root, ".mjs");
  const hooks = collect(root, "hooks.json");

  for (const rule of rules) {
    const files = rule.fileset === "source" ? sources : hooks;
    for (const abs of files) {
      const rel = relative(root, abs).split(sep).join("/");
      if (!rule.appliesTo(rel)) continue;
      const raw = readFileSync(abs, "utf8");
      const text = rule.fileset === "source" ? stripNonCode(raw) : raw;
      violations.push(...rule.check(text, rel));
    }
  }
  return violations;
}
