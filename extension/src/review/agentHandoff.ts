import * as vscode from "vscode";
import { markExternalAgentActive, runBrain } from "../cli";
import { writeIngestPrompt } from "./ingestPrompt";
import { AGENT_COMMANDS, detectInstalledAgents, isSkillInstalledForCli } from "./agentCommands";
import type { CapturedCommit } from "../capture/filter";

const TERMINAL_NAME = "brain.md: agent handoff";

// sendText() can't itself confirm the command ran — VS Code doesn't expose
// terminal output without the newer Terminal Shell Integration API, which
// this extension's engine floor predates. A short grace period at least
// catches the terminal being disposed out from under us immediately after
// launch; it can't catch a CLI that starts, prints "command not found" to
// its own prompt, and just sits there — detectInstalledAgents() is what
// actually rules that failure mode out ahead of time.
const LAUNCH_CONFIRM_DELAY_MS = 1500;

// How long to suppress hand-edit warnings after a confirmed handoff — long
// enough to cover a real interactive review-and-ingest session. See
// cli.ts's isExternalAgentActive for why a fixed window is the best we can
// do without visibility into the terminal's actual activity.
const AGENT_SESSION_SUPPRESSION_MS = 10 * 60 * 1000;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Writes a brain-ingest prompt for the selected commits, then opens (or
 * reuses) a terminal and feeds it to the chosen agent CLI. Only offers CLIs
 * actually found on PATH — offering all three unconditionally was how a
 * missing binary silently emptied the review queue (the terminal printed
 * "command not found" and the commits were still marked handled). The
 * agent — not the extension — does the actual `brain` CLI writes; this only
 * hands off.
 */
export async function handoffToAgent(
  cliPath: string,
  storageDir: string,
  workspaceRoot: string,
  commits: CapturedCommit[],
): Promise<boolean> {
  const installed = detectInstalledAgents();

  if (installed.length === 0) {
    const help = AGENT_COMMANDS.map((c) => `${c.label}: ${c.authHelp}`).join("\n\n");
    void vscode.window.showWarningMessage(
      "brain.md: none of claude / codex / opencode were found on PATH. Use \"Land manually\" instead, or install one of them.",
      { modal: true, detail: help },
    );
    return false;
  }

  const picked = await vscode.window.showQuickPick(
    installed.map((c) => ({
      label: c.label,
      description: c.seedsPrompt ? "opens seeded with the prompt" : "opens — paste the prompt in yourself",
      command: c,
    })),
    {
      title: "brain.md: hand off to which agent?",
      placeHolder: "Opens a terminal; you watch it apply brain-ingest and approve its writes",
    },
  );
  if (!picked) return false;

  const listPages = await runBrain(cliPath, ["list-pages"], { cwd: workspaceRoot });
  const promptPath = writeIngestPrompt(storageDir, {
    commits,
    cliPath,
    listPagesOutput: listPages.stdout,
    skillInstalled: isSkillInstalledForCli(picked.command.cli, "brain-ingest"),
  });

  const terminal =
    vscode.window.terminals.find((t) => t.name === TERMINAL_NAME) ??
    vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: workspaceRoot });
  terminal.show();
  terminal.sendText(picked.command.buildShellCommand(promptPath), true);

  await delay(LAUNCH_CONFIRM_DELAY_MS);
  if (!vscode.window.terminals.includes(terminal)) {
    void vscode.window.showWarningMessage(
      `brain.md: the ${picked.command.label} terminal closed immediately — handoff likely failed. The commits are still pending.`,
    );
    return false;
  }

  markExternalAgentActive(workspaceRoot, AGENT_SESSION_SUPPRESSION_MS);
  return true;
}
