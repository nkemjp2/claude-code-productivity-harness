import { spawn } from "node:child_process";

/**
 * The sanitised child spawner (M4, M10).
 *
 * Hooks run with no controlling terminal and `/dev/tty` is unavailable, so
 * anything interactive hangs until its timeout — and a timed-out `PreToolUse`
 * gate does **not** block the tool call (M5). A prompt is therefore not an
 * inconvenience here; it is a gate that silently fails open. Every child gets
 * stdin from `/dev/null` and an environment with every prompt disarmed.
 *
 * Nothing is ever spawned through a shell, so no profile is sourced and no
 * `.cmd` shim is invoked by name.
 *
 * @typedef {{ code: number | null, stdout: string, stderr: string, timedOut: boolean }} ChildResult
 */

/**
 * @param {NodeJS.ProcessEnv} [base]
 * @returns {NodeJS.ProcessEnv}
 */
export function sanitisedEnv(base) {
  return {
    ...(base ?? process.env),
    CI: "1",
    TERM: "dumb",
    NO_COLOR: "1",
    FORCE_COLOR: "0",
    GIT_TERMINAL_PROMPT: "0",
    GIT_PAGER: "cat",
    PAGER: "cat",
    npm_config_yes: "true",
    DEBIAN_FRONTEND: "noninteractive",
  };
}

/**
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd: string, timeoutMs: number, env?: NodeJS.ProcessEnv }} opts
 * @returns {Promise<ChildResult>}
 */
export function runChild(command, args, opts) {
  return new Promise((resolve) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: sanitisedEnv(opts.env === undefined ? process.env : { ...process.env, ...opts.env }),
      // "ignore" gives the child /dev/null on stdin, so a read returns EOF
      // immediately instead of waiting for a writer that will never arrive.
      stdio: ["ignore", "pipe", "pipe"],
      shell: false,
    });

    let stdout = "";
    let stderr = "";
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGKILL");
    }, opts.timeoutMs);

    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (c) => { stdout += c; });
    child.stderr.on("data", (c) => { stderr += c; });

    child.on("error", (err) => {
      clearTimeout(timer);
      resolve({ code: null, stdout, stderr: stderr + String(err.message), timedOut });
    });

    child.on("close", (code) => {
      clearTimeout(timer);
      // A killed child reports null; surfacing that as 0 would make a timeout
      // indistinguishable from success, which R-F2.4 forbids.
      resolve({ code: timedOut ? (code ?? -1) : code, stdout, stderr, timedOut });
    });
  });
}
