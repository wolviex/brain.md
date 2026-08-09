import * as vscode from "vscode";
import { writeIngestPrompt } from "./ingestPrompt";
import type { CapturedCommit } from "../capture/filter";

const CANDIDATE_AGENT_COMMANDS = ["claude", "codex", "opencode"] as const;
const TERMINAL_NAME = "brain.md: agent handoff";

/**
 * Writes a brain-ingest prompt for the selected commits, then opens (or
 * reuses) a terminal and feeds it to the chosen agent CLI. The agent — not
 * the extension — does the actual `brain` CLI writes; this only hands off.
 */
export async function handoffToAgent(storageDir: string, workspaceRoot: string, commits: CapturedCommit[]): Promise<boolean> {
  const agentCommand = await vscode.window.showQuickPick(CANDIDATE_AGENT_COMMANDS as unknown as string[], {
    title: "brain.md: hand off to which agent CLI?",
    placeHolder: "Opens a terminal and feeds it the ingest prompt",
  });
  if (!agentCommand) return false;

  const promptPath = writeIngestPrompt(storageDir, commits);

  const terminal =
    vscode.window.terminals.find((t) => t.name === TERMINAL_NAME) ??
    vscode.window.createTerminal({ name: TERMINAL_NAME, cwd: workspaceRoot });
  terminal.show();
  terminal.sendText(`${agentCommand} "$(cat '${promptPath}')"`, true);
  return true;
}
