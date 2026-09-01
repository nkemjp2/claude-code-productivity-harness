import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "./yaml.mjs";

/**
 * The toolchain adapter: abstract verbs resolved to real commands (R-F1.1).
 *
 * Gates invoke verbs — `typecheck`, `test:affected` — and never commands, so
 * the same gate works across stacks. Each verb declares whether it is
 * required: a missing optional tool degrades to `skip` with a warning, while a
 * missing required tool is an error, because a typechecker that quietly skips
 * is the silently disabled gate this whole design exists to prevent (M13,
 * R-F2.4).
 *
 * @typedef {{ command: string, args?: string[], required: boolean }} Verb
 * @typedef {{ verbs: Record<string, Verb> }} Manifest
 */

/**
 * @param {string} root
 * @returns {Manifest | null} null when the harness is not installed here
 */
export function loadManifest(root) {
  const path = join(root, ".harness", "manifest.yaml");
  if (!existsSync(path)) return null;

  let parsed;
  try {
    parsed = parse(readFileSync(path, "utf8"));
  } catch {
    return { verbs: {} };
  }

  const raw = parsed["verbs"];
  /** @type {Record<string, Verb>} */
  const verbs = {};
  if (typeof raw === "object" && raw !== null && !Array.isArray(raw)) {
    for (const [name, value] of Object.entries(raw)) {
      if (typeof value !== "object" || value === null || Array.isArray(value)) continue;
      const entry = /** @type {Record<string, unknown>} */ (value);
      const command = entry["command"];
      if (typeof command !== "string") continue;
      verbs[name] = { command, required: entry["required"] === true };
    }
  }
  return { verbs };
}
