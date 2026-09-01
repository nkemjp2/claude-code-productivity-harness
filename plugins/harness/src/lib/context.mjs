/**
 * The context every gate receives, in one place.
 *
 * A gate is a pure-ish function of this object. Everything it needs to decide
 * arrives here, which is what keeps gates testable without a database, a
 * client, or a clock — the same reason judgement lives in pure functions
 * throughout this codebase.
 *
 * Note what is NOT here: no way to write to stdout, no exit code, no logger.
 * A gate returns a verdict and the runner does the rest, so there is no path
 * on which a gate can accidentally exit 1 or corrupt a decision payload.
 *
 * @typedef {{
 *   verb: string,
 *   command: string,
 *   code: number,
 *   stdout: string,
 *   stderr: string,
 *   timedOut: boolean
 * }} VerbResult
 *
 * @typedef {{
 *   event: Record<string, any>,
 *   root: string,
 *   policy: { enabled: boolean, mode: string, budgets?: Record<string, number> },
 *   manifest?: { verbs: Record<string, { command: string, args?: string[], required: boolean }> } | null,
 *   gateId?: string,
 *   commit?: string,
 *   events?: Record<string, any>[],
 *   runVerb?: (verb: string) => Promise<VerbResult>,
 *   forcedEnforce?: boolean
 * }} GateContext
 *
 * @typedef {{
 *   verdict: "pass" | "skip" | "block" | "warn" | "error",
 *   reason?: string,
 *   message?: string,
 *   why?: string,
 *   detail?: string,
 *   escalate?: boolean
 * }} Verdict
 */

export {};
