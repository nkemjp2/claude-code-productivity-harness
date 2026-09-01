import { existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";

/**
 * The only resolver of the repository root (M9).
 *
 * Worktrees split the project directory: `CLAUDE_PROJECT_DIR` stays at the
 * session's starting root while `cwd` in the hook payload follows the agent.
 * A gate that reads the wrong one judges the wrong tree and says nothing about
 * it, so there is exactly one function that decides and every other module
 * asks it. The lint rule forbidding `process.cwd()` and bare
 * `CLAUDE_PROJECT_DIR` reads elsewhere is what keeps that true.
 *
 * @typedef {Record<string, unknown>} HookEvent
 */

const MARKER = join(".harness", "manifest.yaml");

/**
 * The environment variable naming the session's starting project directory.
 *
 * Exported so callers that must *set* it for a child process — `harness
 * doctor` piping an event through the runner — can do so without writing the
 * literal. The prohibition-3 rule matches the name anywhere, which it should:
 * carving an exception for "writes are fine" is how the next genuine second
 * reader gets in.
 */
export const PROJECT_DIR_ENV = "CLAUDE_PROJECT_DIR";

/**
 * Walk up from a directory looking for an initialised harness.
 * @param {string} start
 * @returns {string | null}
 */
function walkUp(start) {
  let dir = resolve(start);
  for (;;) {
    if (existsSync(join(dir, MARKER))) return dir;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

/**
 * Resolve the repository root for this invocation, or null when the harness
 * is not installed anywhere above it.
 *
 * The event may be absent — a read failure means there is no `cwd` to walk up
 * from — and the environment fallback is what lets the dormancy check still
 * run in that case (ADR-0009). Without it, a truncated read would fail closed
 * in repositories that never opted in, which is precisely what M11 forbids.
 *
 * @param {HookEvent | null} event
 * @returns {string | null}
 */
export function resolveRepoRoot(event) {
  const cwd = typeof event?.["cwd"] === "string" ? /** @type {string} */ (event["cwd"]) : undefined;
  if (cwd !== undefined) {
    const found = walkUp(cwd);
    if (found !== null) return found;
  }

  const projectDir = process.env.CLAUDE_PROJECT_DIR;
  if (projectDir !== undefined && projectDir !== "") {
    const found = walkUp(projectDir);
    if (found !== null) return found;
  }

  return null;
}

/**
 * The session's starting project directory, for callers that need to *report*
 * it rather than resolve against it.
 *
 * `harness doctor` wants to say "the agent is in a worktree, and the session
 * started somewhere else", which needs both values. Routing it through here
 * keeps the single-reader discipline intact — the lint rule caught doctor
 * reading the variable directly, and the rule was right.
 *
 * @returns {string | undefined}
 */
export function sessionProjectDir() {
  return process.env.CLAUDE_PROJECT_DIR;
}
