import { test } from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ensureBrainMd,
  scaffoldBrainSkeleton,
  hasGitRepo,
  hasPreCommitHook,
  installPreCommitHook,
  readExistingPreCommitHook,
  detectProjectMode,
} from "../src/setupFiles";
import type { BrainDirInfo } from "../src/brainDir";

// The repo root itself is shaped like extension/assets: it has a skills/
// subtree, so it doubles as an assetsDir fixture for these tests without
// needing a build step first.
const REPO_ROOT = join(__dirname, "..", "..", "..");

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "brain-md-setup-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function infoFor(dir: string, overrides: Partial<BrainDirInfo> = {}): BrainDirInfo {
  return { dir, origin: "default ./brain", source: "default", exists: false, populated: false, ...overrides };
}

test("ensureBrainMd creates BRAIN.md from the template when absent", async () => {
  await withTempDir((dir) => {
    const result = ensureBrainMd(REPO_ROOT, dir);
    assert.equal(result, "created");
    assert.ok(existsSync(join(dir, "BRAIN.md")));
    assert.match(readFileSync(join(dir, "BRAIN.md"), "utf8"), /NEVER hand-edit/);
  });
});

test("ensureBrainMd never overwrites an existing BRAIN.md", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "BRAIN.md"), "custom project content");
    const result = ensureBrainMd(REPO_ROOT, dir);
    assert.equal(result, "present");
    assert.equal(readFileSync(join(dir, "BRAIN.md"), "utf8"), "custom project content");
  });
});

test("scaffoldBrainSkeleton copies the six root pages and pages/ when unpopulated", async () => {
  await withTempDir((dir) => {
    const brainDir = join(dir, "brain");
    const result = scaffoldBrainSkeleton(REPO_ROOT, infoFor(brainDir));
    assert.equal(result, "scaffolded");
    for (const slug of ["background", "architecture", "flow", "mindmap", "stack", "roadmap"]) {
      assert.ok(existsSync(join(brainDir, `${slug}.md`)), `${slug}.md should exist`);
    }
    assert.ok(existsSync(join(brainDir, "pages")));
  });
});

test("scaffoldBrainSkeleton does nothing when already populated (no split brain)", async () => {
  await withTempDir((dir) => {
    const brainDir = join(dir, "brain"); // deliberately never created
    const result = scaffoldBrainSkeleton(REPO_ROOT, infoFor(brainDir, { populated: true }));
    assert.equal(result, "already-populated");
    assert.equal(existsSync(brainDir), false);
  });
});

test("scaffoldBrainSkeleton never overwrites a file already at the destination", async () => {
  await withTempDir((dir) => {
    const brainDir = join(dir, "brain");
    mkdirSync(brainDir, { recursive: true });
    writeFileSync(join(brainDir, "background.md"), "already customized");

    scaffoldBrainSkeleton(REPO_ROOT, infoFor(brainDir));

    assert.equal(readFileSync(join(brainDir, "background.md"), "utf8"), "already customized");
    assert.ok(existsSync(join(brainDir, "architecture.md")));
  });
});

test("hasGitRepo / pre-commit hook install lifecycle", async () => {
  await withTempDir((dir) => {
    assert.equal(hasGitRepo(dir), false);
    mkdirSync(join(dir, ".git", "hooks"), { recursive: true });
    assert.equal(hasGitRepo(dir), true);
    assert.equal(hasPreCommitHook(dir), false);

    installPreCommitHook(REPO_ROOT, dir);

    assert.equal(hasPreCommitHook(dir), true);
    const mode = statSync(join(dir, ".git", "hooks", "pre-commit")).mode;
    assert.ok((mode & 0o111) !== 0, "hook should be executable");
    assert.match(readExistingPreCommitHook(dir), /brain\.md pre-commit hook/);
  });
});

function initGitRepo(dir: string, commitCount: number): void {
  const git = (...args: string[]) => execFileSync("git", args, { cwd: dir, stdio: "ignore" });
  git("init", "-q");
  git("config", "user.email", "test@example.com");
  git("config", "user.name", "Test");
  for (let i = 0; i < commitCount; i++) {
    writeFileSync(join(dir, `file-${i}.txt`), `${i}`);
    git("add", ".");
    git("commit", "-q", "-m", `commit ${i}`);
  }
}

test("detectProjectMode: empty, non-git dir is greenfield", async () => {
  await withTempDir((dir) => {
    assert.equal(detectProjectMode(dir), "greenfield");
  });
});

test("detectProjectMode: brain-setup's own output (BRAIN.md, brain/, CLAUDE.md, .git) doesn't count as brownfield", async () => {
  await withTempDir((dir) => {
    initGitRepo(dir, 1);
    mkdirSync(join(dir, "brain"), { recursive: true });
    writeFileSync(join(dir, "BRAIN.md"), "x");
    writeFileSync(join(dir, "CLAUDE.md"), "x");
    assert.equal(detectProjectMode(dir), "greenfield");
  });
});

test("detectProjectMode: real git history (>=3 commits) is brownfield", async () => {
  await withTempDir((dir) => {
    initGitRepo(dir, 3);
    assert.equal(detectProjectMode(dir), "brownfield");
  });
});

test("detectProjectMode: existing source files with no/shallow git history is brownfield", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "package.json"), "{}");
    writeFileSync(join(dir, "index.js"), "");
    assert.equal(detectProjectMode(dir), "brownfield");
  });
});
