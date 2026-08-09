import * as vscode from "vscode";
import { resolveCliPath } from "./cli";
import { getBrainDir } from "./brainDir";
import { runSetupFlow } from "./setup";
import { BrainStatusBar } from "./view/statusBar";

const SETUP_PROMPTED_KEY = "brainMd.setupPrompted";

let output: vscode.OutputChannel | undefined;
let statusBar: BrainStatusBar | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("brain.md");
  context.subscriptions.push(output);
  output.appendLine(`brain.md: activated (extension path: ${context.extensionPath})`);

  statusBar = new BrainStatusBar();
  context.subscriptions.push(statusBar);

  context.subscriptions.push(
    vscode.commands.registerCommand("brainMd.refreshStatus", () => refreshStatus(context)),
    vscode.commands.registerCommand("brainMd.setupWorkspace", () => setupWorkspace(context)),
  );

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

async function refreshStatus(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    statusBar?.showNoWorkspace();
    return;
  }

  const cliPath = resolveCliPathForFolder(context, folder);

  try {
    const info = await getBrainDir(cliPath, folder.uri.fsPath);
    statusBar?.showBrainDir(info);
    output?.appendLine(`brain-dir: ${JSON.stringify(info)}`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    statusBar?.showError(message);
    output?.appendLine(`brain-dir error: ${message}`);
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
