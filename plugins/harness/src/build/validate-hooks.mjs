import { existsSync, readFileSync } from "node:fs";

import { contentHash } from "./generate-hooks.mjs";

/**
 * The CI half of M2 and M23.
 *
 * The generator refuses to build a bad registration. This refuses to accept a
 * `hooks.json` that the generator did not produce — which is the case the
 * generator cannot see, because a hand edit happens after it has run.
 *
 * The lint rule for prohibition 4 checks only that the stamp is present, and
 * says so; this closes the gap it names by checking that the stamp still
 * matches the content underneath it.
 *
 * @param {string} file
 * @returns {string[]} problems, empty when valid
 */
export function validateHooks(file) {
  /** @type {string[]} */
  const problems = [];

  if (!existsSync(file)) return [`${file} does not exist`];

  /** @type {any} */
  let parsed;
  try {
    parsed = JSON.parse(readFileSync(file, "utf8"));
  } catch (err) {
    return [`${file} is not valid JSON: ${err instanceof Error ? err.message : String(err)}`];
  }

  const stamp = parsed?._generated;
  if (stamp === undefined) {
    problems.push(
      `${file} has no _generated stamp, so it was hand-edited (M2). The generator is its only writer.`,
    );
  } else {
    const { _generated, ...body } = parsed;
    const actual = contentHash(body);
    if (typeof stamp.contentHash === "string" && stamp.contentHash !== actual) {
      problems.push(
        `${file} carries a _generated stamp whose content hash no longer matches the file ` +
          `(stamped ${stamp.contentHash}, actual ${actual}). The handlers were edited after generation.`,
      );
    }
  }

  const hooks = parsed?.hooks ?? {};
  for (const [event, entries] of Object.entries(hooks)) {
    if (!Array.isArray(entries)) {
      problems.push(`${event} is not a list of handler entries`);
      continue;
    }
    for (const entry of entries) {
      for (const handler of entry?.hooks ?? []) {
        const first = handler?.args?.[0];
        if (typeof first !== "string" || !first.endsWith("runner.mjs")) {
          problems.push(
            `${event}: handler ${JSON.stringify(handler?.args ?? handler?.command)} does not point at ` +
              "runner.mjs (M23). A handler outside the runner has its own exit codes, its own stdout, " +
              "no dormancy check, no watchdog and no event record.",
          );
        }
      }
    }
  }

  return problems;
}
