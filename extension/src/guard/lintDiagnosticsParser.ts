export interface LintFinding {
  severity: "error" | "warning";
  /** Absolute path, as printed by the CLI (doc.path in lib/brain.mjs is always absolute). */
  filePath: string;
  target: string;
  message: string;
}

// Mirrors the exact console.error/console.warn lines cmdLintLinks() prints in
// skills/brain-page/bin/brain.mjs — keep these in sync with that source.
const ERROR_RE = /^error:\s+(.+?)\s+→\s+\[\[([^\]]+)\]\]\s+(.+)$/;
const WARN_RE = /^warn:\s+(.+?)\s+→\s+\[\[([^\]]+)\]\]\s+(.+)$/;

export function parseLintLinksOutput(stdout: string, stderr: string): LintFinding[] {
  const findings: LintFinding[] = [];
  for (const line of `${stdout}\n${stderr}`.split("\n")) {
    const errorMatch = ERROR_RE.exec(line);
    if (errorMatch) {
      findings.push({ severity: "error", filePath: errorMatch[1], target: errorMatch[2], message: line.replace(/^error:\s+/, "") });
      continue;
    }
    const warnMatch = WARN_RE.exec(line);
    if (warnMatch) {
      findings.push({ severity: "warning", filePath: warnMatch[1], target: warnMatch[2], message: line.replace(/^warn:\s+/, "") });
    }
  }
  return findings;
}
