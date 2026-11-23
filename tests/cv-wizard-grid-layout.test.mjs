import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../app/cv-progressive.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/app.css", import.meta.url), "utf8");

test("wizard progress does not become a child of the two-column studio grid", () => {
  assert.match(css, /\.cv-studio-layout\{display:grid;grid-template-columns:/);
  assert.match(wizard, /\(layout \|\| form\)\.before\(progress\)/);
  assert.doesNotMatch(wizard, /form\.before\(progress\)/);
});
