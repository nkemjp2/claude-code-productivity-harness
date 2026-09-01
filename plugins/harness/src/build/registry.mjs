import { existsSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";

/**
 * Gate discovery.
 *
 * A gate is a module under the gate root exporting `meta` and `check`. The
 * registry is derived from the filesystem rather than from a hand-maintained
 * list, because a list and a directory drift and the drift is silent — a gate
 * that exists and is not registered looks exactly like a gate that is
 * registered and never fires.
 *
 * @typedef {{ id: string, file: string, meta: Record<string, unknown>, check: Function }} Gate
 */

/**
 * @param {string} gateRoot
 * @returns {Promise<Gate[]>}
 */
export async function loadGates(gateRoot) {
  if (!existsSync(gateRoot)) return [];

  /** @type {Gate[]} */
  const gates = [];
  for (const name of readdirSync(gateRoot).sort()) {
    if (!name.endsWith(".mjs")) continue;
    const file = join(gateRoot, name);
    const mod = await import(pathToFileURL(file).href);
    const id = name.replace(/\.mjs$/, "");
    gates.push({
      id,
      file,
      meta: typeof mod.meta === "object" && mod.meta !== null ? mod.meta : {},
      check: typeof mod.check === "function" ? mod.check : () => ({ verdict: "error" }),
    });
  }
  return gates;
}

/**
 * @param {string} canaryRoot
 * @param {string} caseName
 * @returns {boolean}
 */
export function canaryCaseExists(canaryRoot, caseName) {
  return existsSync(join(canaryRoot, `${caseName}.mjs`));
}

/**
 * @param {string} canaryRoot
 * @param {string} caseName
 * @returns {Promise<{ meta: Record<string, unknown>, event: Function }>}
 */
export async function loadCanaryCase(canaryRoot, caseName) {
  const mod = await import(pathToFileURL(join(canaryRoot, `${caseName}.mjs`)).href);
  return { meta: mod.meta ?? {}, event: typeof mod.event === "function" ? mod.event : () => ({}) };
}
