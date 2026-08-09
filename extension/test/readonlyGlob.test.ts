import { test } from "node:test";
import assert from "node:assert/strict";
import { join } from "node:path";
import { brainReadonlyGlob } from "../src/guard/readonlyGlob";

test("brainReadonlyGlob computes a forward-slash glob relative to the workspace root", () => {
  const workspaceRoot = "/home/user/project";
  const brainDir = join(workspaceRoot, "brain");
  assert.equal(brainReadonlyGlob(workspaceRoot, brainDir), "brain/**");
});

test("brainReadonlyGlob handles a nested brain dir", () => {
  const workspaceRoot = "/home/user/project";
  const brainDir = join(workspaceRoot, "packages", "docs", "brain");
  assert.equal(brainReadonlyGlob(workspaceRoot, brainDir), "packages/docs/brain/**");
});

test("brainReadonlyGlob returns undefined for a brainRoot sidecar outside the workspace", () => {
  const workspaceRoot = "/home/user/project";
  const brainDir = "/home/user/external-brain";
  assert.equal(brainReadonlyGlob(workspaceRoot, brainDir), undefined);
});

test("brainReadonlyGlob returns undefined when the brain dir equals the workspace root", () => {
  const workspaceRoot = "/home/user/project";
  assert.equal(brainReadonlyGlob(workspaceRoot, workspaceRoot), undefined);
});
