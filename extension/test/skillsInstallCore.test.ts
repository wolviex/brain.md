import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  candidateRuntimes,
  detectedRuntimes,
  stagingDir,
  manifestPath,
  ensureStagedSkills,
  listSkillNames,
  applyLink,
  readManifest,
  appendToManifest,
} from "../src/skillsInstallCore";

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "brain-md-skills-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("candidateRuntimes lists all five known runtimes under the given home", () => {
  const runtimes = candidateRuntimes("/home/x");
  assert.deepEqual(
    runtimes.map((r) => r.label),
    ["Claude", "Codex", "OpenCode", "Cursor", "Pi"],
  );
  assert.equal(runtimes.find((r) => r.label === "OpenCode")?.skillsDir, join("/home/x", ".config", "opencode", "skills"));
});

test("detectedRuntimes only returns runtimes whose parent config dir exists", async () => {
  await withTempDir((home) => {
    mkdirSync(join(home, ".claude"), { recursive: true });
    mkdirSync(join(home, ".cursor"), { recursive: true });
    const detected = detectedRuntimes(home);
    assert.deepEqual(
      detected.map((r) => r.label),
      ["Claude", "Cursor"],
    );
  });
});

test("stagingDir and manifestPath honour XDG env vars, falling back to ~/.local", () => {
  assert.equal(stagingDir({}, "/home/x"), join("/home/x", ".local", "share", "brain.md", "skills"));
  assert.equal(stagingDir({ XDG_DATA_HOME: "/custom/data" }, "/home/x"), join("/custom/data", "brain.md", "skills"));
  assert.equal(manifestPath({}, "/home/x"), join("/home/x", ".local", "state", "brain.md", "installed-links"));
});

test("ensureStagedSkills copies skills in and stamps a version marker", async () => {
  await withTempDir((dir) => {
    const assetsSkills = join(dir, "assets-skills");
    mkdirSync(join(assetsSkills, "brain-page"), { recursive: true });
    writeFileSync(join(assetsSkills, "brain-page", "SKILL.md"), "hello");

    const staging = join(dir, "staging");
    const result = ensureStagedSkills(assetsSkills, staging, "0.1.0");
    assert.equal(result, "refreshed");
    assert.ok(existsSync(join(staging, "brain-page", "SKILL.md")));
    assert.deepEqual(listSkillNames(staging), ["brain-page"]);
  });
});

test("ensureStagedSkills is a no-op when the version hasn't changed", async () => {
  await withTempDir((dir) => {
    const assetsSkills = join(dir, "assets-skills");
    mkdirSync(join(assetsSkills, "brain-page"), { recursive: true });
    writeFileSync(join(assetsSkills, "brain-page", "SKILL.md"), "hello");
    const staging = join(dir, "staging");

    ensureStagedSkills(assetsSkills, staging, "0.1.0");
    writeFileSync(join(staging, "brain-page", "SKILL.md"), "customized after staging"); // simulate no re-copy
    const result = ensureStagedSkills(assetsSkills, staging, "0.1.0");

    assert.equal(result, "up-to-date");
    assert.equal(readFileSync(join(staging, "brain-page", "SKILL.md"), "utf8"), "customized after staging");
  });
});

test("ensureStagedSkills refreshes when the version changed", async () => {
  await withTempDir((dir) => {
    const assetsSkills = join(dir, "assets-skills");
    mkdirSync(join(assetsSkills, "brain-page"), { recursive: true });
    writeFileSync(join(assetsSkills, "brain-page", "SKILL.md"), "v1 content");
    const staging = join(dir, "staging");

    ensureStagedSkills(assetsSkills, staging, "0.1.0");
    writeFileSync(join(assetsSkills, "brain-page", "SKILL.md"), "v2 content");
    const result = ensureStagedSkills(assetsSkills, staging, "0.2.0");

    assert.equal(result, "refreshed");
    assert.equal(readFileSync(join(staging, "brain-page", "SKILL.md"), "utf8"), "v2 content");
  });
});

test("applyLink creates a fresh symlink when nothing is at the target", async () => {
  await withTempDir((dir) => {
    const source = join(dir, "source");
    mkdirSync(source);
    const target = join(dir, "runtime-skills", "brain-page");

    const outcome = applyLink(source, target);

    assert.equal(outcome, "linked");
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readlinkSync(target), source);
  });
});

test("applyLink relinks cleanly when a symlink is already there", async () => {
  await withTempDir((dir) => {
    const oldSource = join(dir, "old-source");
    const newSource = join(dir, "new-source");
    mkdirSync(oldSource);
    mkdirSync(newSource);
    const target = join(dir, "runtime-skills", "brain-page");
    mkdirSync(join(dir, "runtime-skills"), { recursive: true });
    symlinkSync(oldSource, target, "dir");

    const outcome = applyLink(newSource, target);

    assert.equal(outcome, "relinked");
    assert.equal(readlinkSync(target), newSource);
  });
});

test("applyLink backs up a real directory in the way instead of destroying it", async () => {
  await withTempDir((dir) => {
    const source = join(dir, "source");
    mkdirSync(source);
    const target = join(dir, "runtime-skills", "brain-page");
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "user-file.md"), "do not lose me");

    const outcome = applyLink(source, target);

    assert.equal(outcome, "backed-up-then-linked");
    assert.equal(lstatSync(target).isSymbolicLink(), true);
    assert.equal(readFileSync(join(`${target}.pre-brain.bak`, "user-file.md"), "utf8"), "do not lose me");
  });
});

test("applyLink skips rather than clobbering when a backup already exists", async () => {
  await withTempDir((dir) => {
    const source = join(dir, "source");
    mkdirSync(source);
    const target = join(dir, "runtime-skills", "brain-page");
    mkdirSync(target, { recursive: true });
    mkdirSync(`${target}.pre-brain.bak`, { recursive: true });

    const outcome = applyLink(source, target);

    assert.equal(outcome, "skipped-conflict");
    assert.equal(lstatSync(target).isSymbolicLink(), false); // untouched
  });
});

test("appendToManifest merges and dedupes with an existing manifest, sorted", async () => {
  await withTempDir((dir) => {
    const manifest = join(dir, "state", "installed-links");
    appendToManifest(manifest, ["/z/link", "/a/link"]);
    appendToManifest(manifest, ["/a/link", "/m/link"]);

    assert.deepEqual(readManifest(manifest), ["/a/link", "/m/link", "/z/link"]);
  });
});
