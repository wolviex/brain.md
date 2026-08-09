import { chmodSync, copyFileSync, cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import type { BrainDirInfo } from "./brainDir";

/** assetsDir is extension/assets (or a test fixture shaped the same way) — it contains a skills/ subtree. */
export function assetPath(assetsDir: string, ...parts: string[]): string {
  return join(assetsDir, "skills", ...parts);
}

/** Copy BRAIN.md into the workspace root, unless one is already there. Never overwrites project content. */
export function ensureBrainMd(assetsDir: string, workspaceRoot: string): "created" | "present" {
  const dest = join(workspaceRoot, "BRAIN.md");
  if (existsSync(dest)) return "present";
  copyFileSync(assetPath(assetsDir, "brain-setup", "assets", "BRAIN.md"), dest);
  return "created";
}

/**
 * Copy the six root-page templates + index.md + pages/ skeleton into the
 * resolved brain dir, but only when it isn't already populated — never a
 * second local ./brain when a brainRoot redirect is in play — and never
 * overwriting a file that already exists at the destination.
 */
export function scaffoldBrainSkeleton(assetsDir: string, info: BrainDirInfo): "scaffolded" | "already-populated" {
  if (info.populated) return "already-populated";
  cpSync(assetPath(assetsDir, "brain-setup", "assets", "brain"), info.dir, {
    recursive: true,
    force: false,
    errorOnExist: false,
  });
  return "scaffolded";
}

export function hasGitRepo(workspaceRoot: string): boolean {
  return existsSync(join(workspaceRoot, ".git"));
}

export function preCommitHookPath(workspaceRoot: string): string {
  return join(workspaceRoot, ".git", "hooks", "pre-commit");
}

export function hasPreCommitHook(workspaceRoot: string): boolean {
  return existsSync(preCommitHookPath(workspaceRoot));
}

export function readExistingPreCommitHook(workspaceRoot: string): string {
  return readFileSync(preCommitHookPath(workspaceRoot), "utf8");
}

/** Install the bundled pre-commit hook. Caller must have already verified none exists. */
export function installPreCommitHook(assetsDir: string, workspaceRoot: string): void {
  const dest = preCommitHookPath(workspaceRoot);
  copyFileSync(assetPath(assetsDir, "brain-setup", "hooks", "pre-commit"), dest);
  chmodSync(dest, 0o755);
}
