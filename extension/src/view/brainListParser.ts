export interface ListedPage {
  id: string;
  title: string;
  category: string;
  status: string;
}

// Mirrors cmdListPages() in skills/brain-page/bin/brain.mjs:
// `${id}\t${title}\t${category}\t${status}` per line, or "(no pages yet)".
export function parseListPagesOutput(stdout: string): ListedPage[] {
  const trimmed = stdout.trim();
  if (!trimmed || trimmed === "(no pages yet)") return [];
  return trimmed.split("\n").map((line) => {
    const [id, title, category, status] = line.split("\t");
    return { id: id ?? "", title: title ?? "", category: category ?? "", status: status ?? "" };
  });
}
