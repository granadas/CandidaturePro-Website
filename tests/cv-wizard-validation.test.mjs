import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../app/cv-progressive.js", import.meta.url), "utf8");

test("next step checks required fields before advancing", () => {
  assert.match(wizard, /input\.willValidate && input\.required && !input\.checkValidity\(\)/);
  assert.match(wizard, /required\[0\]\.reportValidity\(\)/);
  assert.match(wizard, /if \(required\.length\) \{/);
  assert.match(wizard, /show\(index \+ 1\)/);
});

test("wizard preserves form nodes instead of rebuilding inputs", () => {
  assert.match(wizard, /for \(const element of elements\) element\.hidden = step !== index/);
  assert.doesNotMatch(wizard, /form\.innerHTML\s*=/);
});
