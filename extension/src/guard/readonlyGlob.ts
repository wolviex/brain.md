import { isAbsolute, relative, sep } from "node:path";

/**
 * Compute the files.readonlyInclude glob for the brain dir, relative to the
 * workspace root. Returns undefined when the brain dir isn't inside the
 * workspace (a brainRoot sidecar redirected outside it) — that case can't be
 * covered by a workspace-scoped setting.
 */
export function brainReadonlyGlob(workspaceRoot: string, brainDir: string): string | undefined {
  const rel = relative(workspaceRoot, brainDir);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) return undefined;
  return `${rel.split(sep).join("/")}/**`;
}
