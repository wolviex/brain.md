import * as vscode from "vscode";
import { runBrain } from "./cli";
import { getBrainDir } from "./brainDir";
import {
  ensureBrainMd,
  scaffoldBrainSkeleton,
  hasGitRepo,
  hasPreCommitHook,
  readExistingPreCommitHook,
  installPreCommitHook,
} from "./setupFiles";

const WIRE_AGENTS = ["claude-code", "codex", "opencode", "cursor", "pi"] as const;
type WireAgent = (typeof WIRE_AGENTS)[number];

export interface SetupContext {
  cliPath: string;
  workspaceRoot: string;
  assetsDir: string;
  output: vscode.OutputChannel;
}

/**
 * Mirrors skills/brain-setup/SKILL.md step for step, so the extension and
 * the skill can never drift: resolve the brain location, ensure BRAIN.md,
 * scaffold the brain dir only if empty (never a second local ./brain when
 * brainRoot redirects elsewhere), wire the chosen agent config files, then
 * optionally install the pre-commit hook.
 */
export async function runSetupFlow(ctx: SetupContext): Promise<void> {
  const log = (msg: string) => ctx.output.appendLine(`brain-setup: ${msg}`);

  let info;
  try {
    info = await getBrainDir(ctx.cliPath, ctx.workspaceRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`brain-dir failed: ${message}`);
    void vscode.window.showErrorMessage(`brain.md setup failed: ${message}`);
    return;
  }

  const brainMdResult = ensureBrainMd(ctx.assetsDir, ctx.workspaceRoot);
  log(brainMdResult === "created" ? "created BRAIN.md" : "BRAIN.md already present, left untouched");

  if (info.populated) {
    if (info.source === "brainRoot") {
      log(`brain already lives at ${info.dir} (redirected via brainRoot) — leaving it untouched`);
      void vscode.window.showInformationMessage(
        `brain.md: this project's brain is redirected to an external directory (${info.dir}) and is managed there.`,
      );
    } else {
      log(`brain already populated at ${info.dir} — leaving it untouched`);
    }
  } else {
    scaffoldBrainSkeleton(ctx.assetsDir, info);
    log(`scaffolded brain skeleton at ${info.dir}`);
    const reindex = await runBrain(ctx.cliPath, ["reindex"], { cwd: ctx.workspaceRoot });
    log(`reindex: ${(reindex.stdout || reindex.stderr).trim()}`);
  }

  const chosenAgents = await pickAgentsToWire();
  if (chosenAgents.length > 0) {
    const wireResult = await runBrain(ctx.cliPath, ["wire", "--agent", chosenAgents.join(",")], {
      cwd: ctx.workspaceRoot,
    });
    if (wireResult.code === 0) {
      log(wireResult.stdout.trim());
    } else {
      log(`wire failed: ${wireResult.stderr.trim()}`);
      void vscode.window.showWarningMessage('brain.md: wiring agent config failed — see the "brain.md" output channel.');
    }
  } else {
    log("no agents selected to wire");
  }

  await maybeInstallPreCommitHook(ctx, log);

  void vscode.window.showInformationMessage(`brain.md: workspace set up (brain at ${info.dir}).`);
}

async function pickAgentsToWire(): Promise<WireAgent[]> {
  const picks = await vscode.window.showQuickPick(
    WIRE_AGENTS.map((agent) => ({ label: agent, picked: agent === "claude-code" })),
    {
      canPickMany: true,
      title: "brain.md: wire which agent config files?",
      placeHolder: "Writes a brain block into CLAUDE.md / AGENTS.md so the chosen agents read BRAIN.md",
    },
  );
  return (picks ?? []).map((p) => p.label as WireAgent);
}

async function maybeInstallPreCommitHook(ctx: SetupContext, log: (msg: string) => void): Promise<void> {
  if (!hasGitRepo(ctx.workspaceRoot)) return;

  if (hasPreCommitHook(ctx.workspaceRoot)) {
    log(".git/hooks/pre-commit already exists — not overwriting. Existing contents:");
    log(readExistingPreCommitHook(ctx.workspaceRoot));
    return;
  }

  const choice = await vscode.window.showInformationMessage(
    "brain.md: install a pre-commit hook that reindexes the brain and checks [[links]] before each commit?",
    "Install",
    "Skip",
  );
  if (choice !== "Install") {
    log("pre-commit hook skipped");
    return;
  }

  installPreCommitHook(ctx.assetsDir, ctx.workspaceRoot);
  log("installed .git/hooks/pre-commit");
}
