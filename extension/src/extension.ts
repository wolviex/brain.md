import * as vscode from "vscode";
import { resolveCliPath, runBrain } from "./cli";
import { getBrainDir, type BrainDirInfo } from "./brainDir";
import { runSetupFlow } from "./setup";
import { BrainStatusBar } from "./view/statusBar";
import { BrainTreeProvider } from "./view/brainTree";
import { applyReadonlyGuard } from "./guard/readonly";
import { HandEditWatcher } from "./guard/handEditWatcher";
import { LintDiagnostics } from "./guard/lintDiagnostics";
import { GitWatcher } from "./capture/gitWatcher";
import { shouldCapture, type CapturedCommit } from "./capture/filter";
import { emptyQueueState, enqueueCommits, markHandled, type QueueState } from "./capture/queue";
import { runReviewUi } from "./review/reviewUi";

const SETUP_PROMPTED_KEY = "brainMd.setupPrompted";
const QUEUE_STATE_KEY = "brainMd.captureQueue";
const LAST_SEEN_KEY = "brainMd.captureLastSeen";
const PAGE_CATEGORIES = ["project", "concept", "decision", "person", "reference"] as const;

let output: vscode.OutputChannel | undefined;
let statusBar: BrainStatusBar | undefined;
let tree: BrainTreeProvider | undefined;
let handEditWatcher: HandEditWatcher | undefined;
let lintDiagnostics: LintDiagnostics | undefined;
let gitWatcher: GitWatcher | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("brain.md");
  context.subscriptions.push(output);
  output.appendLine(`brain.md: activated (extension path: ${context.extensionPath})`);

  statusBar = new BrainStatusBar();
  context.subscriptions.push(statusBar);

  tree = new BrainTreeProvider();
  context.subscriptions.push(vscode.window.registerTreeDataProvider("brainMd.tree", tree));

  handEditWatcher = new HandEditWatcher(output);
  context.subscriptions.push(handEditWatcher);

  lintDiagnostics = new LintDiagnostics();
  context.subscriptions.push(lintDiagnostics);

  context.subscriptions.push(
    vscode.commands.registerCommand("brainMd.refreshStatus", () => refreshStatus(context)),
    vscode.commands.registerCommand("brainMd.setupWorkspace", () => setupWorkspace(context)),
    vscode.commands.registerCommand("brainMd.reindex", () => reindex(context)),
    vscode.commands.registerCommand("brainMd.lintLinks", () => lintLinks(context)),
    vscode.commands.registerCommand("brainMd.newPage", () => newPage(context)),
    vscode.commands.registerCommand("brainMd.reviewPending", () => reviewPending(context)),
  );

  if (vscode.workspace.getConfiguration("brainMd").get<boolean>("capture.enabled", true)) {
    const lastSeen = context.workspaceState.get<Record<string, string>>(LAST_SEEN_KEY) ?? {};
    gitWatcher = new GitWatcher(
      output,
      lastSeen,
      (repoRoot, commits) => void handleNewCommits(context, repoRoot, commits),
      (repoRoot, sha) => void persistLastSeen(context, repoRoot, sha),
    );
    context.subscriptions.push(gitWatcher);
    void gitWatcher.start();
  }

  void refreshStatus(context).then(() => maybePromptSetup(context));
}

function resolveCliPathForFolder(context: vscode.ExtensionContext, folder: vscode.WorkspaceFolder): string {
  const configured = vscode.workspace.getConfiguration("brainMd", folder).get<string>("cliPath");
  return resolveCliPath({
    configured: configured || undefined,
    workspaceRoot: folder.uri.fsPath,
    extensionAssetsDir: context.asAbsolutePath("assets"),
  });
}

function loadQueueState(context: vscode.ExtensionContext): QueueState {
  return context.workspaceState.get<QueueState>(QUEUE_STATE_KEY) ?? emptyQueueState();
}

async function persistLastSeen(context: vscode.ExtensionContext, repoRoot: string, sha: string): Promise<void> {
  const current = context.workspaceState.get<Record<string, string>>(LAST_SEEN_KEY) ?? {};
  await context.workspaceState.update(LAST_SEEN_KEY, { ...current, [repoRoot]: sha });
}

/**
 * A new batch of commits from the git watcher. Detection only — this never
 * writes to the brain itself. Commits that pass the feedback-loop filter
 * are queued; a human (or agent, in review) decides what's actually durable.
 */
async function handleNewCommits(context: vscode.ExtensionContext, repoRoot: string, commits: CapturedCommit[]): Promise<void> {
  const folder =
    vscode.workspace.workspaceFolders?.find((f) => f.uri.fsPath === repoRoot) ?? vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  const cliPath = resolveCliPathForFolder(context, folder);
  let brainDir: string;
  try {
    brainDir = (await getBrainDir(cliPath, folder.uri.fsPath)).dir;
  } catch {
    return;
  }

  const config = vscode.workspace.getConfiguration("brainMd", folder);
  const capturable = commits.filter((commit) =>
    shouldCapture(commit, {
      workspaceRoot: folder.uri.fsPath,
      brainDir,
      includeMerges: config.get<boolean>("capture.includeMerges", false),
      ignoreGlobs: config.get<string[]>("capture.ignoreGlobs", []),
    }),
  );
  if (capturable.length === 0) return;

  const next = enqueueCommits(loadQueueState(context), capturable);
  await context.workspaceState.update(QUEUE_STATE_KEY, next);
  output?.appendLine(`brain capture: queued ${capturable.length} commit(s), ${next.pending.length} pending`);
  await refreshStatus(context);
}

