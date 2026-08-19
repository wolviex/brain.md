import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveCliPath, runBrain } from "../src/cli";

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "brain-md-cli-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("resolveCliPath prefers a configured path that exists", async () => {
  await withTempDir((dir) => {
    const configured = join(dir, "custom-brain.mjs");
    writeFileSync(configured, "");
    const resolved = resolveCliPath({
      configured,
      workspaceRoot: dir,
      extensionAssetsDir: join(dir, "assets"),
    });
    assert.equal(resolved, configured);
  });
});

test("resolveCliPath falls through a configured path that does not exist", async () => {
  await withTempDir((dir) => {
    const resolved = resolveCliPath({
      configured: join(dir, "missing.mjs"),
      workspaceRoot: dir,
      extensionAssetsDir: join(dir, "assets"),
    });
    assert.equal(resolved, join(dir, "assets", "skills", "brain-page", "bin", "brain.mjs"));
  });
});

test("resolveCliPath prefers a repo-local skills/ over the bundled copy", async () => {
  await withTempDir((dir) => {
    const repoLocalDir = join(dir, "skills", "brain-page", "bin");
    mkdirSync(repoLocalDir, { recursive: true });
    const repoLocal = join(repoLocalDir, "brain.mjs");
    writeFileSync(repoLocal, "");

    const resolved = resolveCliPath({
      workspaceRoot: dir,
      extensionAssetsDir: join(dir, "assets"),
    });
    assert.equal(resolved, repoLocal);
  });
});

test("resolveCliPath falls back to the bundled path when nothing else exists", async () => {
  await withTempDir((dir) => {
    const resolved = resolveCliPath({
      workspaceRoot: dir,
      extensionAssetsDir: join(dir, "assets"),
    });
    assert.equal(resolved, join(dir, "assets", "skills", "brain-page", "bin", "brain.mjs"));
  });
});

test("runBrain spawns via the host node with the given cwd, args, and stdin", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "echo-args.mjs");
    writeFileSync(
      script,
      [
        "process.stdout.write(JSON.stringify({ argv: process.argv.slice(2), cwd: process.cwd() }));",
        "let input = '';",
        "process.stdin.on('data', (c) => (input += c));",
        "process.stdin.on('end', () => process.stderr.write(input));",
      ].join("\n"),
    );

    const result = await runBrain(script, ["brain-dir", "--flag"], { cwd: dir, stdin: "hello" });

    assert.equal(result.code, 0);
    assert.equal(result.stderr, "hello");
    const parsed = JSON.parse(result.stdout);
    assert.deepEqual(parsed.argv, ["brain-dir", "--flag"]);
    assert.equal(parsed.cwd, dir);
  });
});

test("runBrain reports a non-zero exit code without throwing", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "fail.mjs");
    writeFileSync(script, "process.stderr.write('boom'); process.exit(2);");

    const result = await runBrain(script, [], { cwd: dir });

    assert.equal(result.code, 2);
    assert.equal(result.stderr, "boom");
  });
});

test("runBrain rejects and kills the child when it exceeds the timeout", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "hang.mjs");
    writeFileSync(script, "setInterval(() => {}, 1000);"); // never exits on its own

    await assert.rejects(runBrain(script, [], { cwd: dir, timeoutMs: 200 }), /timed out/);
  });
});

test("runBrain does not crash when the child exits before reading a large stdin write", async () => {
  await withTempDir(async (dir) => {
    const script = join(dir, "exit-immediately.mjs");
    writeFileSync(script, "process.exit(0);"); // never touches stdin

    // A write this size is far more likely to hit backpressure/EPIPE on a
    // child that closed its stdin before reading — this is what would
    // throw an unhandled 'error' event without the guard in cli.ts.
    const bigStdin = "x".repeat(5_000_000);
    const result = await runBrain(script, [], { cwd: dir, stdin: bigStdin });

    assert.equal(result.code, 0);
  });
});
