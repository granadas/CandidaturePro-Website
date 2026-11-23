import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const css = readFileSync(new URL("../app/app.css", import.meta.url), "utf8");
test("collapsible CV preview matches single-column tablet breakpoint", () => {
  const preview = css.slice(css.indexOf("/* On single-column layouts"));
  assert.match(css, /@media\(max-width:850px\)\{\.cv-studio-layout\{grid-template-columns:1fr\}/);
  assert.equal((preview.match(/@media\(max-width:850px\)\{/g) || []).length, 2);
  assert.match(preview, /\.cv-studio-layout\[data-cv-step="4"\] \.cv-mobile-preview-toggle\{display:none\}/);
});
