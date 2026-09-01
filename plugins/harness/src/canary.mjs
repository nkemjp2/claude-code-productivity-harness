import { loadGates, loadCanaryCase } from "./build/registry.mjs";

/**
 * The canary harness: stage the violation, assert the refusal.
 *
 * A gate with a unit test proves its logic. It proves nothing about whether
 * the gate is still wired in, still loaded, still reached — and that is the
 * failure that makes every other countermeasure worthless, because it is
 * invisible. A gate that has quietly stopped firing produces sessions that
 * look completely normal.
 *
 * Canaries execute the gate module **directly**, with a forced enforce
 * context, never through the installed hook path. `harness init` deliberately
 * leaves a repository in `observe`, where every block is downgraded to a warn,
 * so a canary run through the hooks would fail on every freshly initialised
 * repo — and a preflight that fails by design is a preflight nobody runs.
 *
 * That forced context is a parameter of this module, which the runner's import
 * graph never reaches. It is therefore unreachable from a hook invocation, and
 * a test asserts exactly that. Otherwise this convenience would be an
 * escalation route.
 *
 * @typedef {{ gate: string, case: string, expected: string, actual: string, pass: boolean, detail: string }} CanaryResult
 */

/**
 * @param {{ gateRoot: string, canaryRoot: string, policy?: { enabled: boolean, mode: string } }} opts
 * @returns {Promise<CanaryResult[]>}
 */
export async function runCanaries(opts) {
  const gates = await loadGates(opts.gateRoot);
  /** @type {CanaryResult[]} */
  const results = [];

  for (const gate of gates) {
    const caseName = gate.meta["canaryCase"];
    if (typeof caseName !== "string" || caseName === "") continue;

    /** @type {CanaryResult} */
    const base = { gate: gate.id, case: caseName, expected: "block", actual: "", pass: false, detail: "" };

    try {
      const c = await loadCanaryCase(opts.canaryRoot, caseName);
      const expected = typeof c.meta["expect"] === "string" ? c.meta["expect"] : "block";
      base.expected = expected;

      // The forced context. Enforce regardless of the repository's own policy,
      // because the question a canary answers is "does this gate still
      // refuse?", not "is this repo currently refusing?".
      const ctx = {
        event: c.event(),
        root: opts.policy === undefined ? "/canary" : "/canary",
        policy: { enabled: true, mode: "enforce" },
        forcedEnforce: true,
        gateId: gate.id,
      };

      const outcome = await gate.check(ctx);
      const actual = typeof outcome?.verdict === "string" ? outcome.verdict : "none";
      base.actual = actual;
      base.pass = actual === expected;
      base.detail = base.pass
        ? `staged violation was ${actual} as expected`
        : `expected ${expected}, got ${actual} — the gate is loaded and its verdict is now wrong`;
    } catch (err) {
      base.actual = "error";
      base.detail = `canary threw: ${err instanceof Error ? err.message : String(err)}`;
    }

    results.push(base);
  }

  return results;
}
