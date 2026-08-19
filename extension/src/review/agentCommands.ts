import { existsSync, statSync } from "node:fs";
import { delimiter, join } from "node:path";
import { candidateRuntimes } from "../skillsInstallCore";

export type AgentCli = "claude" | "codex" | "opencode";

export interface AgentCommand {
  cli: AgentCli;
  label: string;
  /** True when buildShellCommand actually seeds the CLI with the prompt; false when it only opens the CLI and the prompt file is left for the user to paste in themselves. */
  seedsPrompt: boolean;
  /** The exact shell command line to run in a POSIX-shell terminal for this prompt file. */
  buildShellCommand(promptPath: string): string;
  /** What to tell the user if this CLI isn't authenticated — matters especially on a remote code-server box, where each CLI's normal browser-based login can't reach back to it. */
  authHelp: string;
}

function shellQuoteSingle(value: string): string {
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

// Invocation forms verified against each CLI's own docs (not assumed):
//   claude "<prompt>"  — "Start interactive session with initial prompt" (claude docs' own wording; distinct from `claude -p`, which is headless).
//   codex "<prompt>"   — bare positional opens the interactive TUI seeded with the prompt; `codex exec` is the documented non-interactive form.
//   opencode run "<p>" — explicitly documented as non-interactive ("runs a prompt non-interactively for scripting, streams to stdout"); there is
//                        no documented way to seed opencode's TUI with an initial prompt, so this only opens the CLI.
export const AGENT_COMMANDS: readonly AgentCommand[] = [
  {
    cli: "claude",
    label: "Claude Code",
    seedsPrompt: true,
    buildShellCommand: (promptPath) => `claude "$(cat ${shellQuoteSingle(promptPath)})"`,
    authHelp:
      "Not logged in, or on a remote box where the normal browser callback can't reach back? Run `claude setup-token` — it prints a URL to open in any browser and stores a long-lived token for headless use.",
  },
  {
    cli: "codex",
    label: "Codex",
    seedsPrompt: true,
    buildShellCommand: (promptPath) => `codex "$(cat ${shellQuoteSingle(promptPath)})"`,
    authHelp:
      "Not logged in, or on a remote box where the OAuth callback (localhost:1455) can't reach back? Run `codex login --device-auth` (a workspace admin must have device-code auth enabled first).",
  },
  {
    cli: "opencode",
    label: "OpenCode",
    seedsPrompt: false,
    buildShellCommand: (promptPath) =>
      `echo "brain.md: paste the prompt from ${shellQuoteSingle(promptPath)} into the session below." && opencode`,
    authHelp: "opencode supports multiple model providers — run `opencode auth login` to connect one.",
  },
];

const WINDOWS_EXTENSIONS = [".exe", ".cmd", ".bat", ""];

export interface PathProbeOptions {
  pathEnv?: string;
  platform?: NodeJS.Platform;
}

/**
 * Best-effort PATH probe — no subprocess spawn, so it stays synchronous and
 * pure. Not a substitute for actually trying to launch the CLI, but enough
 * to avoid offering a command that will obviously fail with "not found".
 */
export function isCommandOnPath(command: string, opts: PathProbeOptions = {}): boolean {
  const pathEnv = opts.pathEnv ?? process.env.PATH ?? "";
  const platform = opts.platform ?? process.platform;
  const dirs = pathEnv.split(delimiter).filter(Boolean);
  const names = platform === "win32" ? WINDOWS_EXTENSIONS.map((ext) => `${command}${ext}`) : [command];

  for (const dir of dirs) {
    for (const name of names) {
      const candidate = join(dir, name);
      if (!existsSync(candidate)) continue;
      if (platform === "win32") return true; // POSIX executable bits aren't meaningful here
      try {
        const stat = statSync(candidate);
        if (stat.isFile() && (stat.mode & 0o111) !== 0) return true;
      } catch {
        // race: it disappeared between existsSync and statSync — keep looking
      }
    }
  }
  return false;
}

export function detectInstalledAgents(opts: PathProbeOptions = {}): AgentCommand[] {
  return AGENT_COMMANDS.filter((cmd) => isCommandOnPath(cmd.cli, opts));
}

const CLI_TO_RUNTIME_LABEL: Record<AgentCli, string> = {
  claude: "Claude",
  codex: "Codex",
  opencode: "OpenCode",
};

/**
 * Whether a given skill is actually present in the agent runtime's global
 * skills dir — reuses skillsInstallCore's own runtime-directory knowledge
 * rather than duplicating it, and checks real directory presence (not just
 * this extension's install manifest), since the skill may have been
 * installed by the repo's own ./setup instead.
 */
export function isSkillInstalledForCli(cli: AgentCli, skillName: string, home?: string): boolean {
  const runtime = candidateRuntimes(home).find((r) => r.label === CLI_TO_RUNTIME_LABEL[cli]);
  if (!runtime) return false;
  return existsSync(join(runtime.skillsDir, skillName));
}
