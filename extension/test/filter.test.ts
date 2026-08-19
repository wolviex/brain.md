import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { isBrainOnlyCommit, isWithinDir, shouldCapture, type CapturedCommit } from "../src/capture/filter";

// The common case: the open workspace folder IS the git repo root.
const workspaceRoot = "/home/user/project";
const repoRoot = workspaceRoot;
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

// ---- isWithinDir (the primitive the whole guard now rests on) --------------

test("isWithinDir is true for a direct child path", () => {
  assert.equal(isWithinDir("/repo/brain/pages/foo.md", "/repo/brain"), true);
});

test("isWithinDir is true for the dir itself", () => {
  assert.equal(isWithinDir("/repo/brain", "/repo/brain"), true);
});

test("isWithinDir is false for a sibling sharing a name prefix", () => {
  assert.equal(isWithinDir("/repo/brain-utils/index.ts", "/repo/brain"), false);
});

test("isWithinDir is false for a path outside the dir entirely", () => {
  assert.equal(isWithinDir("/repo/src/app.ts", "/repo/brain"), false);
});

test("isWithinDir works when dir is NOT nested under the path's original root — the C3 case", () => {
  // dir is a sibling of /repo/packages/web, not nested under it — the bug
  // this function replaces (relative(workspaceRoot, brainDir).startsWith(".."))
  // would have short-circuited to "not contained" here.
  assert.equal(isWithinDir("/repo/brain-sidecar/pages/foo.md", "/repo/brain-sidecar"), true);
});

// ---- isBrainOnlyCommit — the common case (repoRoot === workspaceRoot) ------

test("isBrainOnlyCommit is true when every changed file is inside the brain dir", () => {
  assert.equal(isBrainOnlyCommit(["brain/pages/foo.md", "brain/index.md"], repoRoot, workspaceRoot, brainDir), true);
});

test("isBrainOnlyCommit is true for the wiring files alone", () => {
  assert.equal(isBrainOnlyCommit(["BRAIN.md", "CLAUDE.md", "AGENTS.md"], repoRoot, workspaceRoot, brainDir), true);
});

test("isBrainOnlyCommit is true for brain files mixed with wiring files", () => {
  assert.equal(isBrainOnlyCommit(["brain/index.md", "BRAIN.md"], repoRoot, workspaceRoot, brainDir), true);
});

test("isBrainOnlyCommit is false when any file is outside the brain dir and not a wiring file", () => {
  assert.equal(isBrainOnlyCommit(["brain/index.md", "src/app.ts"], repoRoot, workspaceRoot, brainDir), false);
});

test("isBrainOnlyCommit is true for an empty file list (nothing to capture)", () => {
  assert.equal(isBrainOnlyCommit([], repoRoot, workspaceRoot, brainDir), true);
});

test("isBrainOnlyCommit does not false-positive on a sibling dir sharing a prefix (brain-utils vs brain)", () => {
  assert.equal(isBrainOnlyCommit(["brain-utils/index.ts"], repoRoot, workspaceRoot, brainDir), false);
});

// ---- isBrainOnlyCommit — repoRoot !== workspaceRoot (the C3 regression) ---
//
// The workspace is opened on a subdirectory of the repo (a common monorepo
// shape), and brainRoot redirects to a sidecar that's inside the repo but
// outside that subdirectory. Before the fix, isWithinDir's predecessor
// compared brainDir against workspaceRoot directly; since brainDir sits
// outside workspaceRoot, relative() produced a "../" path and the check
// short-circuited to "never brain-only" — every brain write got captured.

const monorepoRoot = "/repo";
const subfolderWorkspace = "/repo/packages/web";
const sidecarBrainDir = "/repo/brain-sidecar"; // inside the repo, outside the open subfolder

test("isBrainOnlyCommit correctly classifies a sidecar brain outside the workspace folder but inside the repo", () => {
  // Files are repo-root-relative, as gitWatcher.ts now reports them.
  const files = ["brain-sidecar/pages/foo.md", "brain-sidecar/index.md"];
  assert.equal(isBrainOnlyCommit(files, monorepoRoot, subfolderWorkspace, sidecarBrainDir), true);
});

