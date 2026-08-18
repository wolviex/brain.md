import type { CapturedCommit } from "../capture/filter";

export function defaultSummaryFor(commits: CapturedCommit[]): string {
  if (commits.length === 1) return commits[0].subject;
  return `${commits.length} commits: ${commits.map((c) => c.subject).join("; ")}`;
}

export function defaultSourceFor(commits: CapturedCommit[]): string {
  return commits.map((c) => c.sha.slice(0, 7)).join(", ");
}

export type TimelineKind = "decision" | "evidence" | "reversal" | "note";
export type PageCategory = "project" | "concept" | "decision" | "person" | "reference";

export interface AppendTimelineInput {
  pageId: string;
  kind: TimelineKind;
  summary: string;
  source?: string;
  affects?: string[];
}

export function appendTimelineArgs(input: AppendTimelineInput): string[] {
  const args = ["append-timeline", "--id", input.pageId, "--kind", input.kind, "--summary", input.summary];
  if (input.source) args.push("--source", input.source);
  if (input.affects && input.affects.length > 0) args.push("--affects", input.affects.join(","));
  return args;
}

export interface CreatePageInput {
  id: string;
  category: PageCategory;
  title: string;
  tags?: string[];
  source?: string;
}

export function createPageArgs(input: CreatePageInput): string[] {
  const args = ["create-page", "--id", input.id, "--category", input.category, "--title", input.title];
  if (input.tags && input.tags.length > 0) args.push("--tags", input.tags.join(","));
  if (input.source) args.push("--source", input.source);
  return args;
}
