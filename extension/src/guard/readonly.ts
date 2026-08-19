import * as vscode from "vscode";
import { brainReadonlyGlob } from "./readonlyGlob";

/**
 * Add the brain dir to files.readonlyInclude so the editor refuses to save
 * over a brain file — the enforcement layer BRAIN.md currently admits it
 * lacks ("nothing at the file layer can stop a manual edit"). A brainRoot
 * sidecar outside the workspace can't be covered this way
 * (brainReadonlyGlob returns undefined) — that's a documented limitation,
 * not a bug.
 *
 * Reads and merges only the WORKSPACE-level value via inspect(), never
 * get()'s merged effective value — get() would copy the user's global
 * files.readonlyInclude entries verbatim into this repo's
 * .vscode/settings.json, which they'd neither expect nor be able to
 * reverse by editing their global settings. Never throws: a malformed
 * settings.json must not take down the guards that run after this one in
 * refreshStatus.
 */
export async function applyReadonlyGuard(workspaceRoot: string, brainDir: string, output?: vscode.OutputChannel): Promise<void> {
  const config = vscode.workspace.getConfiguration();
  const enabled = config.get<boolean>("brainMd.guard.readonly", true);
  if (!enabled) return;

  const glob = brainReadonlyGlob(workspaceRoot, brainDir);
  if (!glob) return;

  const current = config.inspect<Record<string, boolean>>("files.readonlyInclude")?.workspaceValue ?? {};
  if (current[glob]) return;

  try {
    await config.update("files.readonlyInclude", { ...current, [glob]: true }, vscode.ConfigurationTarget.Workspace);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    output?.appendLine(`brain guard: failed to update files.readonlyInclude — ${message}`);
  }
}
