import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
const js = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");

test("CV parcours includes a guided skill and language editor", () => {
  for (const id of ["cv-skill-kind", "cv-skill-name", "cv-skill-level", "cv-add-skill", "cv-skill-feedback"]) {
    assert.ok(html.includes('id="' + id + '"'));
  }
  assert.match(js, /cvAddSkill\.addEventListener\("click"/);
  assert.match(js, /event\.key !== "Enter" \|\| event\.isComposing/);
  assert.match(js, /cvAddSkill\.click\(\)/);
  assert.match(js, /cvSkillName\.placeholder = language/);
  assert.match(js, /target\.value = updated/);
  assert.match(js, /syncCvStudio\(\)/);
  assert.match(js, /Cette entrée figure déjà dans votre CV/);
});
