// Build script for the brain.md extension.
//
// Two jobs: (1) bundle src/extension.ts -> dist/extension.js with esbuild,
// (2) copy the repo's skills/ into extension/assets/skills so the CLI and
// templates ship inside the .vsix. assets/skills is derived, gitignored, and
// regenerated on every build — skills/ at the repo root stays the source of
// truth.

import esbuild from "esbuild";
import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const production = process.argv.includes("--production");
const watch = process.argv.includes("--watch");

async function copySkillsAssets() {
  const src = path.join(__dirname, "..", "skills");
  const dest = path.join(__dirname, "assets", "skills");
  await rm(dest, { recursive: true, force: true });
  await mkdir(path.dirname(dest), { recursive: true });
  await cp(src, dest, { recursive: true });
}

async function main() {
  await copySkillsAssets();

  const ctx = await esbuild.context({
    entryPoints: ["src/extension.ts"],
    bundle: true,
    outfile: "dist/extension.js",
    external: ["vscode"],
    format: "cjs",
    platform: "node",
    target: "node18",
    sourcemap: !production,
    minify: production,
    logLevel: "info",
  });

  if (watch) {
    await ctx.watch();
    console.log("esbuild: watching for changes...");
  } else {
    await ctx.rebuild();
    await ctx.dispose();
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
