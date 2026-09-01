import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { platform, arch } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadManifest } from "../lib/manifest.mjs";
import { sessionProjectDir, PROJECT_DIR_ENV } from "../lib/repo.mjs";
import { runCanaries } from "../canary.mjs";
import { runChild } from "../lib/exec.mjs";
import { detectClientVersion } from "../lib/client.mjs";
import { resolveVerbCommand } from "../lib/probe.mjs";

/**
 * `harness doctor` — the preflight that makes the rest trustworthy.
 *
 * Almost everything the harness depends on is invisible when it breaks. A
 * handler path that stopped resolving, a verb whose binary is missing on this
 * machine, a `.cmd` shim that cannot be spawned in exec form, a foreign
 * handler somebody added in their own settings file: each produces a session
 * that looks entirely normal and enforces less than you believe.
 *
 * So doctor asks the questions whose answers cannot be inferred from source,
 * and it asks them by doing rather than by reading — piping a real event
 * through the real runner, resolving each verb against this machine's PATH,
 * and executing every canary.
 *
 * @typedef {{ name: string, status: "pass" | "fail" | "warn", detail: string }} Check
 * @typedef {{ checks: Check[], ok: boolean }} Report
 */

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

/**
 * Handlers in a merged settings file that the harness did not generate (M23).
 *
 * This is the one check that can only be made here. A foreign handler lives in
 * somebody's settings file, not in this repository, so no lint rule and no
 * validator can see it — and it sits entirely outside the verdict protocol.
 *
 * @param {string[]} settingsFiles
 * @returns {{ source: string, detail: string }[]}
 */
export function foreignHandlers(settingsFiles) {
  /** @type {{ source: string, detail: string }[]} */
  const found = [];
  for (const file of settingsFiles) {
    if (!existsSync(file)) continue;
    /** @type {any} */
    let parsed;
    try {
      parsed = JSON.parse(readFileSync(file, "utf8"));
    } catch {
      continue;
    }
    for (const entries of Object.values(parsed?.hooks ?? {})) {
      for (const entry of /** @type {any[]} */ (entries ?? [])) {
        for (const handler of entry?.hooks ?? []) {
          const first = handler?.args?.[0];
          const points = typeof first === "string" && first.endsWith("runner.mjs");
          if (!points) {
            found.push({
              source: file,
              detail:
                `handler '${handler?.command ?? "?"} ${(handler?.args ?? []).join(" ")}' does not go ` +
                "through the harness runner, so it has its own exit codes, its own stdout, no " +
                "dormancy check, no watchdog and no event record (M23).",
            });
          }
        }
      }
    }
  }
  return found;
}

/**
 * @param {{ root: string, gateRoot?: string, canaryRoot?: string, settingsFiles?: string[] }} opts
 * @returns {Promise<Report>}
 */
