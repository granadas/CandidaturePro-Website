import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
test("guided CV career fields support Enter without submitting the form", () => {
  const start = js.indexOf("// Guided career inputs:");
  const end = js.indexOf("const cvSkillKind", start);
  assert.ok(start >= 0 && end > start);
  const block = js.slice(start, end);
  for (const id of ["#cv-job-role", "#cv-job-company", "#cv-job-dates", "#cv-add-job", "#cv-degree", "#cv-school", "#cv-degree-dates", "#cv-add-degree"]) {
    assert.ok(block.includes(id), id);
  }
  assert.match(block, /event\.key !== "Enter" \|\| event\.isComposing/);
  assert.match(block, /event\.preventDefault\(\)/);
  assert.match(block, /button\.click\(\)/);
  assert.doesNotMatch(block, /#cv-job-results/);
});
