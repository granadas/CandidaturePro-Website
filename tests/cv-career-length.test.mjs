import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
test("CV career entry length uses exact resulting text", () => {
  const start = source.indexOf("function appendCvEntry(");
  const end = source.indexOf('document.querySelector("#cv-add-job")', start);
  assert.ok(start >= 0 && end > start);
  const block = source.slice(start, end);
  assert.match(block, /const updated = \[target\.value\.trim\(\), block\]\.filter\(Boolean\)\.join\("\\n\\n"\)/);
  assert.match(block, /if \(updated\.length > target\.maxLength\)/);
  assert.match(block, /target\.value = updated/);
  assert.doesNotMatch(block, /block\.length \+ 2/);
});
