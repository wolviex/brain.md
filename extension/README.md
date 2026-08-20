# brain.md for code-server

A [code-server](https://coder.com/docs/code-server) / VS Code extension that brings the
[Open Project Brain Standard](https://github.com/wolviex/brain.md) into the editor: it offers to
scaffold a workspace's brain, guards it against hand edits, watches commits, and hands anything
worth capturing to a review step — never writing to the brain on its own.

This extension bundles the same `skills/` the root repo ships (the `brain` CLI and its templates)
and never reimplements any of it. Every write it makes goes through the real CLI, exactly the way
an agent following `BRAIN.md` would.

## What it does

- **Set up** — on opening an un-braned workspace, offers once to scaffold `BRAIN.md` + the brain
  skeleton, wire `CLAUDE.md` / `AGENTS.md`, and install a pre-commit hook. Never scaffolds
  silently, and honors a `brainRoot` redirect (`.mindmux/preferences.json`) instead of creating a
  second local `./brain`.
- **Guard** — adds the brain dir to `files.readonlyInclude` so the editor refuses to save over a
  brain file directly, and warns when a brain file changes without a recent CLI call behind it
  (e.g. an out-of-band `sed`). `lint-links` findings show up in the Problems panel.
- **Capture** — watches every open git repository for new commits (via the built-in Git
  extension, not a hook) and queues the ones that touch more than the brain's own files. A commit
  that's entirely inside the brain dir or is only wiring (`BRAIN.md` / `CLAUDE.md` / `AGENTS.md`)
  is dropped before it's ever queued, so the extension can't feed itself.
- **Review** — the one place anything actually gets written. Pick pending commits from the status
  bar and choose: hand off to an agent CLI (writes a `brain-ingest`-shaped prompt and opens a
  terminal), land manually yourself, or dismiss. The brain's own rule — *"will this still matter
  in six months, and is it hard to reconstruct from the code itself?"* — decides what's worth
  keeping, not the extension.
- **Browse** — a "Brain" activity bar view lists the six root pages and every page grouped by
  category.

## Install

**Open VSX** (the marketplace code-server uses):

```bash
# from a published Open VSX listing, once one exists
code-server --install-extension mindmux.brain-md
```

**Sideload a `.vsix`** built from this directory:

```bash
npm install
npm run package        # produces brain-md-<version>.vsix
code-server --install-extension brain-md-<version>.vsix
```

## Commands

| command | what it does |
|---|---|
| `Brain: Set Up Workspace` | scaffold / wire / hook, same flow as the activation prompt |
| `Brain: Review Pending Captures` | work through queued commits (also the status bar's click target) |
| `Brain: New Page` | `create-page` via a few prompts |
| `Brain: Reindex` | `brain reindex` |
| `Brain: Lint Links` | `brain lint-links`, findings also land in the Problems panel |
| `Brain: Install Agent Skills…` | symlink the four brain skills into chosen agent runtimes' global skills dirs — extension-native parity with the repo's `./setup` |
| `Brain: Refresh Status` | re-resolve `brain-dir` and redraw the status bar / tree |

## Settings

| setting | default | |
|---|---|---|
| `brainMd.cliPath` | `""` | use a specific `brain.mjs` instead of the bundled or repo-local one |
| `brainMd.guard.readonly` | `true` | add the brain dir to `files.readonlyInclude` |
| `brainMd.capture.enabled` | `true` | watch commits at all |
| `brainMd.capture.includeMerges` | `false` | also queue merge commits |
| `brainMd.capture.ignoreGlobs` | `[]` | commits whose files all match one of these are never queued |

## Development

```bash
npm install
npm run typecheck
npm test          # node:test over the pure modules (no vscode dependency)
npm run build      # bundle to dist/extension.js
npm run package    # produce a .vsix
```

`vscode` is only imported where interaction with the editor is actually needed — command
handlers, watchers, the tree view. Everything else (CLI-arg building, the feedback-loop filter,
the pending queue, glob math, output parsing) is plain Node and unit tested directly.

`extension/dist/` and the packaged `.vsix` are checked into this repo (for sideloading without a
build step), so they must stay in sync with `extension/src/`. That sync is CI's job, not a local
one: `.github/workflows/extension-release.yml` runs on every push to `main` that touches a build
input (`extension/src`, `package.json`, `esbuild.mjs`, `tsconfig.json`, `.vscodeignore`, `media/`,
or `../skills`) — typechecks, tests, bumps the patch version, rebuilds `dist/` + the `.vsix`, and
commits the result straight back to `main` as `github-actions[bot]`. A fresh version on every
release means the `.vsix` filename never collides with the last one, so sideloading it never needs
`--force`. Feature branches / PRs are not touched by this workflow — `dist/` and the `.vsix` on a
branch are just whatever was last committed by hand or by an earlier merge.
