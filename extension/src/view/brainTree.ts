import * as vscode from "vscode";
import { join } from "node:path";
import { runBrain } from "../cli";
import type { BrainDirInfo } from "../brainDir";
import { parseListPagesOutput, type ListedPage } from "./brainListParser";

const ROOT_PAGE_SLUGS = ["background", "architecture", "flow", "mindmap", "stack", "roadmap"] as const;
const PAGE_CATEGORIES = ["project", "concept", "decision", "person", "reference"] as const;

type BrainTreeNode =
  | { kind: "section"; id: "root-pages" | "pages" }
  | { kind: "root-page"; slug: string; filePath: string }
  | { kind: "category"; category: string; pages: ListedPage[] }
  | { kind: "page"; page: ListedPage; filePath: string }
  | { kind: "message"; label: string };

const openCommand = (uri: vscode.Uri): vscode.Command => ({ command: "vscode.open", title: "Open", arguments: [uri] });

export class BrainTreeProvider implements vscode.TreeDataProvider<BrainTreeNode> {
  private readonly changeEmitter = new vscode.EventEmitter<void>();
  readonly onDidChangeTreeData = this.changeEmitter.event;

  private cliPath: string | undefined;
  private workspaceRoot: string | undefined;
  private brainInfo: BrainDirInfo | undefined;

  setContext(cliPath: string, workspaceRoot: string, brainInfo: BrainDirInfo | undefined): void {
    this.cliPath = cliPath;
    this.workspaceRoot = workspaceRoot;
    this.brainInfo = brainInfo;
    this.changeEmitter.fire();
  }

  refresh(): void {
    this.changeEmitter.fire();
  }

  getTreeItem(node: BrainTreeNode): vscode.TreeItem {
    switch (node.kind) {
      case "section": {
        const label = node.id === "root-pages" ? "Root Pages" : "Pages";
        const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.Expanded);
        item.contextValue = `brainMd.section.${node.id}`;
        return item;
      }
      case "root-page": {
        const item = new vscode.TreeItem(node.slug, vscode.TreeItemCollapsibleState.None);
        item.iconPath = new vscode.ThemeIcon("book");
        item.command = openCommand(vscode.Uri.file(node.filePath));
        return item;
      }
      case "category": {
        return new vscode.TreeItem(`${node.category} (${node.pages.length})`, vscode.TreeItemCollapsibleState.Collapsed);
      }
      case "page": {
        const item = new vscode.TreeItem(node.page.title || node.page.id, vscode.TreeItemCollapsibleState.None);
        if (node.page.status && node.page.status !== "active") item.description = node.page.status;
        item.iconPath = new vscode.ThemeIcon("note");
        item.command = openCommand(vscode.Uri.file(node.filePath));
        return item;
      }
      case "message":
        return new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
    }
  }

  async getChildren(node?: BrainTreeNode): Promise<BrainTreeNode[]> {
    if (!this.cliPath || !this.workspaceRoot) return [];

    if (!node) {
      return [{ kind: "section", id: "root-pages" }, { kind: "section", id: "pages" }];
    }

    if (!this.brainInfo?.populated) {
      return [{ kind: "message", label: 'not set up — run "Brain: Set Up Workspace"' }];
    }

    if (node.kind === "section" && node.id === "root-pages") {
      return ROOT_PAGE_SLUGS.map((slug) => ({
        kind: "root-page" as const,
        slug,
        filePath: join(this.brainInfo!.dir, `${slug}.md`),
      }));
    }

    if (node.kind === "section" && node.id === "pages") {
      const result = await runBrain(this.cliPath, ["list-pages"], { cwd: this.workspaceRoot });
      const pages = parseListPagesOutput(result.stdout);
      if (pages.length === 0) return [{ kind: "message", label: "(no pages yet)" }];
      return PAGE_CATEGORIES.filter((category) => pages.some((p) => p.category === category)).map((category) => ({
        kind: "category" as const,
        category,
        pages: pages.filter((p) => p.category === category),
      }));
    }

    if (node.kind === "category") {
      return node.pages.map((page) => ({
        kind: "page" as const,
        page,
        filePath: join(this.brainInfo!.dir, "pages", `${page.id}.md`),
      }));
    }

    return [];
  }
}
