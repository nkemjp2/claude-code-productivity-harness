import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { loadGates, canaryCaseExists } from "./registry.mjs";

/**
 * The only writer of `hooks/hooks.json`.
 *
 * Generation solves half the problem: a handler cannot reference a path that
 * does not exist, so the classic silently-disabled gate (M2) becomes
 * impossible. The other half is refusal. A generator that emits a registration
 * the platform cannot honour produces a file that looks correct and enforces
 * nothing — which is the same failure wearing better clothes.
 *
 * So this refuses to build rather than warning, and every refusal names the
 * gate. A refusal that does not say which gate is a refusal nobody can act on.
 */

const PLUGIN_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RUNNER_REF = "${CLAUDE_PLUGIN_ROOT}/src/runner.mjs";

export class GenerationRefused extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = "GenerationRefused";
  }
}

/**
 * Events that can block, read from the generated event map.
 *
 * Read rather than hardcoded: the map is audited against a specific client and
 * regenerated from `docs/event-map.verified.md`, so a gate registered against
 * an event that turns out not to block fails the build instead of shipping.
 *
 * @returns {{ blocking: Set<string>, known: Set<string> }}
 */
function eventCapabilities() {
  const path = join(PLUGIN_ROOT, "src", "generated", "event-map.json");
  const map = JSON.parse(readFileSync(path, "utf8"));
  /** @type {Set<string>} */
  const blocking = new Set();
  /** @type {Set<string>} */
  const known = new Set();
  for (const [name, row] of Object.entries(map.events ?? {})) {
    known.add(name);
    const blocks = String(/** @type {any} */ (row).blocks ?? "").toLowerCase();
    if (blocks.startsWith("yes") || blocks.includes("via decision")) blocking.add(name);
  }
  return { blocking, known };
}

/**
 * A stable hash of the handler content, so the validator can tell an intact
 * stamp on edited content from an intact stamp on generated content.
 *
 * @param {unknown} hooks
 * @returns {string}
 */
export function contentHash(hooks) {
  return createHash("sha256").update(JSON.stringify(hooks)).digest("hex").slice(0, 32);
}

/**
 * Build `hooks.json` from the gate registry, or refuse.
 *
 * @param {{ gateRoot: string, canaryRoot: string, now?: string }} opts
 * @returns {Promise<any>}
 */
export async function generateHooks(opts) {
  const gates = await loadGates(opts.gateRoot);
  const { blocking: canBlock, known } = eventCapabilities();

  /** @type {string[]} */
  const mutators = [];

  for (const gate of gates) {
    const m = gate.meta;
    const events = Array.isArray(m["events"]) ? /** @type {string[]} */ (m["events"]) : [];

    if (events.length === 0) {
      throw new GenerationRefused(`gate '${gate.id}' declares no events; it could never fire`);
    }
    if (typeof m["id"] !== "string") {
      throw new GenerationRefused(`gate '${gate.id}' has no meta.id, so it cannot be addressed by the runner`);
    }

    for (const event of events) {
      if (!known.has(event)) {
        throw new GenerationRefused(
          `gate '${gate.id}' registers on '${event}', which is not in the verified event map. ` +
            "Audit it against the client before building a gate on it.",
        );
      }
      if (m["blocking"] === true && !canBlock.has(event)) {
        throw new GenerationRefused(
          `gate '${gate.id}' declares blocking:true on '${event}', which the verified event map ` +
            "says cannot block (M20). A blocking gate there is decoration that reads as enforcement.",
        );
      }
      if (m["securityRelevant"] === true && event !== "PreToolUse") {
        throw new GenerationRefused(
          `gate '${gate.id}' is securityRelevant and registers on '${event}' (M20). ` +
            "Only PreToolUse or the permission system can prevent an action.",
        );
      }
      if (m["blocking"] === true && (event === "TeammateIdle" || event === "TaskCompleted")) {
        if (m["retryCounter"] === null || m["retryCounter"] === undefined) {
          throw new GenerationRefused(
            `gate '${gate.id}' blocks on '${event}' without meta.retryCounter (M6). ` +
              "Those events carry no re-entrancy flag, so without a counter the harness grinds " +
              "until the platform ends the session.",
          );
        }
      }
    }

    const timeoutMs = m["timeoutMs"];
    const handlerTimeoutMs = m["handlerTimeoutMs"];
    if (typeof timeoutMs !== "number" || typeof handlerTimeoutMs !== "number") {
      throw new GenerationRefused(`gate '${gate.id}' must declare numeric timeoutMs and handlerTimeoutMs`);
    }
    if (!(timeoutMs < handlerTimeoutMs)) {
      throw new GenerationRefused(
        `gate '${gate.id}' has timeoutMs ${timeoutMs} which is not strictly less than ` +
          `handlerTimeoutMs ${handlerTimeoutMs} (M5). The internal watchdog must fire before the ` +
          "platform timeout, or the stall it exists to catch has already failed open.",
      );
    }

    if (m["mutatesInput"] === true) mutators.push(gate.id);

    const canaryCase = m["canaryCase"];
    if (typeof canaryCase !== "string" || canaryCase === "") {
      throw new GenerationRefused(
        `gate '${gate.id}' declares no meta.canaryCase (M2). A gate with no staged violation ` +
          "cannot be shown to still fire.",
      );
    }
    if (!canaryCaseExists(opts.canaryRoot, canaryCase)) {
      throw new GenerationRefused(
        `gate '${gate.id}' names canaryCase '${canaryCase}', which does not exist. ` +
          "Discovery is by explicit field rather than convention precisely so this fails loudly.",
      );
    }
  }

  if (mutators.length > 1) {
    throw new GenerationRefused(
      `more than one gate declares mutatesInput: ${mutators.join(", ")} (M14). ` +
        "updatedInput replaces the whole tool input and matching hooks run in parallel, " +
        "so the second mutation silently clobbers the first.",
    );
  }

  /** @type {Record<string, any[]>} */
  const hooks = {};
  for (const gate of gates) {
    const events = /** @type {string[]} */ (gate.meta["events"]);
    for (const event of events) {
      hooks[event] ??= [];
      /** @type {Record<string, unknown>} */
      const entry = {
        hooks: [
          {
            type: "command",
            // Exec form. Shell form sources the user profile, and one echo in
            // .bashrc prepends text to stdout and breaks every decision object
            // the harness emits (M3).
            command: "node",
            args: [RUNNER_REF, gate.id],
            timeout: gate.meta["handlerTimeoutMs"],
          },
        ],
      };
      if (typeof gate.meta["matcher"] === "string") entry["matcher"] = gate.meta["matcher"];
      if (typeof gate.meta["if"] === "string") entry["if"] = gate.meta["if"];
      hooks[event].push(entry);
    }
  }

  // Defence in depth against M23. By construction every handler points at the
  // runner; asserting it anyway costs nothing and turns a future refactor's
  // mistake into a build failure rather than a live foreign handler.
  for (const list of Object.values(hooks)) {
    for (const entry of list) {
      for (const handler of entry.hooks) {
        if (!handler.args?.[0]?.endsWith("runner.mjs")) {
          throw new GenerationRefused(`generated a handler not pointing at runner.mjs: ${JSON.stringify(handler)}`);
        }
      }
    }
  }

  const body = { hooks };
  return {
    _generated: {
      by: "src/build/generate-hooks.mjs",
      at: opts.now ?? new Date().toISOString(),
      gates: gates.map((g) => g.id),
      contentHash: contentHash(body),
    },
    ...body,
  };
}
