import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../app/cv-progressive.js", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/app.css", import.meta.url), "utf8");
test("mobile preview button is placed before the form, not after it", () => {
  assert.match(wizard, /form\.before\(previewToggle\)/);
  assert.doesNotMatch(wizard, /preview\.before\(previewToggle\)/);
});
test("expanded mobile preview is positioned before form", () => {
  assert.match(css, /\.cv-studio-layout\.cv-preview-expanded \.cv-live-aside\{order:0\}/);
  assert.match(css, /\.cv-studio-layout\.cv-preview-expanded \.cv-studio-form\{order:2\}/);
});
