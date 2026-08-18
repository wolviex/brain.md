import * as vscode from "vscode";
import { brainReadonlyGlob } from "./readonlyGlob";

/**
 * Add the brain dir to files.readonlyInclude so the editor refuses to save
 * over a brain file — the enforcement layer BRAIN.md currently admits it
 * lacks ("nothing at the file layer can stop a manual edit"). Merges into
 * whatever the user already has; never clobbers it. A brainRoot sidecar
 * outside the workspace can't be covered this way (brainReadonlyGlob
 * returns undefined) — that's a documented limitation, not a bug.
 */
export async function applyReadonlyGuard(workspaceRoot: string, brainDir: string): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const enabled = config.get<boolean>("brainMd.guard.readonly", true);
  if (!enabled) return;

  const glob = brainReadonlyGlob(workspaceRoot, brainDir);
  if (!glob) return;

  const current = config.get<Record<string, boolean>>("files.readonlyInclude") ?? {};
  if (current[glob]) return;

  await config.update("files.readonlyInclude", { ...current, [glob]: true }, vscode.ConfigurationTarget.Workspace);
}
