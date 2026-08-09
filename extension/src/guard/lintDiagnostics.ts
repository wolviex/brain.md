import * as vscode from "vscode";
import { runBrain } from "../cli";
import { parseLintLinksOutput } from "./lintDiagnosticsParser";

/** Publishes `brain lint-links` findings to the Problems panel. No new checking logic — just reads the CLI's own output. */
export class LintDiagnostics implements vscode.Disposable {
  private readonly collection = vscode.languages.createDiagnosticCollection("brain.md");

  async refresh(cliPath: string, workspaceRoot: string): Promise<{ errorCount: number; warningCount: number }> {
    const result = await runBrain(cliPath, ["lint-links"], { cwd: workspaceRoot });
    const findings = parseLintLinksOutput(result.stdout, result.stderr);

    const byFile = new Map<string, vscode.Diagnostic[]>();
    let errorCount = 0;
    let warningCount = 0;
    for (const finding of findings) {
      const severity = finding.severity === "error" ? vscode.DiagnosticSeverity.Error : vscode.DiagnosticSeverity.Warning;
      if (finding.severity === "error") errorCount++;
      else warningCount++;
      const diagnostic = new vscode.Diagnostic(new vscode.Range(0, 0, 0, 0), finding.message, severity);
      diagnostic.source = "brain.md";
      const existing = byFile.get(finding.filePath) ?? [];
      existing.push(diagnostic);
      byFile.set(finding.filePath, existing);
    }

    this.collection.clear();
    for (const [filePath, diagnostics] of byFile) {
      this.collection.set(vscode.Uri.file(filePath), diagnostics);
    }

    return { errorCount, warningCount };
  }

  dispose(): void {
    this.collection.dispose();
  }
}
