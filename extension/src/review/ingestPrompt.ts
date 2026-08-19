import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { CapturedCommit } from "../capture/filter";

export interface IngestPromptContext {
  commits: CapturedCommit[];
  /** The resolved brain CLI path, so the agent doesn't have to guess how to invoke it. */
  cliPath: string;
  /** `brain list-pages` stdout, so the agent can check for an existing page on the same topic before creating a duplicate. */
  listPagesOutput: string;
  /** Whether the brain-ingest skill is actually installed for the chosen agent — only reference it by name when it is. */
  skillInstalled: boolean;
}

/**
 * Builds a brain-ingest-shaped prompt: the framework's own inclusion test
 * and write rules, the resolved CLI path and existing page list, then the
 * selected commits with an instruction to inspect each one's real diff
 * rather than judge it from the subject line and file list alone — those
 * two are rarely enough to tell whether something is durable knowledge.
 * This hands judgment to the agent — the extension only ever detects and
 * packages, never writes.
 */
export function buildIngestPrompt(ctx: IngestPromptContext): string {
  const lines: string[] = [
    ctx.skillInstalled
      ? "Use the brain-ingest skill to review the following commits and decide what, if anything, belongs in the project brain."
      : "Review the following commits and decide what, if anything, belongs in the project brain, following the process below.",
    "",
    "Apply the inclusion test from BRAIN.md: will this still matter in six months, and is it hard to reconstruct from the code itself?",
    "Prefer less but accurate — most commits carry no durable knowledge on their own. Only write what genuinely crystallizes a decision, requirement, constraint, or durable insight.",
    `Every write must go through the brain CLI (create-page / update-truth / append-timeline / update-root), invoked as: node ${ctx.cliPath} <subcommand> — never hand-edit a brain file.`,
    "Before creating a new page, check the existing pages below for one already covering the same topic and update it instead of duplicating it.",
    "",
    "For each commit, run `git show --stat <sha>` (or `git show <sha>` for the full diff) before judging it — the subject line and file list below are rarely enough on their own to tell whether something is durable.",
    "",
    "Existing brain pages (id / title / category / status):",
    ctx.listPagesOutput.trim() || "(no pages yet)",
    "",
    `${ctx.commits.length} commit(s) queued for review:`,
    "",
  ];
  for (const c of ctx.commits) {
    lines.push(`## ${c.sha.slice(0, 7)} — ${c.subject}`);
    if (c.body && c.body.trim() !== c.subject.trim()) lines.push("", c.body.trim());
    lines.push("", `Author: ${c.author}`, `Date: ${c.date}`);
    if (c.filesUnknown) {
      lines.push("Files changed: (couldn't be determined here — check with `git show --stat`)");
    } else {
      lines.push("Files changed:", ...c.files.map((f) => `- ${f}`));
    }
    lines.push("");
  }
  return lines.join("\n");
}

/** Writes the prompt to a file under the extension's storage dir (outside the repo) and returns its path. */
export function writeIngestPrompt(storageDir: string, ctx: IngestPromptContext): string {
  mkdirSync(storageDir, { recursive: true });
  const path = join(storageDir, `brain-ingest-prompt-${Date.now()}.md`);
  writeFileSync(path, buildIngestPrompt(ctx), "utf8");
  return path;
}