export async function runDoctor(opts) {
  /** @type {Check[]} */
  const checks = [];
  const gateRoot = opts.gateRoot ?? join(PLUGIN_ROOT, "src", "gates");
  const canaryRoot = opts.canaryRoot ?? join(PLUGIN_ROOT, "tests", "canary");

  checks.push({ name: "platform", status: "pass", detail: `${platform()} ${arch()}` });

  const major = Number.parseInt(process.versions.node.split(".")[0] ?? "0", 10);
  checks.push({
    name: "node version",
    status: major >= 20 ? "pass" : "fail",
    detail: `node ${process.versions.node} (minimum 20)`,
  });

  // The client version, and whether we are guessing at it. The hook payload
  // carries no version field on 2.1.247, so the environment is the only
  // source, and an assumed version is a materially weaker claim.
  let audited = "unknown";
  try {
    audited = JSON.parse(readFileSync(join(PLUGIN_ROOT, "src", "generated", "event-map.json"), "utf8")).auditedVersion;
  } catch {
    /* reported below */
  }
  const detected = detectClientVersion(process.env, audited);
  checks.push({
    name: "client version",
    status: detected.source === "assumed" ? "warn" : detected.version === audited ? "pass" : "warn",
    detail:
      detected.source === "assumed"
        ? `no version could be read from the environment, so the audited ${audited} is assumed. ` +
          "Every gate's version guard is running on an assumption."
        : detected.version === audited
          ? `client ${detected.version} (via ${detected.source}), matching the audited event map`
          : `client ${detected.version} (via ${detected.source}) but the event map was audited ` +
            `against ${audited}. Re-run the audit before trusting a gate's minVersion.`,
  });

  const manifest = loadManifest(opts.root);
  if (manifest === null) {
    checks.push({
      name: "runtime dependencies",
      status: "warn",
      detail: "no .harness/manifest.yaml here, so the harness is dormant in this repository",
    });
  } else {
    /** @type {string[]} */
    const missingRequired = [];
    /** @type {string[]} */
    const missingOptional = [];
    /** @type {string[]} */
    const resolved = [];
    for (const [verb, spec] of Object.entries(manifest.verbs)) {
      const path = resolveVerbCommand(spec.command, opts.root);
      if (path === null) (spec.required ? missingRequired : missingOptional).push(`${verb} (${spec.command})`);
      else resolved.push(`${verb} -> ${path}`);
    }
    checks.push({
      name: "runtime dependencies",
      status: missingRequired.length > 0 ? "fail" : missingOptional.length > 0 ? "warn" : "pass",
      detail:
        missingRequired.length > 0
          ? `required verb(s) unresolvable: ${missingRequired.join(", ")}. A required tool that ` +
            "quietly skips is the silently disabled gate this design exists to prevent (M13)."
          : missingOptional.length > 0
            ? `optional verb(s) unresolvable, will skip: ${missingOptional.join(", ")}`
            : resolved.length > 0
              ? resolved.join("; ")
              : "no verbs declared",
    });
  }

  // JSON purity, observed rather than asserted: pipe an event through the real
  // runner and require stdout to be exactly one JSON object or nothing.
  //
  // Run against a scratch repository, NOT the one being inspected. Doing it in
  // place left __doctor_probe__ records in .harness/events/ on every run — and
  // that log is the substrate every R-M1.3 metric computes from, so a
  // diagnostic writing into it corrupts the gate-failure taxonomy with a gate
  // that does not exist. The property under test is environmental (no shell,
  // one writer, clean stdout), so a scratch root exercises it just as well.
  const scratch = mkdtempSync(join(tmpdir(), "harness-doctor-probe-"));
  mkdirSync(join(scratch, ".harness"), { recursive: true });
  writeFileSync(join(scratch, ".harness", "manifest.yaml"), "verbs: {}\n", "utf8");
  writeFileSync(join(scratch, ".harness", "policy.yaml"), "enabled: true\nmode: observe\n", "utf8");

  const runner = join(PLUGIN_ROOT, "src", "runner.mjs");
  const probe = await runChild(process.execPath, [runner, "__doctor_probe__"], {
    cwd: scratch,
    timeoutMs: 10_000,
    env: { [PROJECT_DIR_ENV]: scratch },
  });
  let purity = "pass";
  let purityDetail = "stdout carried nothing, which is a clean result for an unknown gate";
  if (probe.stdout.trim() !== "") {
    try {
      JSON.parse(probe.stdout);
      purityDetail = "stdout parsed as exactly one JSON object";
    } catch {
      purity = "fail";
      purityDetail =
        `stdout was not parseable JSON: ${JSON.stringify(probe.stdout.slice(0, 120))}. ` +
        "Something other than emit.mjs is writing to stdout, and every decision this harness " +
        "emits is now unreadable to the client.";
    }
  }
  checks.push({ name: "JSON purity", status: /** @type {any} */ (purity), detail: purityDetail });

  // Worktree resolution (M9). CLAUDE_PROJECT_DIR stays at the session root
  // while cwd follows the agent, so this reports which one is in force.
  const projectDir = sessionProjectDir();
  checks.push({
    name: "worktree resolution",
    status: "pass",
    detail:
      projectDir !== undefined && projectDir !== opts.root
        ? `resolved root ${opts.root} differs from CLAUDE_PROJECT_DIR ${projectDir}; the agent is in a worktree`
        : `resolved root ${opts.root}`,
  });

  const foreign = foreignHandlers(opts.settingsFiles ?? []);
  if (foreign.length > 0) {
    checks.push({
      name: "foreign handlers",
      status: "warn",
      detail: foreign.map((f) => `${f.source}: ${f.detail}`).join(" | "),
    });
  }

  const canaries = existsSync(gateRoot) ? await runCanaries({ gateRoot, canaryRoot }) : [];
  const failed = canaries.filter((c) => !c.pass);
  checks.push({
    name: "canaries",
    status: canaries.length === 0 ? "warn" : failed.length > 0 ? "fail" : "pass",
    detail:
      canaries.length === 0
        ? "no gates registered yet, so nothing was staged"
        : failed.length > 0
          ? failed.map((c) => `${c.gate}: ${c.detail}`).join("; ")
          : `${canaries.length} gate(s) refused their staged violation`,
  });

  return { checks, ok: checks.every((c) => c.status !== "fail") };
}

/**
 * @param {Report} report
 * @returns {string}
 */
export function formatReport(report) {
  const width = Math.max(...report.checks.map((c) => c.name.length));
  const lines = report.checks.map(
    (c) => `  ${c.status.toUpperCase().padEnd(4)}  ${c.name.padEnd(width)}  ${c.detail}`,
  );
  return `harness doctor\n\n${lines.join("\n")}\n\n${report.ok ? "preflight passed" : "PREFLIGHT FAILED"}\n`;
}
