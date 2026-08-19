import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join } from "node:path";
import {
  AGENT_COMMANDS,
  detectInstalledAgents,
  isCommandOnPath,
  isSkillInstalledForCli,
} from "../src/review/agentCommands";

async function withTempDir<T>(fn: (dir: string) => T | Promise<T>): Promise<T> {
  const dir = mkdtempSync(join(tmpdir(), "brain-md-agent-commands-test-"));
  try {
    return await fn(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

function makeExecutable(path: string): void {
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, 0o755);
}

// ---- isCommandOnPath ----------------------------------------------------

test("isCommandOnPath finds an executable file on PATH (posix)", async () => {
  await withTempDir((dir) => {
    makeExecutable(join(dir, "claude"));
    assert.equal(isCommandOnPath("claude", { pathEnv: dir, platform: "linux" }), true);
  });
});

test("isCommandOnPath is false when the file exists but isn't executable (posix)", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "claude"), "#!/bin/sh\n"); // no chmod +x
    assert.equal(isCommandOnPath("claude", { pathEnv: dir, platform: "linux" }), false);
  });
});

test("isCommandOnPath is false when nothing matches", async () => {
  await withTempDir((dir) => {
    assert.equal(isCommandOnPath("claude", { pathEnv: dir, platform: "linux" }), false);
  });
});

test("isCommandOnPath searches every PATH entry in order", async () => {
  await withTempDir(async (dir) => {
    const empty = join(dir, "empty");
    const populated = join(dir, "populated");
    mkdirSync(empty);
    mkdirSync(populated);
    makeExecutable(join(populated, "codex"));

    const pathEnv = [empty, populated].join(delimiter);
    assert.equal(isCommandOnPath("codex", { pathEnv, platform: "linux" }), true);
  });
});

test("isCommandOnPath matches a .exe on windows regardless of executable bits", async () => {
  await withTempDir((dir) => {
    writeFileSync(join(dir, "claude.exe"), "not a real binary");
    assert.equal(isCommandOnPath("claude", { pathEnv: dir, platform: "win32" }), true);
  });
});

// ---- detectInstalledAgents ------------------------------------------------

test("detectInstalledAgents only returns commands whose binary is present", async () => {
  await withTempDir((dir) => {
    makeExecutable(join(dir, "claude"));
    const detected = detectInstalledAgents({ pathEnv: dir, platform: "linux" });
    assert.deepEqual(
      detected.map((c) => c.cli),
      ["claude"],
    );
  });
});

test("detectInstalledAgents returns nothing when PATH is empty", async () => {
  await withTempDir((dir) => {
    assert.deepEqual(detectInstalledAgents({ pathEnv: dir, platform: "linux" }), []);
  });
});

// ---- AGENT_COMMANDS shell command builders -------------------------------

test("claude and codex seed the interactive session with the prompt via bare positional argument", () => {
  const claude = AGENT_COMMANDS.find((c) => c.cli === "claude")!;
  const codex = AGENT_COMMANDS.find((c) => c.cli === "codex")!;
  assert.equal(claude.seedsPrompt, true);
  assert.equal(codex.seedsPrompt, true);
  assert.equal(claude.buildShellCommand("/tmp/prompt.md"), `claude "$(cat '/tmp/prompt.md')"`);
  assert.equal(codex.buildShellCommand("/tmp/prompt.md"), `codex "$(cat '/tmp/prompt.md')"`);
  // Must not use `codex exec`, which is documented as non-interactive.
  assert.doesNotMatch(codex.buildShellCommand("/tmp/prompt.md"), /codex exec/);
});

test("opencode does not claim to seed the prompt — there's no documented syntax for that", () => {
  const opencode = AGENT_COMMANDS.find((c) => c.cli === "opencode")!;
  assert.equal(opencode.seedsPrompt, false);
  // Must not use `opencode run`, which is documented as non-interactive.
  assert.doesNotMatch(opencode.buildShellCommand("/tmp/prompt.md"), /opencode run/);
});

test("shell commands single-quote-escape a prompt path containing a quote", () => {
  const claude = AGENT_COMMANDS.find((c) => c.cli === "claude")!;
  const command = claude.buildShellCommand("/tmp/o'brien/prompt.md");
  // POSIX single-quote escaping: close the quote, emit an escaped quote, reopen.
  assert.equal(command, `claude "$(cat '/tmp/o'\\''brien/prompt.md')"`);
});

// ---- isSkillInstalledForCli -----------------------------------------------

test("isSkillInstalledForCli is true when the skill dir exists for that runtime", async () => {
  await withTempDir((home) => {
    mkdirSync(join(home, ".claude", "skills", "brain-ingest"), { recursive: true });
    assert.equal(isSkillInstalledForCli("claude", "brain-ingest", home), true);
  });
});

test("isSkillInstalledForCli is false when the skill isn't installed for that runtime", async () => {
  await withTempDir((home) => {
    mkdirSync(join(home, ".claude", "skills"), { recursive: true });
    assert.equal(isSkillInstalledForCli("claude", "brain-ingest", home), false);
  });
});

test("isSkillInstalledForCli checks the runtime matching the given cli, not any runtime", async () => {
  await withTempDir((home) => {
    mkdirSync(join(home, ".codex", "skills", "brain-ingest"), { recursive: true });
    assert.equal(isSkillInstalledForCli("claude", "brain-ingest", home), false);
    assert.equal(isSkillInstalledForCli("codex", "brain-ingest", home), true);
  });
});
