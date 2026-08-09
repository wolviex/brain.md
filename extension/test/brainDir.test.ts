import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBrainDirOutput, getBrainDir } from "../src/brainDir";

test("parseBrainDirOutput parses the default-source shape", () => {
  const stdout = ["/workspace/brain", "(default ./brain)", "source: default", "exists: false", "populated: false", ""].join(
    "\n",
  );
  const info = parseBrainDirOutput(stdout);
  assert.deepEqual(info, {
    dir: "/workspace/brain",
    origin: "default ./brain",
    source: "default",
    exists: false,
    populated: false,
  });
});

test("parseBrainDirOutput parses the brainRoot-source shape", () => {
  const stdout = [
    "/external/myproject-brain",
    "(from brainRoot in ./.mindmux/preferences.json)",
    "source: brainRoot",
    "exists: true",
    "populated: true",
  ].join("\n");
  const info = parseBrainDirOutput(stdout);
  assert.equal(info.source, "brainRoot");
  assert.equal(info.exists, true);
  assert.equal(info.populated, true);
  assert.equal(info.origin, "from brainRoot in ./.mindmux/preferences.json");
});

test("parseBrainDirOutput throws on unrecognized output", () => {
  assert.throws(() => parseBrainDirOutput("garbage"), /could not parse/);
});

test("getBrainDir runs the real bundled CLI end-to-end against an empty workspace", async () => {
  const dir = mkdtempSync(join(tmpdir(), "brain-md-brain-dir-test-"));
  try {
    // Exercise the real, checked-in CLI (not a fixture) to prove the spawn
    // plumbing in cli.ts is actually compatible with brain.mjs's expectations.
    const cliPath = join(__dirname, "..", "..", "..", "skills", "brain-page", "bin", "brain.mjs");
    const info = await getBrainDir(cliPath, dir);
    assert.equal(info.source, "default");
    assert.equal(info.exists, false);
    assert.equal(info.populated, false);
    assert.equal(info.dir, join(dir, "brain"));
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
