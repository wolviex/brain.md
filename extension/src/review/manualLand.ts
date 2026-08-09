import * as vscode from "vscode";
import { runBrain, type RunResult } from "../cli";
import { parseListPagesOutput } from "../view/brainListParser";
import type { CapturedCommit } from "../capture/filter";
import {
  appendTimelineArgs,
  createPageArgs,
  defaultSourceFor,
  defaultSummaryFor,
  type PageCategory,
  type TimelineKind,
} from "./manualLandCommands";

const TIMELINE_KINDS: readonly TimelineKind[] = ["decision", "evidence", "reversal", "note"];
const PAGE_CATEGORIES: readonly PageCategory[] = ["project", "concept", "decision", "person", "reference"];
const ROOT_PAGE_SLUGS = ["background", "architecture", "flow", "mindmap", "stack", "roadmap"] as const;

export interface ManualLandContext {
  cliPath: string;
  workspaceRoot: string;
  output: vscode.OutputChannel;
}

/** Returns true if something was landed through the CLI, so the caller can mark the commits handled. */
export async function manualLand(ctx: ManualLandContext, commits: CapturedCommit[]): Promise<boolean> {
  const target = await vscode.window.showQuickPick(
    [
      { label: "Existing page", detail: "Append a timeline entry to a page that already exists", value: "existing" as const },
      { label: "New page", detail: "Create a new page (fill in its understanding later)", value: "new" as const },
      { label: "Root page", detail: "Edit background / architecture / flow / mindmap / stack / roadmap", value: "root" as const },
    ],
    { title: "brain.md: land this into...", placeHolder: `${commits.length} commit(s) selected` },
  );
  if (!target) return false;

  switch (target.value) {
    case "existing":
      return landOnExistingPage(ctx, commits);
    case "new":
      return landOnNewPage(ctx, commits);
    case "root":
      return landOnRootPage(ctx);
  }
}

async function landOnExistingPage(ctx: ManualLandContext, commits: CapturedCommit[]): Promise<boolean> {
  const list = await runBrain(ctx.cliPath, ["list-pages"], { cwd: ctx.workspaceRoot });
  const pages = parseListPagesOutput(list.stdout);
  if (pages.length === 0) {
    void vscode.window.showWarningMessage("brain.md: no pages exist yet — choose New page instead.");
    return false;
  }

  const picked = await vscode.window.showQuickPick(
    pages.map((p) => ({ label: p.title || p.id, description: `${p.category} · ${p.status}`, detail: p.id, id: p.id })),
    { title: "brain.md: which page?" },
  );
  if (!picked) return false;

  const kind = (await vscode.window.showQuickPick(TIMELINE_KINDS as string[], {
    title: "brain.md: timeline entry kind",
  })) as TimelineKind | undefined;
  if (!kind) return false;

  const summary = await vscode.window.showInputBox({
    title: "brain.md: timeline summary",
    value: defaultSummaryFor(commits),
  });
  if (!summary) return false;

  const result = await runBrain(
    ctx.cliPath,
    appendTimelineArgs({ pageId: picked.id, kind, summary, source: defaultSourceFor(commits) }),
    { cwd: ctx.workspaceRoot },
  );
  return reportResult(ctx, result, `appended to ${picked.id}`);
}

async function landOnNewPage(ctx: ManualLandContext, commits: CapturedCommit[]): Promise<boolean> {
  const id = await vscode.window.showInputBox({
    title: "brain.md: new page id",
    prompt: "kebab-case",
    validateInput: (v) => (/^[a-z0-9][a-z0-9-]*$/.test(v) ? undefined : "use kebab-case: a-z 0-9 -"),
  });
  if (!id) return false;

  const category = (await vscode.window.showQuickPick(PAGE_CATEGORIES as string[], {
    title: "brain.md: category",
  })) as PageCategory | undefined;
  if (!category) return false;

  const title = await vscode.window.showInputBox({ title: "brain.md: title", value: defaultSummaryFor(commits) });
  if (!title) return false;

  const result = await runBrain(ctx.cliPath, createPageArgs({ id, category, title, source: defaultSourceFor(commits) }), {
    cwd: ctx.workspaceRoot,
  });
  return reportResult(ctx, result, `created ${id}`);
}

async function landOnRootPage(ctx: ManualLandContext): Promise<boolean> {
  const slug = (await vscode.window.showQuickPick(ROOT_PAGE_SLUGS as unknown as string[], {
    title: "brain.md: which root page?",
  })) as (typeof ROOT_PAGE_SLUGS)[number] | undefined;
  if (!slug) return false;

  const current = await runBrain(ctx.cliPath, ["read-root", slug], { cwd: ctx.workspaceRoot });
  if (current.code !== 0) {
    void vscode.window.showErrorMessage(`brain.md: read-root failed — ${current.stderr.trim()}`);
    return false;
  }

  const doc = await vscode.workspace.openTextDocument({ content: current.stdout, language: "markdown" });
  await vscode.window.showTextDocument(doc);

  const choice = await vscode.window.showInformationMessage(
    `brain.md: edit ${slug}.md in the editor, then choose Land to rewrite it via the CLI.`,
    "Land",
    "Cancel",
  );
  if (choice !== "Land") return false;

  const result = await runBrain(ctx.cliPath, ["update-root", slug], { cwd: ctx.workspaceRoot, stdin: doc.getText() });
  return reportResult(ctx, result, `updated root page ${slug}`);
}

function reportResult(ctx: ManualLandContext, result: RunResult, successNote: string): boolean {
  if (result.code !== 0) {
    ctx.output.appendLine(`brain review: failed — ${result.stderr.trim()}`);
    void vscode.window.showErrorMessage(`brain.md: ${result.stderr.trim() || "landing failed"}`);
    return false;
  }
  ctx.output.appendLine(`brain review: ${successNote}`);
  void vscode.window.showInformationMessage(`brain.md: ${successNote}.`);
  return true;
}
