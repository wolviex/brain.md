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
  detectProjectMode,
  type ProjectMode,
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

  const freshlyScaffolded = !info.populated;

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

  if (freshlyScaffolded) {
    await nudgeBootstrap(ctx, log);
  }
}

/**
 * brain-setup only ever stamps down empty templates — it has no reasoning
 * of its own. Filling them with real project knowledge is the separate
 * brain-bootstrap skill (reads code/docs/git log on brownfield, interviews
 * the user on greenfield), which only an agent can run. Nudge toward it
 * right after a fresh scaffold, since nothing else in the workflow surfaces
 * that second step.
 */
async function nudgeBootstrap(ctx: SetupContext, log: (msg: string) => void): Promise<void> {
  const mode: ProjectMode = detectProjectMode(ctx.workspaceRoot);
  log(`project looks ${mode} — nudging to run brain-bootstrap`);

  const prompt =
    mode === "brownfield"
      ? "Run the brain-bootstrap skill to seed this project's brain: read the existing code, docs, and git log to draft the six root pages and capture key historical decisions, through the brain CLI."
      : "Run the brain-bootstrap skill to seed this project's brain: interview me about the project's goal, target users, non-goals, and rough shape, then seed background (and stack/roadmap if I have a sense of them) through the brain CLI.";

  const message =
    mode === "brownfield"
      ? "brain.md: this looks like an existing project. The brain is scaffolded but still empty — ask your coding agent to run the brain-bootstrap skill to seed it from your code and git history."
      : "brain.md: the brain is scaffolded but still empty — ask your coding agent to run the brain-bootstrap skill. It'll interview you to seed it.";

  const choice = await vscode.window.showInformationMessage(message, "Copy Agent Prompt", "Install Agent Skills…");

  if (choice === "Copy Agent Prompt") {
    await vscode.env.clipboard.writeText(prompt);
    void vscode.window.showInformationMessage("brain.md: prompt copied — paste it into your coding agent's chat.");
  } else if (choice === "Install Agent Skills…") {
    await vscode.commands.executeCommand("brainMd.installSkills");
  }
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
