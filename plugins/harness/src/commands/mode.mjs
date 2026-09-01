import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parse } from "../lib/yaml.mjs";
import { appendRecord } from "../lib/log.mjs";

/**
 * `harness mode` — changing the enforcement level, on the record.
 *
 * A mode change is the most consequential thing anybody does to this system,
 * because it is how enforcement gets switched off. If it leaves no trace then
 * "were the gates on?" becomes unanswerable after the fact, and the
 * gate-failure taxonomy in R-M1.3 develops a hole shaped exactly like the
 * period somebody muted it.
 *
 * So the reason is required rather than optional. The mode change with no
 * stated reason is precisely the one you want to read six weeks later.
 */

export class ModeRefused extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "ModeRefused";
  }
}

const MODES = ["dormant", "observe", "enforce"];

/**
 * @param {{ root: string, mode: string, reason: string, sessionId?: string }} opts
 * @returns {Promise<{ from: string, to: string }>}
 */
export async function runMode(opts) {
  const policyPath = join(opts.root, ".harness", "policy.yaml");
  if (!existsSync(policyPath)) {
    throw new ModeRefused(
      `no .harness/policy.yaml in ${opts.root}; the harness is not initialised here. Run 'harness init' first.`,
    );
  }

  if (!MODES.includes(opts.mode)) {
    throw new ModeRefused(`unknown mode '${opts.mode}'. The three modes are: ${MODES.join(", ")}.`);
  }

  const reason = String(opts.reason ?? "").trim();
  if (reason === "") {
    throw new ModeRefused(
      "a reason is required to change mode. This is the change that switches enforcement off, and a " +
        "mode change with no stated reason is the one you most want to read six weeks later.",
    );
  }

  const raw = readFileSync(policyPath, "utf8");
  let from = "unknown";
  try {
    const parsed = parse(raw);
    if (typeof parsed["mode"] === "string") from = parsed["mode"];
  } catch {
    /* recorded as unknown rather than guessed */
  }

  const next = raw.replace(/^mode:.*$/m, `mode: ${opts.mode}`);
  writeFileSync(policyPath, next, "utf8");

  appendRecord(opts.root, opts.sessionId ?? "cli", {
    ts: new Date().toISOString(),
    event: "harness.mode",
    gate: null,
    verdict: "mode-change",
    from,
    to: opts.mode,
    reason,
  });

  return { from, to: opts.mode };
}
