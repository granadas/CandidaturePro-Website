import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const wizard = readFileSync(new URL("../app/cv-progressive.js", import.meta.url), "utf8");
test("CV mobile preview respects reduced motion and restores button focus", () => {
  assert.match(wizard, /if \(expanded\) \{\s*preview\.scrollIntoView\(/);
  assert.match(wizard, /behavior: window\.matchMedia\("\(prefers-reduced-motion: reduce\)"\)\.matches \? "auto" : "smooth"/);
  assert.match(wizard, /previewToggle\.focus\(\{ preventScroll: true \}\)/);
});
