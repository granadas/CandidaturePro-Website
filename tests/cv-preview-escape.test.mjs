import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../app/cv-progressive.js", import.meta.url), "utf8");
test("Escape closes expanded CV preview and returns keyboard focus", () => {
  assert.match(wizard, /preview\.addEventListener\("keydown", event => \{/);
  assert.match(wizard, /event\.key !== "Escape"/);
  assert.match(wizard, /layout\.classList\.remove\("cv-preview-expanded"\)/);
  assert.match(wizard, /previewToggle\.focus\(\{ preventScroll: true \}\)/);
});
