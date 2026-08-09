import { runBrain } from "./cli";

export type BrainDirSource = "brainRoot" | "default";

export interface BrainDirInfo {
  dir: string;
  origin: string;
  source: BrainDirSource;
  exists: boolean;
  populated: boolean;
}

/**
 * Parse the fixed-shape output of `brain brain-dir`:
 *   <resolved dir>
 *   (<human-readable origin>)
 *   source: <brainRoot|default>
 *   exists: <true|false>
 *   populated: <true|false>
 * See cmdBrainDir in skills/brain-page/bin/brain.mjs — this mirrors that
 * output exactly and should be kept in sync with it.
 */
export function parseBrainDirOutput(stdout: string): BrainDirInfo {
  const lines = stdout.trim().split("\n").map((l) => l.trim());
  const dir = lines[0] ?? "";
  const origin = (lines[1] ?? "").replace(/^\(|\)$/g, "");
  const sourceLine = lines.find((l) => l.startsWith("source:"))?.slice("source:".length).trim();
  const existsLine = lines.find((l) => l.startsWith("exists:"))?.slice("exists:".length).trim();
  const populatedLine = lines.find((l) => l.startsWith("populated:"))?.slice("populated:".length).trim();

  if (sourceLine !== "brainRoot" && sourceLine !== "default") {
    throw new Error(`brain brain-dir: could not parse "source:" line from output:\n${stdout}`);
  }

  return {
    dir,
    origin,
    source: sourceLine,
    exists: existsLine === "true",
    populated: populatedLine === "true",
  };
}

export async function getBrainDir(cliPath: string, workspaceRoot: string): Promise<BrainDirInfo> {
  const result = await runBrain(cliPath, ["brain-dir"], { cwd: workspaceRoot });
  if (result.code !== 0) {
    throw new Error(`brain brain-dir failed (exit ${result.code}): ${result.stderr.trim() || result.stdout.trim()}`);
  }
  return parseBrainDirOutput(result.stdout);
}
