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

## Agent handoff and authentication

Handoff never touches an API key or any other credential. "Hand off to agent" writes a prompt
file, then runs your **already-installed, already-logged-in** CLI in a terminal — `claude`,
`codex`, or `opencode`, whichever are found on `PATH`. Whatever session that CLI already holds
(Claude Code's subscription OAuth in `~/.claude`, Codex's ChatGPT OAuth in `~/.codex/auth.json`,
or opencode's configured provider) is what the agent uses; the extension never sees it.

Each CLI is launched the way its own docs describe as *interactive, seeded with a prompt* —
`claude "<prompt>"` and `codex "<prompt>"` both start an interactive session pre-loaded with the
ingest prompt, so you watch the agent read the commits and apply its writes rather than kicking
off something unattended. `opencode` has no documented way to seed its TUI with an initial
message (`opencode run "<prompt>"` is explicitly the *non-interactive* form), so for opencode the
extension opens the TUI and leaves the prompt file's path on screen for you to paste in.

**On a remote code-server box, each CLI's normal browser-based login can break**, since the
callback needs to reach the machine running code-server, not yours:

- **Codex** — the OAuth callback binds `localhost:1455` on the server. Run `codex login --device-auth`
  instead (a workspace admin must have device-code auth enabled first).
- **Claude Code** — run `claude setup-token`; it prints a URL to open in any browser and stores a
  long-lived token for headless use.
- **opencode** — supports multiple model providers; run `opencode auth login` to connect one.

These same messages show up in the editor whenever no agent CLI is found on `PATH`.

## Install

**Open VSX** (the marketplace code-server uses):

```bash
# from a published Open VSX listing, once one exists
code-server --install-extension mindmux.brain-md
```

**Sideload a `.vsix` from the latest release** — CI publishes one automatically on every push to
`main` that touches the extension (see "Development" below). With just `curl` (no `gh` needed):

```bash
url=$(curl -s https://api.github.com/repos/wolviex/brain.md/releases/latest \
  | grep -o '"browser_download_url": *"[^"]*\.vsix"' | cut -d'"' -f4)
curl -L -o brain-md.vsix "$url"
code-server --install-extension brain-md.vsix
```

Or, with the [`gh` CLI](https://cli.github.com/):

```bash
gh release download --repo wolviex/brain.md --pattern '*.vsix' -D .
code-server --install-extension brain-md-<version>.vsix
```

Or just grab the asset from the [Releases page](https://github.com/wolviex/brain.md/releases) in a
browser and upload/copy it over.

**Or build a `.vsix` yourself** from this directory:

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

`extension/dist/` and the packaged `.vsix` are build output — gitignored, never committed.
`.github/workflows/extension-release.yml` handles releasing them: on every push to `main` that
touches `extension/src`, `package.json`, `esbuild.mjs`, `tsconfig.json`, `.vscodeignore`, `media/`,
or `../skills`, it typechecks, tests, bumps the patch version, builds, commits just the version
bump back to `main`, tags it (`extension-v<version>`), and publishes a GitHub Release with the
`.vsix` attached. A fresh version on every release means the filename never collides with a
previous one, so sideloading never needs `--force`. Can also be run on demand via
`workflow_dispatch` from the Actions tab. Feature branches / PRs are not touched by this
workflow.

## Known limitations

A code review of the initial merge fixed several data-loss and correctness bugs in commit
capture and the agent-handoff path (see this directory's git log for the detail). What's left,
roughly in order of how likely you are to notice it:

- **Multi-root workspaces are still only partially supported.** Commit capture resolves the
  correct workspace folder for a repo (including a repo opened on a subdirectory, or a folder
  that itself contains several repos), but the rest of the extension — commands, the tree view,
  the pending queue — is still scoped to `workspaceFolders[0]`. A symlinked workspace folder can
  also fail the folder-to-repo match, since the Git extension reports a realpath-resolved root;
  when that happens, capture logs and skips rather than guessing, so nothing gets misattributed,
  but nothing gets captured for that repo either.
- **Agent-handoff failure detection is a heuristic, not a guarantee.** The extension checks that
  a CLI is on `PATH` before offering it, and checks that its terminal is still open a moment after
  launch, which catches "not installed" and "crashed immediately." It cannot catch a CLI that
  starts, prints an auth error, and just sits there — VS Code doesn't expose terminal output
  without the newer Terminal Shell Integration API, which predates this extension's engine floor
  (`^1.85.0`). If a handoff silently does nothing, the commits are still in the pending queue.
- **The 10-minute post-handoff suppression window for hand-edit warnings is fixed, not adaptive.**
  A real agent session that runs long past that will start seeing "modified outside the brain
  CLI" warnings again for its own writes.
- **`workspaceState` updates from concurrent commit batches aren't serialized.** Two repos
  committing within the same debounce window, or two rapid batches from one repo, both read the
  queue before either writes it back — the second write can clobber the first's additions.
- **A `git log` range that's no longer resolvable** (repo re-cloned at the same path, history
  rewritten, aggressive `gc`) makes capture retry and fail on every change event for that repo
  until the workspace is reloaded, rather than re-baselining itself automatically.
- **A few CLI-failure paths still produce misleadingly clean UI**: a failed `brain lint-links`
  clears the Problems panel and reports "OK, no broken links"; a failed `brain list-pages` in the
  tree view or manual-landing flow reads as "no pages yet." Both are exit-code-blind today.
- **`globToRegExp`'s glob support is minimal** — no `?`, and a pattern like `**/*.lock` won't
  match a top-level `foo.lock` the way a full glob implementation would. Fine for the common
  `dist/**` / `*.json` cases `brainMd.capture.ignoreGlobs` is meant for; don't rely on more.
  Agent-ingest prompt files under the extension's storage dir are also never cleaned up.

None of these cause data loss on their own (the fixes that mattered for that — a commit's files
being misread as empty, the feedback-loop guard having a bypass, batches being dropped on a
transient CLI failure — are what the code review above addressed); they're rough edges, not
open safety issues.
