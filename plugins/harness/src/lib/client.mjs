/**
 * Which Claude Code client is running, and how sure are we.
 *
 * Every `meta.minVersion` guard rests on this, and getting it is harder than
 * it should be. Established by observation rather than assumption:
 *
 *   - The hook payload carries `session_id`, `transcript_path`, `cwd` and
 *     `prompt_id`, and **no version field** (read from client 2.1.247).
 *   - `CLAUDE_CODE_VERSION` is **not set** in processes the client spawns,
 *     which was found by dumping the environment of one.
 *   - `AI_AGENT` *is* set, as `claude-code_2-1-251_agent`.
 *
 * So `AI_AGENT` is the working source and the provenance travels with the
 * answer. A guard running on a parsed environment string is a materially
 * weaker claim than one running on a declared field, and the event record and
 * `harness doctor` both say which was used rather than presenting a version as
 * though it were reported.
 *
 * The shape of `AI_AGENT` is not a documented contract. If it changes, this
 * degrades to `assumed` rather than guessing — the same refusal the YAML
 * subset parser and the adapter contract make.
 *
 * @typedef {{ version: string, source: "env" | "ai_agent" | "assumed" }} ClientVersion
 */

/**
 * @param {NodeJS.ProcessEnv} env
 * @param {string} auditedFallback
 * @returns {ClientVersion}
 */
export function detectClientVersion(env, auditedFallback) {
  const declared = env["CLAUDE_CODE_VERSION"];
  if (typeof declared === "string" && /^\d+\.\d+\.\d+/.test(declared)) {
    return { version: declared, source: "env" };
  }

  const agent = env["AI_AGENT"];
  if (typeof agent === "string") {
    const m = /^claude-code[_-](\d+)[._-](\d+)[._-](\d+)/.exec(agent);
    if (m !== null) return { version: `${m[1]}.${m[2]}.${m[3]}`, source: "ai_agent" };
  }

  return { version: auditedFallback, source: "assumed" };
}

/**
 * @param {string} a
 * @param {string} b
 * @returns {number} negative when a < b
 */
export function compareVersions(a, b) {
  const pa = a.split(".").map((n) => Number.parseInt(n, 10) || 0);
  const pb = b.split(".").map((n) => Number.parseInt(n, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d;
  }
  return 0;
}
