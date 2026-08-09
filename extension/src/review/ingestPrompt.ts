import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapturedCommit } from "../capture/filter";

/**
 * Builds a brain-ingest-shaped prompt: the framework's own inclusion test and
 * write rules, followed by the selected commits. This hands judgment to the
 * agent — the extension only ever detects and packages, never writes.
 */
export function buildIngestPrompt(commits: CapturedCommit[]): string {
  const lines: string[] = [
    "Use the brain-ingest skill to review the following commits and decide what, if anything, belongs in the project brain.",
    "",
    "Apply the inclusion test from BRAIN.md: will this still matter in six months, and is it hard to reconstruct from the code itself?",
    "Prefer less but accurate — most commits carry no durable knowledge on their own. Only write what genuinely crystallizes a decision, requirement, constraint, or durable insight.",
    "Every write must go through the brain CLI (create-page / update-truth / append-timeline / update-root) — never hand-edit a brain file.",
    "",
    `${commits.length} commit(s) queued for review:`,
    "",
  ];
  for (const c of commits) {
    lines.push(`## ${c.sha.slice(0, 7)} — ${c.subject}`);
    if (c.body && c.body.trim() !== c.subject.trim()) lines.push("", c.body.trim());
    lines.push("", `Author: ${c.author}`, `Date: ${c.date}`, "Files changed:", ...c.files.map((f) => `- ${f}`), "");
  }
  return lines.join("\n");
}

/** Writes the prompt to a file under the extension's storage dir (outside the repo) and returns its path. */
export function writeIngestPrompt(storageDir: string, commits: CapturedCommit[]): string {
  mkdirSync(storageDir, { recursive: true });
  const path = join(storageDir, `brain-ingest-prompt-${Date.now()}.md`);
  writeFileSync(path, buildIngestPrompt(commits), "utf8");
  return path;
}
