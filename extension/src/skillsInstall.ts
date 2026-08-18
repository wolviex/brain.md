import * as vscode from "vscode";
import { join } from "node:path";
import {
  applyLink,
  appendToManifest,
  detectedRuntimes,
  ensureStagedSkills,
  listSkillNames,
  manifestPath,
  stagingDir,
} from "./skillsInstallCore";

/**
 * Extension-native parity with the repo's ./setup script: symlink the four
 * brain skills into the chosen agent runtimes' global skills dirs, via a
 * version-stable staging copy so a .vsix upgrade (new install path each
 * time) doesn't dangle every runtime's symlink. Appends to the same
 * manifest ./setup and ./uninstall already use.
 */
export async function installAgentSkills(
  assetsSkillsDir: string,
  extensionVersion: string,
  output: vscode.OutputChannel,
): Promise<void> {
  const detected = detectedRuntimes();
  if (detected.length === 0) {
    void vscode.window.showWarningMessage(
      "brain.md: no agent runtime config dirs found (looked for ~/.claude, ~/.codex, ~/.config/opencode, ~/.cursor, ~/.pi/agent).",
    );
    return;
  }

  const picked = await vscode.window.showQuickPick(
    detected.map((r) => ({ label: r.label, description: r.skillsDir, runtime: r })),
    { title: "brain.md: install skills into which runtimes?", canPickMany: true },
  );
  if (!picked || picked.length === 0) return;

  const staging = stagingDir();
  const refreshResult = ensureStagedSkills(assetsSkillsDir, staging, extensionVersion);
  output.appendLine(`brain skills: staging ${refreshResult} at ${staging}`);

  const skillNames = listSkillNames(staging);
  const linkedTargets: string[] = [];
  for (const { runtime } of picked) {
    for (const skill of skillNames) {
      const target = join(runtime.skillsDir, skill);
      const outcome = applyLink(join(staging, skill), target);
      output.appendLine(`brain skills: ${outcome} ${target}`);
      if (outcome !== "skipped-conflict") linkedTargets.push(target);
    }
  }

  if (linkedTargets.length > 0) {
    appendToManifest(manifestPath(), linkedTargets);
  }

  void vscode.window.showInformationMessage(
    `brain.md: installed skills into ${picked.length} runtime(s). Manifest: ${manifestPath()}`,
  );
}
