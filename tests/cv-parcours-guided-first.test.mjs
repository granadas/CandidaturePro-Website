import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const section = html.slice(html.indexOf('id="cv-story"'), html.indexOf('id="cv-finish"'));
test("CV parcours prioritizes guided editors while retaining saved text fields", () => {
  for (const [button, field] of [["cv-add-job", "experience"], ["cv-add-degree", "education"], ["cv-add-skill", "skills"]]) {
    assert.ok(section.indexOf('id="' + button + '"') < section.indexOf('name="' + field + '"'));
    assert.equal((section.match(new RegExp('name="' + field + '"', "g")) || []).length, 1);
  }
  assert.equal((section.match(/class="wide cv-raw-editor"/g) || []).length, 3);
  assert.equal((section.match(/class="wide cv-entry-builder" open/g) || []).length, 1);
});
