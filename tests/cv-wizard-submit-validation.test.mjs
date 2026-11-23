import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/cv-progressive.js", import.meta.url), "utf8");
test("submit validation reveals invalid step before reporting error", () => {
  const start = source.indexOf('form.querySelectorAll(\'button[type="submit"]');
  const snippet = source.slice(start, source.indexOf('form.addEventListener("invalid"', start));
  assert.ok(start >= 0);
  assert.match(snippet, /event\.preventDefault\(\)/);
  assert.ok(snippet.indexOf("show(step)") < snippet.indexOf("invalid.reportValidity()"));
});
