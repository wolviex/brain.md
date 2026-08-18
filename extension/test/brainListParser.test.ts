import { test } from "node:test";
import assert from "node:assert/strict";
import { parseListPagesOutput } from "../src/view/brainListParser";

test("parseListPagesOutput parses tab-separated rows", () => {
  const stdout = "welcome\tWelcome\tproject\tactive\nuse-markdown\tUse Markdown not SQLite\tdecision\tactive";
  const pages = parseListPagesOutput(stdout);
  assert.deepEqual(pages, [
    { id: "welcome", title: "Welcome", category: "project", status: "active" },
    { id: "use-markdown", title: "Use Markdown not SQLite", category: "decision", status: "active" },
  ]);
});

test("parseListPagesOutput returns an empty array for the no-pages sentinel", () => {
  assert.deepEqual(parseListPagesOutput("(no pages yet)\n"), []);
});

test("parseListPagesOutput returns an empty array for blank output", () => {
  assert.deepEqual(parseListPagesOutput("   \n  "), []);
});
