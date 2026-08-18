import type { CapturedCommit } from "./filter";

export interface QueueState {
  pending: CapturedCommit[];
  /** Bounded, most-recent last. Prevents a commit from ever being re-offered after review. */
  handledShas: string[];
}

const MAX_PENDING = 200;
const MAX_HANDLED = 500;

export function emptyQueueState(): QueueState {
  return { pending: [], handledShas: [] };
}

/** Add newly-captured commits, skipping anything already pending or already handled. Bounded. */
export function enqueueCommits(state: QueueState, commits: CapturedCommit[]): QueueState {
  const handledSet = new Set(state.handledShas);
  const pendingShas = new Set(state.pending.map((c) => c.sha));
  const additions = commits.filter((c) => !handledSet.has(c.sha) && !pendingShas.has(c.sha));
  if (additions.length === 0) return state;
  const pending = [...state.pending, ...additions].slice(-MAX_PENDING);
  return { ...state, pending };
}

/** Remove the given commits from pending and record them as handled, so they're never offered again. */
export function markHandled(state: QueueState, shas: string[]): QueueState {
  if (shas.length === 0) return state;
  const shaSet = new Set(shas);
  const pending = state.pending.filter((c) => !shaSet.has(c.sha));
  const handledShas = [...state.handledShas, ...shas].slice(-MAX_HANDLED);
  return { pending, handledShas };
}

export function isHandled(state: QueueState, sha: string): boolean {
  return state.handledShas.includes(sha);
}
