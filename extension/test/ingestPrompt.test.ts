import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIngestPrompt, writeIngestPrompt, type IngestPromptContext } from "../src/review/ingestPrompt";
import type { CapturedCommit } from "../src/capture/filter";

function commit(overrides: Partial<CapturedCommit> = {}): CapturedCommit {
  return {
    sha: "abcdef1234567890",
    subject: "use markdown not sqlite",
    body: "use markdown not sqlite\n\nSimpler to diff and read.",
    author: "someone",
    date: "2026-06-22T12:00:00.000Z",
    files: ["docs/decision.md"],
    ...overrides,
  };
}

function ctx(overrides: Partial<IngestPromptContext> = {}): IngestPromptContext {
  return {
    commits: [commit()],
    cliPath: "/home/user/.claude/skills/brain-page/bin/brain.mjs",
    listPagesOutput: "(no pages yet)",
    skillInstalled: true,
    ...overrides,
  };
}

test("buildIngestPrompt includes the inclusion test and the CLI-only rule", () => {
  const prompt = buildIngestPrompt(ctx());
  assert.match(prompt, /will this still matter in six months/);
  assert.match(prompt, /never hand-edit a brain file/);
});

test("buildIngestPrompt includes each commit's short sha, subject, and files", () => {
  const prompt = buildIngestPrompt(ctx({ commits: [commit({ sha: "abcdef1234567890", subject: "use markdown not sqlite" })] }));
  assert.match(prompt, /abcdef1 — use markdown not sqlite/);
  assert.match(prompt, /- docs\/decision\.md/);
});

test("buildIngestPrompt does not duplicate the body when it equals the subject", () => {
  const prompt = buildIngestPrompt(ctx({ commits: [commit({ subject: "fix bug", body: "fix bug" })] }));
  const occurrences = prompt.split("fix bug").length - 1;
  assert.equal(occurrences, 1);
});

test("buildIngestPrompt includes a distinct body when it differs from the subject", () => {
  const prompt = buildIngestPrompt(ctx({ commits: [commit({ subject: "fix bug", body: "fix bug\n\nRoot cause was X." })] }));
  assert.match(prompt, /Root cause was X\./);
});

test("buildIngestPrompt embeds the resolved CLI path", () => {
  const prompt = buildIngestPrompt(ctx({ cliPath: "/opt/brain/bin/brain.mjs" }));
  assert.match(prompt, /\/opt\/brain\/bin\/brain\.mjs/);
});

test("buildIngestPrompt includes the existing page list for the create-vs-update call", () => {
  const prompt = buildIngestPrompt(ctx({ listPagesOutput: "use-markdown\tUse Markdown not SQLite\tdecision\tactive" }));
  assert.match(prompt, /use-markdown\tUse Markdown not SQLite\tdecision\tactive/);
});

test("buildIngestPrompt instructs the agent to inspect the real diff, not just the file list", () => {
  const prompt = buildIngestPrompt(ctx());
  assert.match(prompt, /git show/);
});

test("buildIngestPrompt only names the brain-ingest skill when it's actually installed", () => {
  const withSkill = buildIngestPrompt(ctx({ skillInstalled: true }));
  const withoutSkill = buildIngestPrompt(ctx({ skillInstalled: false }));
  assert.match(withSkill, /Use the brain-ingest skill/);
  assert.doesNotMatch(withoutSkill, /brain-ingest skill/);
});

test("buildIngestPrompt notes when a commit's files couldn't be determined", () => {
  const prompt = buildIngestPrompt(ctx({ commits: [commit({ files: [], filesUnknown: true })] }));
  assert.match(prompt, /couldn't be determined/);
});

test("writeIngestPrompt writes a file under the storage dir and returns its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-md-ingest-test-"));
  try {
    const nested = join(dir, "does", "not", "exist", "yet");
    const path = writeIngestPrompt(nested, ctx());
    assert.ok(existsSync(path));
    assert.equal(readdirSync(nested).length, 1);
    assert.match(readFileSync(path, "utf8"), /use markdown not sqlite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
