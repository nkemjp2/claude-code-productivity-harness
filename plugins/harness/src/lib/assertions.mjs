/**
 * Assertion density, and the wiring-only pattern (R-L5.6).
 *
 * A bad assertion looks exactly like a test, which is why diff review is weak
 * here. Two shapes are worth catching before the mutation ratchet ever runs,
 * because both are cheap to detect and expensive to discover later:
 *
 *   A test body with no assertion at all. It executes the code, raises
 *   coverage, and establishes nothing.
 *
 *   A test whose only assertion is on a mock call. It asserts that the code
 *   called what it was told to call — a restatement of the implementation,
 *   not a claim about behaviour. It survives almost every mutation.
 *
 * Text analysis, not AST (ADR-0005 reasoning applies). It is a pre-filter
 * ahead of the ratchet, not a proof, and it says so.
 *
 * @typedef {{ tests: number, withoutAssertions: string[], wiringOnly: string[] }} Density
 */

const TEST_OPENER = /\b(?:test|it)\s*\(\s*(['"`])((?:\\.|(?!\1).)*)\1/g;
const ASSERTION = /\b(?:assert|expect|should|chai|t\.(?:is|deepEqual|truthy))\b/;
const MOCK_ONLY =
  /\b(?:toHaveBeenCalled(?:With|Times)?|toBeCalledWith|calledWith|calledOnce|mock\.calls|assertCalled)\b/;
const BEHAVIOURAL =
  /\b(?:toBe|toEqual|toStrictEqual|toMatch|toThrow|toContain|assert\.(?:equal|deepEqual|match|throws|ok)|strictEqual)\b/;

/**
 * @param {string} source
 * @returns {Density}
 */
export function assertionDensity(source) {
  const text = String(source ?? "");
  /** @type {string[]} */
  const withoutAssertions = [];
  /** @type {string[]} */
  const wiringOnly = [];
  let tests = 0;

  const openers = [...text.matchAll(TEST_OPENER)];
  for (const [index, opener] of openers.entries()) {
    tests += 1;
    const name = opener[2] ?? "(unnamed)";
    const start = (opener.index ?? 0) + opener[0].length;
    const end = openers[index + 1]?.index ?? text.length;
    const body = text.slice(start, end);

    if (!ASSERTION.test(body)) {
      withoutAssertions.push(name);
      continue;
    }
    // Asserts something, but only that a mock was called. That is a
    // restatement of the implementation wearing a test's shape.
    if (MOCK_ONLY.test(body) && !BEHAVIOURAL.test(body)) wiringOnly.push(name);
  }

  return { tests, withoutAssertions, wiringOnly };
}
