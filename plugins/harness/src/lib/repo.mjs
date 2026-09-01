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
