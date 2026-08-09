import * as vscode from "vscode";

let output: vscode.OutputChannel | undefined;

export function activate(context: vscode.ExtensionContext): void {
  output = vscode.window.createOutputChannel("brain.md");
  context.subscriptions.push(output);
  output.appendLine(`brain.md: activated (extension path: ${context.extensionPath})`);
}

export function deactivate(): void {
  output?.appendLine("brain.md: deactivated");
}
