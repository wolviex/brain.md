import { isAbsolute, join, relative } from "node:path";

export interface CapturedCommit {
  sha: string;
  subject: string;
  body: string;
  author: string;
  date: string;
  /** Paths relative to the repo root, forward-slash normalized. Empty when filesUnknown is true. */
  files: string[];
  isMerge?: boolean;
  /**
   * True when the changed-file list could not be determined (a failed diff,
   * a root commit with no parent to diff against, or an empty diff result —
   * which is indistinguishable from a masked git failure at this layer; see
   * gitWatcher.ts's changedFiles()). Always treated as capturable rather
   * than silently dropped: failing open costs one dismissal in review,
   * failing closed costs the commit forever.
   */
  filesUnknown?: boolean;
}

export interface FilterOptions {
  /** Git repository root — `commit.files` are relative to this, not necessarily workspaceRoot. */
  repoRoot: string;
  /** The vscode workspace folder the brain CLI runs from — where `brain wire` writes BRAIN.md / CLAUDE.md / AGENTS.md. */
  workspaceRoot: string;
  brainDir: string;
  includeMerges?: boolean;
  ignoreGlobs?: string[];
}

// Files a `brain wire` run touches directly. A commit that only changes
// these plus brain-dir content is the extension's own doing, not new
// project knowledge — capturing it would feed the extension back on itself.
const WIRING_FILES = new Set(["BRAIN.md", "CLAUDE.md", "AGENTS.md"]);

function normalize(file: string): string {
  return file.replace(/\\/g, "/");
}

function globToRegExp(glob: string): RegExp {
  // Match "**" before "*" via alternation order (not length) so a run of
  // two stars becomes one ".*" instead of two "[^/]*" back to back.
  const escaped = glob.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  const pattern = escaped.replace(/\*\*|\*/g, (m) => (m === "**" ? ".*" : "[^/]*"));
  return new RegExp(`^${pattern}$`);
}

/**
 * True when `absolutePath` is `dir` itself or nested under it. Both inputs
 * must already be absolute — this does no relativizing of its own, so it
 * works the same whether `dir` sits inside, outside, or as a sibling of
 * whatever root `absolutePath` was originally expressed relative to. That's
 * the fix for the case a plain `relative(workspaceRoot, brainDir)` check
 * can't handle: a brainRoot sidecar that is outside the *workspace folder*
 * but still inside the *repo* (e.g. the workspace is opened on a
 * subdirectory of a monorepo) used to make every file compare as "outside",
 * so isWithinDir would short-circuit to false and the guard never engaged.
 */
export function isWithinDir(absolutePath: string, dir: string): boolean {
  const rel = normalize(relative(dir, absolutePath));
  return rel === "" || (!rel.startsWith("..") && !isAbsolute(rel));
}

/**
 * True when every changed file is inside the brain dir or is a wiring file
 * — the feedback-loop guard. `files` are relative to `repoRoot` (that's
 * what the Git extension's diff API is naturally rooted at); wiring files
 * are relative to `workspaceRoot` (that's the brain CLI's cwd, which
 * `brain wire` uses to place BRAIN.md / CLAUDE.md / AGENTS.md) — the two
 * roots coincide in the common case but not when a workspace is opened on
 * a subdirectory of the repo.
 */
export function isBrainOnlyCommit(files: string[], repoRoot: string, workspaceRoot: string, brainDir: string): boolean {
  if (files.length === 0) return true;
  return files.every((f) => {
    const absoluteFile = join(repoRoot, normalize(f));
    if (isWithinDir(absoluteFile, workspaceRoot)) {
      const relToWorkspace = normalize(relative(workspaceRoot, absoluteFile));
      if (WIRING_FILES.has(relToWorkspace)) return true;
    }
    return isWithinDir(absoluteFile, brainDir);
  });
}

export function shouldCapture(commit: CapturedCommit, opts: FilterOptions): boolean {
  if (commit.isMerge && !opts.includeMerges) return false;
  // Can't classify this commit's files at all — capture it rather than run
  // it through checks that treat an empty file list as brain-only. An
  // empty `commit.files` here would otherwise vacuously pass both the
  // brain-only check and the ignoreGlobs check below, silently dropping a
  // commit we simply failed to inspect.
  if (commit.filesUnknown) return true;
  if (isBrainOnlyCommit(commit.files, opts.repoRoot, opts.workspaceRoot, opts.brainDir)) return false;

  const globs = (opts.ignoreGlobs ?? []).map(globToRegExp);
  if (globs.length > 0 && commit.files.every((f) => globs.some((re) => re.test(normalize(f))))) {
    return false;
  }

  return true;
}
