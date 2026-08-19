import * as vscode from "vscode";
import type { CapturedCommit } from "../capture/filter";
import { manualLand } from "./manualLand";
import { handoffToAgent } from "./agentHandoff";

export interface ReviewContext {
  cliPath: string;
  workspaceRoot: string;
  storageDir: string;
  output: vscode.OutputChannel;
}

/** Returns the SHAs that were handled (landed, handed off, or dismissed) — the caller marks these off the queue. */
export async function runReviewUi(ctx: ReviewContext, pending: CapturedCommit[]): Promise<string[]> {
  if (pending.length === 0) {
    void vscode.window.showInformationMessage("brain.md: nothing pending review.");
    return [];
  }

  const picks = await vscode.window.showQuickPick(
    pending.map((c) => ({
      label: c.subject,
      description: c.sha.slice(0, 7),
      detail: `${c.files.length} file(s) — ${c.files.slice(0, 3).join(", ")}${c.files.length > 3 ? ", ..." : ""}`,
      commit: c,
    })),
    { title: "brain.md: review pending commits", canPickMany: true, placeHolder: "Select commits to review together" },
  );
  if (!picks || picks.length === 0) return [];

  const selected = picks.map((p) => p.commit);

  const outcome = await vscode.window.showQuickPick(
    [
      { label: "Hand off to agent", detail: "Write a brain-ingest prompt and open a terminal with it", value: "agent" as const },
      { label: "Land manually", detail: "Pick a page or root page yourself and write through the CLI", value: "manual" as const },
      { label: "Dismiss", detail: "Not worth capturing — mark reviewed without writing anything", value: "dismiss" as const },
    ],
    { title: `brain.md: ${selected.length} commit(s) selected — what next?` },
  );
  if (!outcome) return [];

  if (outcome.value === "dismiss") {
    return selected.map((c) => c.sha);
  }

  if (outcome.value === "agent") {
    // handoffToAgent() only reports success once it's confirmed a CLI is
    // actually installed and the launch didn't die immediately; beyond
    // that, the agent does its actual writes on its own time and we can't
    // observe when it finishes, so a confirmed handoff is marked handled
    // now rather than re-offered — the queue's job was only ever to
    // surface the commits.
    const handedOff = await handoffToAgent(ctx.cliPath, ctx.storageDir, ctx.workspaceRoot, selected);
    return handedOff ? selected.map((c) => c.sha) : [];
  }

  const landed = await manualLand({ cliPath: ctx.cliPath, workspaceRoot: ctx.workspaceRoot, output: ctx.output }, selected);
  return landed ? selected.map((c) => c.sha) : [];
}
