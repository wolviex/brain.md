import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";

export interface RunResult {
  stdout: string;
  stderr: string;
  code: number;
}

export interface RunBrainOptions {
  cwd: string;
  stdin?: string;
  /** Milliseconds before giving up and killing the child. Defaults to 30s. */
  timeoutMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;

// Timestamp of the most recent runBrain() call, keyed by resolved cwd. The
// hand-edit guard uses this to tell a CLI-driven write (expected) apart from
// an out-of-band edit (warn) without runBrain needing to know anything about
// vscode or watchers — it just records that *a* brain invocation happened.
const lastActivityByCwd = new Map<string, number>();

export function msSinceLastBrainCliActivity(cwd: string): number {
  const last = lastActivityByCwd.get(cwd);
  return last === undefined ? Infinity : Date.now() - last;
}

// A longer-lived, explicitly-set counterpart to the map above. Agent handoff
// launches an interactive CLI session in its own terminal process — writes
// from that session never call runBrain() in this extension host, so the
// short per-invocation window above can't cover it, and a real review
// session can run for minutes across several separate writes. Set once on a
// confirmed handoff launch rather than refreshed per-write, since nothing
// in this process observes the session's actual activity.
const externalAgentActiveUntil = new Map<string, number>();

export function markExternalAgentActive(cwd: string, forMs: number): void {
  externalAgentActiveUntil.set(cwd, Date.now() + forMs);
}

export function isExternalAgentActive(cwd: string): boolean {
  const until = externalAgentActiveUntil.get(cwd);
  return until !== undefined && Date.now() < until;
}

/**
 * Spawn the brain CLI with the extension host's own Node (process.execPath),
 * so the workspace doesn't need `node` on PATH. This is the ONLY function
 * through which the extension ever touches a brain file — no subcommand's
 * behavior is reimplemented here; every mutation goes through the real CLI.
 */
export function runBrain(cliPath: string, args: string[], opts: RunBrainOptions): Promise<RunResult> {
  lastActivityByCwd.set(opts.cwd, Date.now());
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cliPath, ...args], {
      cwd: opts.cwd,
      env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
    });

    let stdout = "";
    let stderr = "";
    let settled = false;

    const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill();
      reject(new Error(`brain CLI timed out after ${timeoutMs}ms: node ${cliPath} ${args.join(" ")}`));
    }, timeoutMs);

    // Writing to a child that has already exited raises 'error' (EPIPE /
    // ERR_STREAM_DESTROYED) on the stdin stream; with no listener, Node
    // treats that as an uncaught exception in the extension host. The
    // 'close' handler below still fires and reports the real outcome via
    // the resolved/rejected promise, so this listener only needs to stop
    // the error from propagating unheard.
    child.stdin.on("error", () => {});

    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.stderr.on("data", (chunk: Buffer) => (stderr += chunk.toString("utf8")));
    child.on("error", (err) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      reject(err);
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      lastActivityByCwd.set(opts.cwd, Date.now());
      resolve({ stdout, stderr, code: code ?? -1 });
    });

    if (opts.stdin !== undefined) {
      child.stdin.write(opts.stdin);
    }
    child.stdin.end();
  });
}

export interface ResolveCliPathOptions {
  /** From the brainMd.cliPath setting, if the user configured one. */
  configured?: string;
  /** The workspace folder root brain.md is being used from. */
  workspaceRoot: string;
  /** extension/assets, where esbuild stages a copy of ../skills at build time. */
  extensionAssetsDir: string;
}

const CLI_RELATIVE_PATH = join("skills", "brain-page", "bin", "brain.mjs");

/**
 * Resolve the brain CLI script to invoke, in precedence order:
 *   1. brainMd.cliPath, if it points at a file that exists;
 *   2. a repo-local skills/brain-page/bin/brain.mjs — so the extension
 *      self-hosts off the live source when working ON brain.md itself,
 *      instead of the bundled copy;
 *   3. the copy bundled into the extension at build time.
 * A bad or missing setting falls through silently rather than throwing. The
 * bundled path is always returned as the last resort, even if it doesn't
 * exist yet, so callers have one consistent path to report an error against.
 */
export function resolveCliPath(opts: ResolveCliPathOptions): string {
  if (opts.configured && existsSync(opts.configured)) {
    return opts.configured;
  }

  const repoLocal = join(opts.workspaceRoot, CLI_RELATIVE_PATH);
  if (existsSync(repoLocal)) {
    return repoLocal;
  }

  return join(opts.extensionAssetsDir, CLI_RELATIVE_PATH);
}
