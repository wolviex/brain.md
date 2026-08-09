import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildIngestPrompt, writeIngestPrompt } from "../src/review/ingestPrompt";
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

test("buildIngestPrompt includes the inclusion test and the CLI-only rule", () => {
  const prompt = buildIngestPrompt([commit()]);
  assert.match(prompt, /will this still matter in six months/);
  assert.match(prompt, /never hand-edit a brain file/);
});

test("buildIngestPrompt includes each commit's short sha, subject, and files", () => {
  const prompt = buildIngestPrompt([commit({ sha: "abcdef1234567890", subject: "use markdown not sqlite" })]);
  assert.match(prompt, /abcdef1 — use markdown not sqlite/);
  assert.match(prompt, /- docs\/decision\.md/);
});

test("buildIngestPrompt does not duplicate the body when it equals the subject", () => {
  const prompt = buildIngestPrompt([commit({ subject: "fix bug", body: "fix bug" })]);
  const occurrences = prompt.split("fix bug").length - 1;
  assert.equal(occurrences, 1);
});

test("buildIngestPrompt includes a distinct body when it differs from the subject", () => {
  const prompt = buildIngestPrompt([commit({ subject: "fix bug", body: "fix bug\n\nRoot cause was X." })]);
  assert.match(prompt, /Root cause was X\./);
});

test("writeIngestPrompt writes a file under the storage dir and returns its path", () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-md-ingest-test-"));
  try {
    const nested = join(dir, "does", "not", "exist", "yet");
    const path = writeIngestPrompt(nested, [commit()]);
    assert.ok(existsSync(path));
    assert.equal(readdirSync(nested).length, 1);
    assert.match(readFileSync(path, "utf8"), /use markdown not sqlite/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
