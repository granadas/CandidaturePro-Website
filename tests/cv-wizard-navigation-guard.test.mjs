import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../app/cv-progressive.js", import.meta.url), "utf8");

test("navigation tabs cannot skip required earlier fields", () => {
  assert.match(wizard, /function canNavigateTo\(target\)/);
  assert.match(wizard, /for \(let step = 0; step < target; step\+\+\)/);
  assert.match(wizard, /if \(canNavigateTo\(index\)\) show\(index\)/);
  assert.match(wizard, /if \(!canNavigateTo\(index \+ 1\)\) return/);
  assert.match(wizard, /invalid\.reportValidity\(\)/);
});
