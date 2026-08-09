import { test } from "node:test";
import assert from "node:assert/strict";
import {
  appendTimelineArgs,
  createPageArgs,
  defaultSourceFor,
  defaultSummaryFor,
} from "../src/review/manualLandCommands";
import type { CapturedCommit } from "../src/capture/filter";

function commit(overrides: Partial<CapturedCommit> = {}): CapturedCommit {
  return {
    sha: "abcdef1234567890",
    subject: "fix the thing",
    body: "fix the thing",
    author: "someone",
    date: new Date().toISOString(),
    files: ["src/a.ts"],
    ...overrides,
  };
}

test("defaultSummaryFor uses the single commit's subject", () => {
  assert.equal(defaultSummaryFor([commit({ subject: "use markdown not sqlite" })]), "use markdown not sqlite");
});

test("defaultSummaryFor joins subjects for multiple commits", () => {
  const summary = defaultSummaryFor([commit({ subject: "a" }), commit({ subject: "b" })]);
  assert.equal(summary, "2 commits: a; b");
});

test("defaultSourceFor joins short SHAs", () => {
  const source = defaultSourceFor([commit({ sha: "abcdef1234567890" }), commit({ sha: "1234567abcdef00" })]);
  assert.equal(source, "abcdef1, 1234567");
});

test("appendTimelineArgs builds the required flags", () => {
  const args = appendTimelineArgs({ pageId: "use-markdown", kind: "decision", summary: "chose markdown" });
  assert.deepEqual(args, ["append-timeline", "--id", "use-markdown", "--kind", "decision", "--summary", "chose markdown"]);
});

test("appendTimelineArgs includes optional source and affects", () => {
  const args = appendTimelineArgs({
    pageId: "use-markdown",
    kind: "evidence",
    summary: "confirmed in practice",
    source: "abcdef1",
    affects: ["stack", "roadmap"],
  });
  assert.deepEqual(args, [
    "append-timeline",
    "--id",
    "use-markdown",
    "--kind",
    "evidence",
    "--summary",
    "confirmed in practice",
    "--source",
    "abcdef1",
    "--affects",
    "stack,roadmap",
  ]);
});

test("createPageArgs builds the required flags", () => {
  const args = createPageArgs({ id: "use-markdown", category: "decision", title: "Use Markdown not SQLite" });
  assert.deepEqual(args, ["create-page", "--id", "use-markdown", "--category", "decision", "--title", "Use Markdown not SQLite"]);
});

test("createPageArgs includes optional tags and source", () => {
  const args = createPageArgs({
    id: "use-markdown",
    category: "decision",
    title: "Use Markdown not SQLite",
    tags: ["storage", "format"],
    source: "abcdef1",
  });
  assert.deepEqual(args, [
    "create-page",
    "--id",
    "use-markdown",
    "--category",
    "decision",
    "--title",
    "Use Markdown not SQLite",
    "--tags",
    "storage,format",
    "--source",
    "abcdef1",
  ]);
});
