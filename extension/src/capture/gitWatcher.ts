import * as vscode from "vscode";
import { relative, sep } from "node:path";
import type { CapturedCommit } from "./filter";

// A minimal slice of the vscode.git extension's exported API (version 1) —
// just the shapes this module actually calls. There's no published types
// package for it; extensions conventionally hand-roll this rather than take
// on a dependency for a handful of interfaces.
interface GitCommit {
  hash: string;
  message: string;
  parents: string[];
  authorName?: string;
  authorDate?: Date;
}

interface GitChange {
  uri: vscode.Uri;
}

interface GitRepositoryState {
  HEAD?: { commit?: string };
  onDidChange: vscode.Event<void>;
}

interface GitRepository {
  rootUri: vscode.Uri;
  state: GitRepositoryState;
  log(options?: { range?: string; maxEntries?: number }): Promise<GitCommit[]>;
  diffBetween(ref1: string, ref2: string): Promise<GitChange[]>;
}

type GitApiState = "uninitialized" | "initialized";

interface GitAPI {
  state: GitApiState;
  onDidChangeState: vscode.Event<GitApiState>;
  repositories: GitRepository[];
  onDidOpenRepository: vscode.Event<GitRepository>;
}

interface GitExtensionExports {
  getAPI(version: 1): GitAPI;
}

export type NewCommitsHandler = (repoRoot: string, commits: CapturedCommit[]) => void;
export type LastSeenChangedHandler = (repoRoot: string, sha: string) => void;

const DEBOUNCE_MS = 500;

// Repository.log() only honors `maxEntries` when `range` is absent (verified
// against the Git extension's own implementation — the two are mutually
// exclusive branches there), so a wide range from a branch switch or a
// long-overdue `git pull` can return thousands of commits despite the
// maxEntries we pass. Enforce our own cap so we never fan out one `git diff`
// subprocess per commit across an unbounded batch.
const MAX_COMMITS_PER_BATCH = 50;

/**
 * Watches every open git repository for new commits via the built-in Git
 * extension (not a post-commit hook) — this catches commits made from the
 * SCM UI, a terminal, or an agent alike, with no risk of colliding with an
 * existing hook (e.g. husky).
 */
export class GitWatcher implements vscode.Disposable {
  private disposables: vscode.Disposable[] = [];
  private readonly lastSeenByRepo = new Map<string, string>();

  constructor(
    private readonly output: vscode.OutputChannel,
    private readonly initialLastSeen: Record<string, string>,
    private readonly onNewCommits: NewCommitsHandler,
    private readonly onLastSeenChanged: LastSeenChangedHandler,
  ) {}

  async start(): Promise<void> {
    const gitExtension = vscode.extensions.getExtension<GitExtensionExports>("vscode.git");
    if (!gitExtension) {
      this.output.appendLine("brain capture: vscode.git extension not found — commit capture disabled.");
      return;
    }

    const exports = gitExtension.isActive ? gitExtension.exports : await gitExtension.activate();
    const api = exports.getAPI(1);

    const attach = () => {
      for (const repo of api.repositories) this.trackRepo(repo);
      this.disposables.push(api.onDidOpenRepository((repo) => this.trackRepo(repo)));
    };

    if (api.state === "initialized") {
      attach();
    } else {
      const sub = api.onDidChangeState((state) => {
        if (state === "initialized") {
          attach();
          sub.dispose();
        }
      });
      this.disposables.push(sub);
    }
  }

