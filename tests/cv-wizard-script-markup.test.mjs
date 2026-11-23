import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

test("CV wizard script is a real script element without stray escape text", () => {
  assert.match(html, /<script src="cv-progressive\.js\?v=[^"]+"><\/script>/);
  assert.doesNotMatch(html, /<\/script>\\n<script src="cv-progressive\.js/);
});