async function refreshStatus(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    statusBar?.showNoWorkspace();
    tree?.setContext("", "", undefined);
    return;
  }

  const cliPath = resolveCliPathForFolder(context, folder);
  const workspaceRoot = folder.uri.fsPath;

  let info: BrainDirInfo;
  try {
    info = await getBrainDir(cliPath, workspaceRoot);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusBar?.showError(message);
    output?.appendLine(`brain-dir error: ${message}`);
    return;
  }

  statusBar?.showBrainDir(info, loadQueueState(context).pending.length);
  tree?.setContext(cliPath, workspaceRoot, info);
  output?.appendLine(`brain-dir: ${JSON.stringify(info)}`);

  if (info.exists) {
    await applyReadonlyGuard(workspaceRoot, info.dir);
    handEditWatcher?.watch(workspaceRoot, info.dir);
    const counts = await lintDiagnostics?.refresh(cliPath, workspaceRoot);
    if (counts) output?.appendLine(`lint-links: ${counts.errorCount} error(s), ${counts.warningCount} warning(s)`);
  }
}

async function setupWorkspace(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage("brain.md: open a folder first.");
    return;
  }
  if (!output) return;

  await runSetupFlow({
    cliPath: resolveCliPathForFolder(context, folder),
    workspaceRoot: folder.uri.fsPath,
    assetsDir: context.asAbsolutePath("assets"),
    output,
  });
  await refreshStatus(context);
}

async function reviewPending(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || !output) return;

  const state = loadQueueState(context);
  if (state.pending.length === 0) {
    void vscode.window.showInformationMessage("brain.md: nothing pending review.");
    return;
  }

  const handledShas = await runReviewUi(
    {
      cliPath: resolveCliPathForFolder(context, folder),
      workspaceRoot: folder.uri.fsPath,
      storageDir: (context.storageUri ?? context.globalStorageUri).fsPath,
      output,
    },
    state.pending,
  );

  if (handledShas.length > 0) {
    await context.workspaceState.update(QUEUE_STATE_KEY, markHandled(loadQueueState(context), handledShas));
  }
  await refreshStatus(context);
}

async function reindex(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;
  const cliPath = resolveCliPathForFolder(context, folder);
  const result = await runBrain(cliPath, ["reindex"], { cwd: folder.uri.fsPath });
  output?.appendLine(`reindex: ${(result.stdout || result.stderr).trim()}`);
  await refreshStatus(context);
}

async function lintLinks(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder || !lintDiagnostics) return;
  const cliPath = resolveCliPathForFolder(context, folder);
  const { errorCount, warningCount } = await lintDiagnostics.refresh(cliPath, folder.uri.fsPath);
  if (errorCount === 0 && warningCount === 0) {
    void vscode.window.showInformationMessage("brain.md: lint-links OK, no broken links.");
  } else {
    void vscode.window.showWarningMessage(
      `brain.md: lint-links found ${errorCount} error(s) and ${warningCount} warning(s) — see the Problems panel.`,
    );
  }
}

async function newPage(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    void vscode.window.showWarningMessage("brain.md: open a folder first.");
    return;
  }

  const id = await vscode.window.showInputBox({
    title: "New brain page — id",
    prompt: "kebab-case, e.g. use-markdown-not-sqlite",
    validateInput: (value) => (/^[a-z0-9][a-z0-9-]*$/.test(value) ? undefined : "use kebab-case: a-z 0-9 -"),
  });
  if (!id) return;

  const category = await vscode.window.showQuickPick(PAGE_CATEGORIES, { title: "New brain page — category" });
  if (!category) return;

  const title = await vscode.window.showInputBox({ title: "New brain page — title", prompt: "One-line title" });
  if (!title) return;

  const cliPath = resolveCliPathForFolder(context, folder);
  const result = await runBrain(cliPath, ["create-page", "--id", id, "--category", category, "--title", title], {
    cwd: folder.uri.fsPath,
  });
  if (result.code !== 0) {
    void vscode.window.showErrorMessage(`brain.md: create-page failed — ${result.stderr.trim()}`);
    return;
  }
  output?.appendLine(result.stdout.trim());
  await refreshStatus(context);

  const info = await getBrainDir(cliPath, folder.uri.fsPath);
  const pagePath = vscode.Uri.file(`${info.dir}/pages/${id}.md`);
  void vscode.window.showTextDocument(pagePath);
}

/**
 * On activation, offer to set up an un-braned workspace at most once — never
 * scaffold silently, and never ask again after the first answer (whichever
 * way it went).
 */
async function maybePromptSetup(context: vscode.ExtensionContext): Promise<void> {
  if (context.workspaceState.get(SETUP_PROMPTED_KEY)) return;

  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) return;

  let populated: boolean;
  try {
    const info = await getBrainDir(resolveCliPathForFolder(context, folder), folder.uri.fsPath);
    populated = info.populated;
  } catch {
    return; // refreshStatus already surfaced the error; don't also prompt.
  }
  if (populated) return;

  await context.workspaceState.update(SETUP_PROMPTED_KEY, true);

  const choice = await vscode.window.showInformationMessage(
    "Set up brain.md — a persistent project memory — in this workspace?",
    "Set Up",
    "Not Now",
  );
  if (choice === "Set Up") {
    await setupWorkspace(context);
  }
}

export function deactivate(): void {
  output?.appendLine("brain.md: deactivated");
}
