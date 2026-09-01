/**
 * Licence enforcement (M24, R-L6.3).
 *
 * The direction matters more than the list. An unrecognised licence must FAIL,
 * not pass: defaulting unknown to allowed is precisely how copyleft reaches a
 * plugin that is installed across every repository, and it does so silently,
 * because nobody reviews a check that has never failed.
 *
 * @typedef {{ allowed: string[], deniedFamilies: string[], vendoredPaths?: string[] }} Allowlist
 */

/**
 * @param {{ dependencies?: Record<string, string>, devDependencies?: Record<string, string> }} manifest
 *   package name to declared licence
 * @param {Allowlist} allowlist
 * @returns {string[]} problems, empty when every licence is permitted
 */
export function checkLicences(manifest, allowlist) {
  /** @type {string[]} */
  const problems = [];
  const entries = { ...(manifest.dependencies ?? {}), ...(manifest.devDependencies ?? {}) };

  for (const [name, licence] of Object.entries(entries)) {
    const value = String(licence ?? "").trim();
    const family = allowlist.deniedFamilies.find((f) => value.toUpperCase().startsWith(f.toUpperCase()));
    if (family !== undefined) {
      problems.push(
        `${name} is licensed ${value}, which is in the denied ${family} family. This plugin installs ` +
          "into every repository that adopts it, so copyleft terms would travel with it.",
      );
      continue;
    }
    if (!allowlist.allowed.includes(value)) {
      problems.push(
        `${name} is licensed '${value}', which is not on the allowlist. An unknown licence is refused ` +
          "rather than assumed permissive — defaulting unknown to allowed is how copyleft gets in unnoticed.",
      );
    }
  }
  return problems;
}
