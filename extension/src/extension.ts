import * as vscode from "vscode";
import { resolveCliPath } from "./cli";
import { getBrainDir } from "./brainDir";
import { BrainStatusBar } from "./view/statusBar";

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
  );

  void refreshStatus(context);
}

async function refreshStatus(context: vscode.ExtensionContext): Promise<void> {
  const folder = vscode.workspace.workspaceFolders?.[0];
  if (!folder) {
    statusBar?.showNoWorkspace();
    return;
  }

  const configured = vscode.workspace.getConfiguration("brainMd").get<string>("cliPath");
  const cliPath = resolveCliPath({
    configured: configured || undefined,
    workspaceRoot: folder.uri.fsPath,
    extensionAssetsDir: context.asAbsolutePath("assets"),
  });

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

export function deactivate(): void {
  output?.appendLine("brain.md: deactivated");
}
