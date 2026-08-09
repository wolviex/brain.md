import * as vscode from "vscode";
import type { BrainDirInfo } from "../brainDir";

export class BrainStatusBar implements vscode.Disposable {
  private readonly item: vscode.StatusBarItem;

  constructor() {
    this.item = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.item.command = "brainMd.reviewPending";
  }

  showNoWorkspace(): void {
    this.item.text = "$(book) Brain";
    this.item.tooltip = "brain.md: open a folder to use the brain CLI";
    this.item.show();
  }

  showError(message: string): void {
    this.item.text = "$(warning) Brain";
    this.item.tooltip = `brain.md: ${message}`;
    this.item.show();
  }

  showBrainDir(info: BrainDirInfo, pendingCount = 0): void {
    if (!info.exists || !info.populated) {
      this.item.text = "$(book) Brain: not set up";
      this.item.tooltip = `brain.md: no brain found at ${info.dir} (${info.origin}).\nClick to refresh, or run "Brain: Set Up Workspace".`;
    } else {
      const redirected = info.source === "brainRoot" ? " (redirected)" : "";
      const pending = pendingCount > 0 ? ` — ${pendingCount} pending` : "";
      this.item.text = `$(book) Brain${redirected}${pending}`;
      this.item.tooltip = [
        `brain.md: ${info.dir}`,
        info.origin,
        pendingCount > 0 ? `${pendingCount} commit(s) queued for review` : undefined,
      ]
        .filter(Boolean)
        .join("\n");
    }
    this.item.show();
  }

  dispose(): void {
    this.item.dispose();
  }
}
