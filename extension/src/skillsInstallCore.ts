import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface RuntimeCandidate {
  label: string;
  parentDir: string;
  skillsDir: string;
}

/** Mirrors the CANDIDATES list in the repo's own ./setup script — keep in sync with it. */
export function candidateRuntimes(home: string = homedir()): RuntimeCandidate[] {
  return [
    { label: "Claude", parentDir: join(home, ".claude"), skillsDir: join(home, ".claude", "skills") },
    { label: "Codex", parentDir: join(home, ".codex"), skillsDir: join(home, ".codex", "skills") },
    {
      label: "OpenCode",
      parentDir: join(home, ".config", "opencode"),
      skillsDir: join(home, ".config", "opencode", "skills"),
    },
    { label: "Cursor", parentDir: join(home, ".cursor"), skillsDir: join(home, ".cursor", "skills") },
    { label: "Pi", parentDir: join(home, ".pi", "agent"), skillsDir: join(home, ".pi", "agent", "skills") },
  ];
}

export function detectedRuntimes(home: string = homedir()): RuntimeCandidate[] {
  return candidateRuntimes(home).filter((r) => existsSync(r.parentDir));
}

export function stagingDir(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const base = env.XDG_DATA_HOME || join(home, ".local", "share");
  return join(base, "brain.md", "skills");
}

export function manifestPath(env: NodeJS.ProcessEnv = process.env, home: string = homedir()): string {
  const base = env.XDG_STATE_HOME || join(home, ".local", "state");
  return join(base, "brain.md", "installed-links");
}

const VERSION_MARKER = ".brain-md-version";

/**
 * Copy the bundled skills into a version-stable staging dir. A .vsix
 * install path changes on every upgrade, so symlinking agent runtimes
 * straight at it would break each time — this dir is refreshed (not
 * appended to) only when the extension version actually changed.
 */
export function ensureStagedSkills(assetsSkillsDir: string, staging: string, version: string): "refreshed" | "up-to-date" {
  const markerPath = join(staging, VERSION_MARKER);
  const currentVersion = existsSync(markerPath) ? readFileSync(markerPath, "utf8").trim() : undefined;
  if (currentVersion === version && existsSync(staging)) return "up-to-date";

  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const entry of readdirSync(assetsSkillsDir)) {
    cpSync(join(assetsSkillsDir, entry), join(staging, entry), { recursive: true });
  }
  writeFileSync(markerPath, version, "utf8");
  return "refreshed";
}

export function listSkillNames(staging: string): string[] {
  return readdirSync(staging, { withFileTypes: true })
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

export type LinkOutcome = "linked" | "relinked" | "backed-up-then-linked" | "skipped-conflict";

/** Mirrors ./setup's symlink-or-backup logic for a single skill target, so behavior stays identical. */
export function applyLink(source: string, target: string): LinkOutcome {
  mkdirSync(dirname(target), { recursive: true });

  let stat;
  try {
    stat = lstatSync(target);
  } catch {
    stat = undefined;
  }

  if (!stat) {
    symlinkSync(source, target, "dir");
    return "linked";
  }

  if (stat.isSymbolicLink()) {
    unlinkSync(target);
    symlinkSync(source, target, "dir");
    return "relinked";
  }

  // A real (non-symlink) directory is in the way — back it up once, don't destroy it.
  const backup = `${target}.pre-brain.bak`;
  if (existsSync(backup)) return "skipped-conflict";
  renameSync(target, backup);
  symlinkSync(source, target, "dir");
  return "backed-up-then-linked";
}

/** Same manifest file ./setup and ./uninstall use, so either can clean up links the other created. */
export function readManifest(path: string): string[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);
}

export function appendToManifest(path: string, targets: string[]): void {
  const existing = new Set(readManifest(path));
  for (const t of targets) existing.add(t);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${[...existing].sort().join("\n")}\n`, "utf8");
}
