import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isBrainOnlyCommit, shouldCapture, type CapturedCommit } from "../src/capture/filter";

const workspaceRoot = "/home/user/project";
const brainDir = join(workspaceRoot, "brain");

function commit(overrides: Partial<CapturedCommit> = {}): CapturedCommit {
  return {
    sha: "abc123",
    subject: "test commit",
    body: "test commit",
    author: "someone",
    date: new Date().toISOString(),
    files: [],
    ...overrides,
  };
}

test("isBrainOnlyCommit is true when every changed file is inside the brain dir", () => {
  assert.equal(isBrainOnlyCommit(["brain/pages/foo.md", "brain/index.md"], workspaceRoot, brainDir), true);
});

test("isBrainOnlyCommit is true for the wiring files alone", () => {
  assert.equal(isBrainOnlyCommit(["BRAIN.md", "CLAUDE.md", "AGENTS.md"], workspaceRoot, brainDir), true);
});

test("isBrainOnlyCommit is true for brain files mixed with wiring files", () => {
  assert.equal(isBrainOnlyCommit(["brain/index.md", "BRAIN.md"], workspaceRoot, brainDir), true);
});

test("isBrainOnlyCommit is false when any file is outside the brain dir and not a wiring file", () => {
  assert.equal(isBrainOnlyCommit(["brain/index.md", "src/app.ts"], workspaceRoot, brainDir), false);
});

test("isBrainOnlyCommit is true for an empty file list (nothing to capture)", () => {
  assert.equal(isBrainOnlyCommit([], workspaceRoot, brainDir), true);
});

test("isBrainOnlyCommit does not false-positive on a sibling dir sharing a prefix (brain-utils vs brain)", () => {
  assert.equal(isBrainOnlyCommit(["brain-utils/index.ts"], workspaceRoot, brainDir), false);
});

test("isBrainOnlyCommit treats a brainRoot sidecar outside the workspace as never brain-only", () => {
  const outsideBrainDir = "/home/user/external-brain";
  assert.equal(isBrainOnlyCommit(["src/app.ts"], workspaceRoot, outsideBrainDir), false);
});

test("shouldCapture drops a brain-only commit — the feedback-loop guard", () => {
  const c = commit({ files: ["brain/pages/foo.md", "BRAIN.md"] });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir }), false);
});

test("shouldCapture keeps a mixed commit that also touches the brain", () => {
  const c = commit({ files: ["brain/pages/foo.md", "src/app.ts"] });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir }), true);
});

test("shouldCapture keeps an ordinary code commit", () => {
  const c = commit({ files: ["src/app.ts", "src/util.ts"] });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir }), true);
});

test("shouldCapture drops merge commits by default", () => {
  const c = commit({ files: ["src/app.ts"], isMerge: true });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir }), false);
});

test("shouldCapture keeps merge commits when includeMerges is set", () => {
  const c = commit({ files: ["src/app.ts"], isMerge: true });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir, includeMerges: true }), true);
});

test("shouldCapture drops a commit whose files all match an ignore glob", () => {
  const c = commit({ files: ["dist/bundle.js", "dist/bundle.js.map"] });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir, ignoreGlobs: ["dist/**"] }), false);
});

test("shouldCapture keeps a commit that only partially matches an ignore glob", () => {
  const c = commit({ files: ["dist/bundle.js", "src/app.ts"] });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir, ignoreGlobs: ["dist/**"] }), true);
});

test("shouldCapture ignore globs support single-segment * wildcards", () => {
  const c = commit({ files: ["package-lock.json"] });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir, ignoreGlobs: ["*.json"] }), false);
});

test("shouldCapture keeps a filesUnknown commit even though its file list is empty", () => {
  // An empty `files` array normally reads as brain-only (nothing to
  // capture). filesUnknown means we couldn't actually determine the files
  // — capture it rather than let it vacuously pass the brain-only check.
  const c = commit({ files: [], filesUnknown: true });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir }), true);
});

test("shouldCapture keeps a filesUnknown commit even with matching ignoreGlobs", () => {
  // Same vacuous-pass hazard on the ignoreGlobs branch: [].every(...) is
  // true, so without the filesUnknown short-circuit this would also be
  // silently dropped.
  const c = commit({ files: [], filesUnknown: true });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir, ignoreGlobs: ["**"] }), true);
});

test("shouldCapture still drops a filesUnknown merge commit when includeMerges is off", () => {
  // Merge-dropping is a deliberate user choice, not a data-loss concern —
  // filesUnknown shouldn't override it.
  const c = commit({ files: [], filesUnknown: true, isMerge: true });
  assert.equal(shouldCapture(c, { workspaceRoot, brainDir }), false);
});
