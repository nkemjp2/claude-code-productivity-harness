import { existsSync, readdirSync, readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { platform } from "node:os";
import { join } from "node:path";

/**
 * Verb discovery, by reading what the repository already says about itself.
 *
 * The alternative — asking, or defaulting — produces a manifest full of
 * plausible commands that do not exist here. Every gate then resolves its verb
 * to nothing and, depending on `required`, either blocks all work or skips
 * silently while reporting healthy. The second is worse and is the one that
 * happens, because optional is the safer-looking default.
 *
 * So candidates come from the repository's own CI configuration and package
 * scripts, each is probed, and anything that resolves to nothing is reported
 * rather than written.
 *
 * @typedef {{ verb: string, command: string, args: string[], source: string }} Candidate
 * @typedef {{ candidate: Candidate, resolved: string | null }} ProbeResult
 */

/**
 * Script names mapped to the abstract verbs gates actually invoke.
 *
 * Deliberately conservative. A script called `check` might be a typecheck, a
 * lint, or a deploy; guessing which is how a gate ends up running the wrong
 * command, so unmapped scripts are simply not candidates.
 *
 * @type {Record<string, string>}
 */
const SCRIPT_TO_VERB = {
  test: "test",
  "test:affected": "test:affected",
  typecheck: "typecheck",
  "type-check": "typecheck",
  tsc: "typecheck",
  lint: "lint",
  "lint:diff": "lint:diff",
  build: "build",
  mutate: "mutate:diff",
  "mutate:diff": "mutate:diff",
  arch: "arch:check",
  "arch:check": "arch:check",
  sast: "sast",
  deps: "deps:check",
  "deps:check": "deps:check",
  migrate: "migrate",
};

/**
 * Split a shell-ish command string into an executable and its arguments,
 * without invoking a shell to do it.
 *
 * @param {string} line
 * @returns {{ command: string, args: string[] } | null}
 */
export function splitCommand(line) {
  const parts = String(line ?? "")
    .trim()
    .split(/\s+/)
    .filter((p) => p !== "");
  const command = parts[0];
  if (command === undefined) return null;
  // A command containing shell metacharacters cannot be probed honestly — the
  // thing that would run is the shell, not this binary. Reported, not written.
  if (/[|&;<>$`(){}]/.test(line)) return null;
  return { command, args: parts.slice(1) };
}

/**
 * @param {string} root
 * @returns {Candidate[]}
 */
export function discoverCandidates(root) {
  /** @type {Candidate[]} */
  const found = [];

  const pkgPath = join(root, "package.json");
  if (existsSync(pkgPath)) {
    try {
      const pkg = JSON.parse(readFileSync(pkgPath, "utf8"));
      for (const [name, script] of Object.entries(pkg.scripts ?? {})) {
        const verb = SCRIPT_TO_VERB[name];
        if (verb === undefined) continue;
        const split = splitCommand(String(script));
        if (split === null) continue;
        found.push({ verb, command: split.command, args: split.args, source: `package.json scripts.${name}` });
      }
    } catch {
      /* an unreadable package.json is simply not a source of candidates */
    }
  }

  // CI configuration, read for `run:` lines. Read first and read literally:
  // what CI already does is the closest thing to ground truth about what this
  // repository's commands actually are.
  const workflows = join(root, ".github", "workflows");
  if (existsSync(workflows)) {
    for (const file of readdirSync(workflows)) {
      if (!/\.ya?ml$/.test(file)) continue;
      const text = readFileSync(join(workflows, file), "utf8");
      for (const m of text.matchAll(/^\s*run:\s*(.+)$/gm)) {
        const line = (m[1] ?? "").trim();
        const split = splitCommand(line);
        if (split === null) continue;
        const verbGuess = Object.entries(SCRIPT_TO_VERB).find(([name]) =>
          new RegExp(`\\b${name}\\b`).test(line),
        );
        if (verbGuess === undefined) continue;
        const verb = verbGuess[1];
        if (found.some((c) => c.verb === verb)) continue;
        found.push({ verb, command: split.command, args: split.args, source: `.github/workflows/${file}` });
      }
    }
  }

  return found;
}

/**
 * Resolve a candidate's executable without running it.
 *
 * Never executes the command. A `test` script that actually runs the suite
 * would be a minutes-long side effect during setup, and M10's `.cmd` shims are
 * not real executables — finding that out by trying is how a probe hangs.
 *
 * @param {Candidate} candidate
 * @param {string} root
 * @returns {ProbeResult}
 */
export function probe(candidate, root) {
  const isWindows = platform() === "win32";
  const result = isWindows
    ? spawnSync("where", [candidate.command], { encoding: "utf8", cwd: root })
    : spawnSync("sh", ["-c", `command -v ${JSON.stringify(candidate.command)}`], { encoding: "utf8", cwd: root });
  const first = (result.stdout ?? "").trim().split(/\r?\n/)[0] ?? "";
  return { candidate, resolved: result.status === 0 && first !== "" ? first : null };
}
