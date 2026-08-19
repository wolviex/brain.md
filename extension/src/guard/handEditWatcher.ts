import * as vscode from "vscode";
import { basename } from "node:path";
import { isExternalAgentActive, msSinceLastBrainCliActivity } from "../cli";
import { brainReadonlyGlob } from "./readonlyGlob";

// A CLI-driven write and the resulting file-system event aren't atomic —
// give the watcher this much slack after any runBrain() call before it
// treats a change as out-of-band.
const SUPPRESSION_WINDOW_MS = 4000;

// index.md is derived/regenerated content (every create-page, update-truth,
// etc. already reindexes it as a side effect, and so does the bundled
// pre-commit hook), not hand-authored knowledge — a stale index is fixed by
// the next reindex, not the kind of invariant this guard exists to protect.
// Warning about it specifically is noise, not signal.
const EXEMPT_FILENAMES = new Set(["index.md"]);

/**
 * Warn when a file under the brain dir changes without a recent runBrain()
 * call behind it — the closest an editor extension can get to catching a
 * hand edit, since (per BRAIN.md) "nothing at the file layer can stop a
 * manual edit, and there is no validator to catch one afterwards".
 */
export class HandEditWatcher implements vscode.Disposable {
  private watcher: vscode.FileSystemWatcher | undefined;

  constructor(private readonly output: vscode.OutputChannel) {}

  watch(workspaceRoot: string, brainDir: string): void {
    this.dispose();

    const glob = brainReadonlyGlob(workspaceRoot, brainDir);
    if (!glob) return; // brainRoot sidecar outside the workspace — not watchable this way

    const pattern = new vscode.RelativePattern(workspaceRoot, glob);
    this.watcher = vscode.workspace.createFileSystemWatcher(pattern, /* ignoreCreate */ false, /* ignoreChange */ false, /* ignoreDelete */ true);
    this.watcher.onDidChange((uri) => this.handle(workspaceRoot, uri));
    this.watcher.onDidCreate((uri) => this.handle(workspaceRoot, uri));
  }

  private handle(workspaceRoot: string, uri: vscode.Uri): void {
    if (EXEMPT_FILENAMES.has(basename(uri.fsPath))) return;
    if (isExternalAgentActive(workspaceRoot)) return;
    if (msSinceLastBrainCliActivity(workspaceRoot) < SUPPRESSION_WINDOW_MS) return;

    this.output.appendLine(`brain guard: out-of-band change detected at ${uri.fsPath}`);
    void vscode.window
      .showWarningMessage(`brain.md: "${vscode.workspace.asRelativePath(uri)}" was modified outside the brain CLI.`, "Show File", "Ignore")
      .then((choice) => {
        if (choice === "Show File") void vscode.window.showTextDocument(uri);
      });
  }

  dispose(): void {
    this.watcher?.dispose();
    this.watcher = undefined;
  }
}