test("isBrainOnlyCommit still captures real code changes under the same subfolder workspace", () => {
  const files = ["packages/web/src/app.ts"];
  assert.equal(isBrainOnlyCommit(files, monorepoRoot, subfolderWorkspace, sidecarBrainDir), false);
});

test("isBrainOnlyCommit finds wiring files relative to the workspace folder, not the repo root", () => {
  // brain wire writes BRAIN.md at the CLI's cwd, i.e. the workspace folder
  // — so in repo-relative terms that's packages/web/BRAIN.md, not BRAIN.md.
  const files = ["packages/web/BRAIN.md", "brain-sidecar/index.md"];
  assert.equal(isBrainOnlyCommit(files, monorepoRoot, subfolderWorkspace, sidecarBrainDir), true);
});

test("isBrainOnlyCommit does not mistake a repo-root BRAIN.md for the workspace's own wiring file", () => {
  // A BRAIN.md at the repo root (outside the packages/web workspace) is a
  // different file than packages/web/BRAIN.md and isn't wiring for this
  // workspace — it should not short-circuit the brain-only check.
  const files = ["BRAIN.md"];
  assert.equal(isBrainOnlyCommit(files, monorepoRoot, subfolderWorkspace, sidecarBrainDir), false);
});

// ---- shouldCapture -----------------------------------------------------

test("shouldCapture drops a brain-only commit — the feedback-loop guard", () => {
  const c = commit({ files: ["brain/pages/foo.md", "BRAIN.md"] });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir }), false);
});

test("shouldCapture keeps a mixed commit that also touches the brain", () => {
  const c = commit({ files: ["brain/pages/foo.md", "src/app.ts"] });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir }), true);
});

test("shouldCapture keeps an ordinary code commit", () => {
  const c = commit({ files: ["src/app.ts", "src/util.ts"] });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir }), true);
});

test("shouldCapture drops merge commits by default", () => {
  const c = commit({ files: ["src/app.ts"], isMerge: true });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir }), false);
});

test("shouldCapture keeps merge commits when includeMerges is set", () => {
  const c = commit({ files: ["src/app.ts"], isMerge: true });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir, includeMerges: true }), true);
});

test("shouldCapture drops a commit whose files all match an ignore glob", () => {
  const c = commit({ files: ["dist/bundle.js", "dist/bundle.js.map"] });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir, ignoreGlobs: ["dist/**"] }), false);
});

test("shouldCapture keeps a commit that only partially matches an ignore glob", () => {
  const c = commit({ files: ["dist/bundle.js", "src/app.ts"] });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir, ignoreGlobs: ["dist/**"] }), true);
});

test("shouldCapture ignore globs support single-segment * wildcards", () => {
  const c = commit({ files: ["package-lock.json"] });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir, ignoreGlobs: ["*.json"] }), false);
});

test("shouldCapture keeps a filesUnknown commit even though its file list is empty", () => {
  // An empty `files` array normally reads as brain-only (nothing to
  // capture). filesUnknown means we couldn't actually determine the files
  // — capture it rather than let it vacuously pass the brain-only check.
  const c = commit({ files: [], filesUnknown: true });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir }), true);
});

test("shouldCapture keeps a filesUnknown commit even with matching ignoreGlobs", () => {
  // Same vacuous-pass hazard on the ignoreGlobs branch: [].every(...) is
  // true, so without the filesUnknown short-circuit this would also be
  // silently dropped.
  const c = commit({ files: [], filesUnknown: true });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir, ignoreGlobs: ["**"] }), true);
});

test("shouldCapture still drops a filesUnknown merge commit when includeMerges is off", () => {
  // Merge-dropping is a deliberate user choice, not a data-loss concern —
  // filesUnknown shouldn't override it.
  const c = commit({ files: [], filesUnknown: true, isMerge: true });
  assert.equal(shouldCapture(c, { repoRoot, workspaceRoot, brainDir }), false);
});

test("shouldCapture closes the C3 hole end to end via a sidecar-brain commit", () => {
  const c = commit({ files: ["brain-sidecar/pages/foo.md"] });
  assert.equal(
    shouldCapture(c, { repoRoot: monorepoRoot, workspaceRoot: subfolderWorkspace, brainDir: sidecarBrainDir }),
    false,
  );
});
