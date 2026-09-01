/**
 * Escalation routing (G4.3, R-G4.5).
 *
 * The harness has to decide when to spend human attention, which is the
 * scarcest resource in the loop — so an escalation nobody sees is an
 * escalation that did not happen.
 *
 * Routed through `terminalSequence`, never `/dev/tty`. That is not a style
 * preference: hooks run with no controlling terminal, so a direct terminal
 * write cannot work at all (M4, R-F2.6). The sequence is emitted only in
 * interactive sessions, because a control code nothing will render is noise in
 * a log rather than a notification.
 *
 * @typedef {{ systemMessage: string, terminalSequence?: string }} Escalation
 */

/** OSC 9 — a desktop notification. Built from an escape rather than a literal. */
const OSC = `${String.fromCharCode(27)}]9;`;
const BEL = String.fromCharCode(7);

/**
 * @param {{ reason: string, task: string, interactive: boolean }} input
 * @returns {Escalation}
 */
export function routeEscalation(input) {
  const systemMessage =
    `harness escalation on ${input.task}: ${input.reason}. This needs a decision rather than another ` +
    "attempt — the ceiling was reached deliberately, below the platform's own block cap, so that a " +
    "human chooses what happens next instead of the session simply ending.";

  if (!input.interactive) return { systemMessage };

  // Only the task id travels in the sequence. The reason may be long, and a
  // terminal notification is not the place to read it.
  return { systemMessage, terminalSequence: `${OSC}harness: ${input.task} needs attention${BEL}` };
}