  private trackRepo(repo: GitRepository): void {
    const root = repo.rootUri.fsPath;
    const initial = this.initialLastSeen[root] ?? repo.state.HEAD?.commit ?? "";
    this.lastSeenByRepo.set(root, initial);

    let debounce: ReturnType<typeof setTimeout> | undefined;
    const sub = repo.state.onDidChange(() => {
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => void this.checkForNewCommits(repo), DEBOUNCE_MS);
    });
    this.disposables.push(sub);
  }

  private async checkForNewCommits(repo: GitRepository): Promise<void> {
    const root = repo.rootUri.fsPath;
    const head = repo.state.HEAD?.commit;
    if (!head) return;

    const lastSeen = this.lastSeenByRepo.get(root);
    if (head === lastSeen) return;

    if (!lastSeen) {
      // First time we've seen this repo have a HEAD at all (e.g. its very
      // first commit landed after activation) — baseline here rather than
      // risk `git log <head>` walking the entire history as "new".
      this.lastSeenByRepo.set(root, head);
      this.onLastSeenChanged(root, head);
      return;
    }

    try {
      // maxEntries is passed defensively (see MAX_COMMITS_PER_BATCH's
      // comment) but the real enforcement is the slice below, which holds
      // regardless of whether the API honors it.
      const log = await repo.log({ range: `${lastSeen}..${head}`, maxEntries: MAX_COMMITS_PER_BATCH + 1 });
      if (log.length > MAX_COMMITS_PER_BATCH) {
        this.output.appendLine(
          `brain capture: ${log.length}+ commits between ${lastSeen.slice(0, 7)} and ${head.slice(0, 7)} in ${root} ` +
            `(branch switch or large pull?) — capturing only the most recent ${MAX_COMMITS_PER_BATCH}.`,
        );
      }
      const capped = log.slice(0, MAX_COMMITS_PER_BATCH);

      const commits: CapturedCommit[] = [];
      for (const entry of capped) {
        const { files, unknown } = await this.changedFiles(repo, entry);
        commits.push({
          sha: entry.hash,
          subject: entry.message.split("\n")[0] ?? "",
          body: entry.message,
          author: entry.authorName ?? "",
          date: entry.authorDate ? entry.authorDate.toISOString() : "",
          files,
          filesUnknown: unknown,
          isMerge: (entry.parents?.length ?? 0) > 1,
        });
      }

      this.lastSeenByRepo.set(root, head);
      this.onLastSeenChanged(root, head);
      if (commits.length > 0) this.onNewCommits(root, commits.reverse());
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`brain capture: failed to read new commits in ${root} — ${message}`);
    }
  }

  private async changedFiles(repo: GitRepository, entry: GitCommit): Promise<{ files: string[]; unknown: boolean }> {
    const parent = entry.parents?.[0];
    if (!parent) {
      // Root commit — nothing to diff against here. Treat as unknown (never
      // silently "brain-only") so a repo's founding commit isn't uncapturable.
      return { files: [], unknown: true };
    }
    try {
      const changes = await repo.diffBetween(parent, entry.hash);
      if (changes.length === 0) {
        // A genuine zero-file commit is vanishingly rare, and the Git
        // extension's diff implementation resolves — rather than rejects —
        // with an empty array on a failed git invocation, so an empty
        // result here is indistinguishable from a masked failure. Treat it
        // as unknown rather than risk silently classifying a real commit
        // as brain-only.
        return { files: [], unknown: true };
      }
      return { files: changes.map((c) => this.toRepoRelative(repo, c.uri)), unknown: false };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.output.appendLine(`brain capture: failed to diff ${entry.hash.slice(0, 7)} in ${repo.rootUri.fsPath} — ${message}`);
      return { files: [], unknown: true };
    }
  }

  /**
   * `vscode.workspace.asRelativePath` is relative to the *workspace
   * folder*, and returns the input unchanged (i.e. absolute) for a path
   * outside every open folder. filter.ts needs paths consistently relative
   * to the *git repo root* regardless of which subdirectory is open as the
   * workspace, so this computes that directly instead.
   */
  private toRepoRelative(repo: GitRepository, uri: vscode.Uri): string {
    return relative(repo.rootUri.fsPath, uri.fsPath).split(sep).join("/");
  }

  dispose(): void {
    for (const d of this.disposables) d.dispose();
    this.disposables = [];
  }
}
