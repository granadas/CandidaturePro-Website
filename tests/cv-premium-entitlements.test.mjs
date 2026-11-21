import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

function section(start, end) {
  const a = app.indexOf(start), b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "CV code section missing: " + start);
  return app.slice(a, b);
}

test("CV Premium entitlement checks plan and expiry", () => {
  const fn = section("function hasPremiumCv()", "const cvAnalyze =");
  assert.match(fn, /profile\?\.plan/);
  assert.match(fn, /premium/);
  assert.match(fn, /premium_until/);
  assert.match(fn, /Date\.parse\(profile\.premium_until\) > Date\.now\(\)/);
});

test("CV model options and access status are visible in the editor", () => {
  for (const model of ["classic", "modern", "compact"]) {
    assert.ok(html.includes('<option value="' + model + '">'));
  }
  assert.match(html, /id="cv-premium-access-status"/);
  const render = section("function renderAccount()", "function showView(");
  assert.match(render, /option:not\(\[value=classic\]\)/);
  assert.match(render, /option\.disabled = !isPremium/);
  assert.match(render, /cv-premium-access-status/);
});

test("saving a premium CV checks entitlement independently of disabled UI options", () => {
  const save = section('for (const [buttonId, copy] of [["cv-save"', "function hasPremiumCv()");
  assert.match(save, /!hasPremiumCv\(\) && fields\.template !== "classic"/);
});

test("opening a saved premium template respects current entitlement", () => {
  const load = section('document.querySelector("#cv-load").addEventListener', 'document.querySelector("#cv-new").addEventListener');
  assert.match(load, /!hasPremiumCv\(\) && cvForm\.elements\.template\.value !== "classic"/);
});

test("CV preview and Word export also check Premium access", () => {
  const exportAndPreview = app.slice(app.indexOf('document.querySelector("#cv-word-export").addEventListener'));
  assert.match(exportAndPreview, /!hasPremiumCv\(\)\) fields\.template = "classic"/);
  assert.match(exportAndPreview, /window\.CP_CV_RENDER\.render\(document\.querySelector\("#cv-preview"\), fields\)/);
});

test("CV editor and example page use the same renderer", () => {
  const renderer = readFileSync(new URL("../app/cv-render.js", import.meta.url), "utf8");
  const demo = readFileSync(new URL("../app/cv-modeles.html", import.meta.url), "utf8");
  assert.match(html, /cv-render\.js/);
  assert.match(html, /href="cv-modeles\.html"/);
  assert.match(demo, /cv-render\.js/);
  for (const model of ["classic", "modern", "compact"]) {
    assert.match(renderer, new RegExp(model));
    assert.match(demo, new RegExp('"' + model + '"'));
  }
});
