import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../app/cv-progressive.js", import.meta.url), "utf8");
test("CV wizard focuses each opened step and respects reduced-motion preferences", () => {
  assert.match(wizard, /headings\[index\]\.setAttribute\("tabindex", "-1"\)/);
  assert.match(wizard, /headings\[index\]\.focus\(\{ preventScroll: true \}\)/);
  assert.match(wizard, /prefers-reduced-motion: reduce/);
  assert.match(wizard, /headings\[index\]\.scrollIntoView\(/);
});
