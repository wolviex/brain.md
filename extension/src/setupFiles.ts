import { execFileSync } from "node:child_process";
import { chmodSync, copyFileSync, cpSync, existsSync, readFileSync, readdirSync } from "node:fs";
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

export type ProjectMode = "brownfield" | "greenfield";

// Files/dirs that brain-setup itself just created — don't let them count as
// "existing project content" when judging brownfield vs greenfield.
const SETUP_OWNED_ENTRIES = new Set([".git", "node_modules", "BRAIN.md", "brain", "CLAUDE.md", "AGENTS.md"]);

/**
 * Mirrors the brain-bootstrap skill's own "Step 0 — pick the mode" heuristic:
 * substantial source and/or real git history means brownfield (read code +
 * docs + git log); a near-empty repo means greenfield (interview instead).
 * Used only to decide which prompt to hand the user after a fresh scaffold —
 * never to gate scaffolding itself, and the agent re-judges this properly
 * when it actually runs brain-bootstrap.
 */
export function detectProjectMode(workspaceRoot: string): ProjectMode {
  let commitCount = 0;
  try {
    const out = execFileSync("git", ["rev-list", "--count", "HEAD"], { cwd: workspaceRoot, encoding: "utf8" });
    commitCount = parseInt(out.trim(), 10) || 0;
  } catch {
    commitCount = 0;
  }

  let otherEntries = 0;
  try {
    otherEntries = readdirSync(workspaceRoot).filter((entry) => !SETUP_OWNED_ENTRIES.has(entry)).length;
  } catch {
    otherEntries = 0;
  }

  return commitCount >= 3 || otherEntries >= 2 ? "brownfield" : "greenfield";
}
