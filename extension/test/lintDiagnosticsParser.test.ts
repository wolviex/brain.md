import { test } from "node:test";
import assert from "node:assert/strict";
import { parseLintLinksOutput } from "../src/guard/lintDiagnosticsParser";

test("parseLintLinksOutput parses a broken-link error line", () => {
  const stderr = "error: /brain/pages/foo.md → [[bar]] has no matching brain/pages/bar.md\nlint-links: 1 broken link";
  const findings = parseLintLinksOutput("", stderr);
  assert.equal(findings.length, 1);
  assert.deepEqual(findings[0], {
    severity: "error",
    filePath: "/brain/pages/foo.md",
    target: "bar",
    message: "/brain/pages/foo.md → [[bar]] has no matching brain/pages/bar.md",
  });
});

test("parseLintLinksOutput parses a root-page-slug warning line", () => {
  const stderr =
    "warn: /brain/pages/foo.md → [[architecture]] points at a root page slug; root pages are addressed by slug, not [[ ]].";
  const findings = parseLintLinksOutput("", stderr);
  assert.equal(findings.length, 1);
  assert.equal(findings[0].severity, "warning");
  assert.equal(findings[0].target, "architecture");
});

test("parseLintLinksOutput returns nothing for a clean OK line", () => {
  const stdout = "lint-links: OK (3 pages, 6 root pages scanned, no broken links)";
  assert.deepEqual(parseLintLinksOutput(stdout, ""), []);
});

test("parseLintLinksOutput handles multiple findings across stdout and stderr", () => {
  const stderr = [
    "error: /brain/pages/a.md → [[missing-one]] has no matching brain/pages/missing-one.md",
    "error: /brain/pages/b.md → [[missing-two]] has no matching brain/pages/missing-two.md",
    "lint-links: 2 broken links",
  ].join("\n");
  const findings = parseLintLinksOutput("", stderr);
  assert.equal(findings.length, 2);
  assert.deepEqual(
    findings.map((f) => f.target),
    ["missing-one", "missing-two"],
  );
});
