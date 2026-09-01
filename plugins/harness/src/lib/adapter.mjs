/**
 * The adapter boundary (moat §5.2, M24, M25).
 *
 * An external tool enters the harness as a gate's dependency or it does not
 * enter at all. Never as a hook: a tool that registers its own handler picks
 * its own exit codes, writes its own stdout, and has no dormancy check, no
 * watchdog and no event record — one of those reintroduces every failure mode
 * the moat closes (M23).
 *
 * Three refusals at load, each answering a specific way adapters rot:
 *
 *   **Version range.** An upstream that changed its output format silently
 *   starts producing `pass` for everything. Asserting the range at load turns
 *   that into a refusal instead of a quiet all-clear.
 *
 *   **Licence.** Adapters are installed across every repository, so a
 *   copyleft upstream reaching this source is a licensing event, not a bug.
 *
 *   **Process boundary.** Importing an upstream's source is what would carry
 *   its terms in. Spawning it across a text boundary does not.
 *
 * This loader lives in lib/ rather than adapters/ so that adapters/ contains
 * adapters and nothing else — which is what lets the prohibition-6 rule scope
 * itself to that directory without an exemption.
 *
 * @typedef {{ verdict: "pass" | "block" | "warn" | "error", reason?: string }} AdapterVerdict
 * @typedef {{ id: string, upstream: { name: string, versions: string }, licence: string,
 *             invoke: string, parse: (stdout: string, stderr: string, code: number) => AdapterVerdict }} Adapter
 */

import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class AdapterRefused extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "AdapterRefused";
  }
}

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

/** @returns {{ allowed: string[], deniedFamilies: string[] }} */
function allowlist() {
  try {
    return JSON.parse(readFileSync(join(ROOT, ".harness", "licence-allowlist.json"), "utf8"));
  } catch {
    // No allowlist means nothing is allowed. Failing open here would make the
    // licence check advisory, and an advisory licence check is decoration.
    return { allowed: [], deniedFamilies: [] };
  }
}

/**
 * Compare a version against a `>=x.y <z.0` range.
 *
 * Deliberately narrow. A full semver implementation would be a dependency, and
 * a partial one that silently accepts what it does not understand is the M25
 * failure inside the M25 countermeasure.
 *
 * @param {string} version
 * @param {string} range
 * @returns {boolean}
 */
export function inRange(version, range) {
  const parts = range.trim().split(/\s+/);
  const cmp = (/** @type {string} */ a, /** @type {string} */ b) => {
    const pa = a.split(".").map(Number);
    const pb = b.split(".").map(Number);
    for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
      const d = (pa[i] ?? 0) - (pb[i] ?? 0);
      if (d !== 0) return d;
    }
    return 0;
  };
  for (const part of parts) {
    const m = /^(>=|>|<=|<|=)?(\d+(?:\.\d+)*)$/.exec(part);
    if (m === null) throw new AdapterRefused(`unsupported version range '${range}'; use '>=x.y <z.0'`);
    const op = m[1] ?? "=";
    const target = m[2] ?? "0";
    const c = cmp(version, target);
    const ok = op === ">=" ? c >= 0 : op === ">" ? c > 0 : op === "<=" ? c <= 0 : op === "<" ? c < 0 : c === 0;
    if (!ok) return false;
  }
  return true;
}

/**
 * @param {Adapter} adapter
 * @param {string} upstreamVersion the version actually installed
 * @returns {Promise<Adapter>}
 */
export async function loadAdapter(adapter, upstreamVersion) {
  if (adapter.invoke !== "process") {
    throw new AdapterRefused(
      `adapter '${adapter.id}' declares invoke '${adapter.invoke}'. Only 'process' is permitted: an ` +
        "adapter crosses a process boundary so the upstream's licence terms never reach this source (M24).",
    );
  }

  const { allowed, deniedFamilies } = allowlist();
  const licence = String(adapter.licence ?? "");
  if (deniedFamilies.some((f) => licence.toUpperCase().startsWith(f.toUpperCase()))) {
    throw new AdapterRefused(
      `adapter '${adapter.id}' declares licence '${licence}', which is copyleft. This plugin is ` +
        "installed across every repository, so a copyleft upstream in its source is a licensing event.",
    );
  }
  if (!allowed.includes(licence)) {
    throw new AdapterRefused(
      `adapter '${adapter.id}' declares licence '${licence}', which is not on the allowlist in ` +
        ".harness/licence-allowlist.json. An unrecognised licence is refused rather than assumed permissive.",
    );
  }

  if (!inRange(upstreamVersion, adapter.upstream.versions)) {
    throw new AdapterRefused(
      `adapter '${adapter.id}' parses ${adapter.upstream.name} ${adapter.upstream.versions}, but ` +
        `${upstreamVersion} is installed. An upstream outside the declared range may have changed its ` +
        "output format, and an adapter that keeps parsing it silently returns pass for everything (M25).",
    );
  }

  if (typeof adapter.parse !== "function") {
    throw new AdapterRefused(`adapter '${adapter.id}' exports no parse()`);
  }

  return adapter;
}
