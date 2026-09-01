import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "../lib/yaml.mjs";
import { loadManifest } from "../lib/manifest.mjs";

/**
 * `harness status` — what is actually on.
 *
 * The distinction this exists to draw is between a ratchet holding a measured
 * number and one holding nothing. In `policy.yaml` they look alike, and
 * reading the file is exactly how somebody comes to believe the second is the
 * first — then acts as though a standard is enforced when nothing has ever
 * measured it.
 *
 * It also names what it cannot yet report. A status page that silently omits
 * escalations and gate-firing looks like a system with none of either, which
 * is the most flattering possible lie about a control system.
 *
 * @typedef {{ name: string, measured: boolean, value: unknown, note: string }} RatchetView
 * @typedef {{ name: string, required: boolean, command: string }} VerbView
 * @typedef {{ ts: string, from: string, to: string, reason: string }} ModeChange
 * @typedef {{ mode: string, enabled: boolean, ratchets: RatchetView[], verbs: VerbView[],
 *             modeChanges: ModeChange[], summary: string, deferred: string[] }} StatusReport
 */

/** @param {string} root */
function readEvents(root) {
  const dir = join(root, ".harness", "events");
  if (!existsSync(dir)) return [];
  /** @type {any[]} */
  const out = [];
  for (const file of readdirSync(dir)) {
    if (!file.endsWith(".jsonl")) continue;
    for (const line of readFileSync(join(dir, file), "utf8").split("\n")) {
      if (line.trim() === "") continue;
      try {
        out.push(JSON.parse(line));
      } catch {
        // A torn record is itself a finding, but not one status should crash
        // on. M26's per-process files exist so this stays rare.
      }
    }
  }
  return out;
}

/**
 * @param {{ root: string }} opts
 * @returns {Promise<StatusReport>}
 */
export async function runStatus(opts) {
  const policyPath = join(opts.root, ".harness", "policy.yaml");
  if (!existsSync(policyPath)) {
    throw new Error(`no .harness/policy.yaml in ${opts.root}; the harness is not initialised here`);
  }

  const policy = parse(readFileSync(policyPath, "utf8"));
  const mode = typeof policy["mode"] === "string" ? policy["mode"] : "unknown";
  const enabled = policy["enabled"] !== false;

  /** @type {RatchetView[]} */
  const ratchets = [];
  const rawRatchets = policy["ratchets"];
  if (typeof rawRatchets === "object" && rawRatchets !== null && !Array.isArray(rawRatchets)) {
    for (const [name, value] of Object.entries(rawRatchets)) {
      const entry = /** @type {Record<string, unknown>} */ (value ?? {});
      ratchets.push({
        name,
        measured: entry["measured"] === true,
        value: entry["measured"] === true ? entry["value"] : null,
        note: typeof entry["note"] === "string" ? entry["note"] : "",
      });
    }
  }

  const manifest = loadManifest(opts.root);
  /** @type {VerbView[]} */
  const verbs = Object.entries(manifest?.verbs ?? {}).map(([name, spec]) => ({
    name,
    required: spec.required,
    command: spec.command,
  }));

  const modeChanges = readEvents(opts.root)
    .filter((r) => r.event === "harness.mode")
    .map((r) => ({ ts: String(r.ts), from: String(r.from), to: String(r.to), reason: String(r.reason) }));

  const enforcing = ratchets.filter((r) => r.measured).length;
  const declared = ratchets.length - enforcing;
  const summary =
    `mode ${mode}${enabled ? "" : " (disabled)"} · ${enforcing} ratchet(s) enforcing, ` +
    `${declared} declared but unmeasured · ${verbs.length} verb(s) configured`;

  return {
    mode,
    enabled,
    ratchets,
    verbs,
    modeChanges,
    summary,
    deferred: [
      "gates that have not fired this week — needs the gate registry from Phase 4",
      "open escalations — the escalation record ships with the Stop gate in Phase 4",
      "rules past their review date — the instruction corpus is Phase 6 work",
    ],
  };
}

/**
 * @param {StatusReport} report
 * @returns {string}
 */
export function formatStatus(report) {
  const lines = ["harness status", "", `  ${report.summary}`, "", "  ratchets"];
  for (const r of report.ratchets) {
    lines.push(
      r.measured
        ? `    ENFORCING  ${r.name} = ${String(r.value)}`
        : `    declared   ${r.name} — ${r.note}`,
    );
  }
  lines.push("", "  verbs");
  for (const v of report.verbs) {
    lines.push(`    ${v.required ? "required" : "optional"}  ${v.name} -> ${v.command}`);
  }
  if (report.modeChanges.length > 0) {
    lines.push("", "  mode changes");
    for (const c of report.modeChanges) lines.push(`    ${c.ts}  ${c.from} -> ${c.to}: ${c.reason}`);
  }
  lines.push("", "  not yet reported");
  for (const d of report.deferred) lines.push(`    ${d}`);
  return `${lines.join("\n")}\n`;
}
