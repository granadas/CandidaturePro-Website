import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync(new URL("../app/cv-render.js", import.meta.url), "utf8");

class Element {
  constructor(tag) {
    this.tag = tag;
    this.children = [];
    this.dataset = {};
    this.style = { values: {}, setProperty: (name, value) => { this.style.values[name] = value; } };
    this.className = "";
    this.textContent = "";
  }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; }
  get allText() { return [this.textContent, ...this.children.map(child => child.allText)].join(" "); }
  findClass(name) {
    return [this, ...this.children.flatMap(child => child.findClass(name))].filter(el => el.className.split(" ").includes(name));
  }
}
function createRenderer() {
  const window = {};
  runInNewContext(source, { window, document: { createElement: tag => new Element(tag) } });
  return window.CP_CV_RENDER.render;
}
const sample = {
  name: "Camille Exemple", title: "Cheffe de projet", contact: "Genève\\ncamille@example.invalid",
  summary: "Gestion de projets", experience: "Responsable · 2021–2026\\nEntreprise Exemple\\n• Pilotage d'équipe",
  education: "Bachelor · 2020\\nUniversité", skills: "Français\\nAnglais",
  accent: "jade", font: "sans"
};

for (const template of ["classic", "elegance", "prestige", "signature"]) {
  test("CV renderer creates a complete " + template + " document", () => {
    const target = new Element("div");
    const paper = createRenderer()(target, { ...sample, template });
    assert.equal(target.children[0], paper);
    assert.equal(paper.dataset.template, template);
    assert.ok(paper.className.includes("cv-sheet-" + template));
    assert.ok(paper.className.includes("cv-font-sans"));
    assert.equal(paper.style.values["--cv-accent"], "#147c75");
    for (const expected of ["Camille Exemple", "Cheffe de projet", "Gestion de projets", "Pilotage d'équipe", "Bachelor", "Français"]) {
      assert.ok(paper.allText.includes(expected), "Missing: " + expected);
    }
    assert.equal(paper.findClass("cv-sheet-section").length, 4);
    const split = template === "elegance" || template === "signature";
    assert.equal(paper.findClass("cv-sheet-main").length, split ? 1 : 0);
    assert.equal(paper.findClass("cv-sheet-side").length, split ? 1 : 0);
    assert.equal(paper.findClass("cv-sheet-monogram").length, 1);
  });
}

test("unknown template and accent fall back to safe defaults", () => {
  const paper = createRenderer()(new Element("div"), { ...sample, template: "unknown", accent: "unknown" });
  assert.equal(paper.dataset.template, "classic");
  assert.equal(paper.style.values["--cv-accent"], "#a85d3a");
});

test("legacy premium template names migrate to the new profession-neutral designs", () => {
  const render = createRenderer();
  assert.equal(render(new Element("div"), { ...sample, template: "modern" }).dataset.template, "signature");
  assert.equal(render(new Element("div"), { ...sample, template: "compact" }).dataset.template, "elegance");
});

test("the identity mark can be initials, an uploaded photo, or hidden", () => {
  const render = createRenderer();
  const initials = render(new Element("div"), { ...sample, identityMark: "initials" });
  const photo = render(new Element("div"), { ...sample, identityMark: "photo", photo: "data:image/png;base64,abc" });
  const none = render(new Element("div"), { ...sample, identityMark: "none", photo: "data:image/png;base64,abc" });
  assert.equal(initials.findClass("cv-sheet-monogram").length, 1);
  assert.equal(photo.findClass("cv-sheet-photo").length, 1);
  assert.equal(photo.findClass("cv-sheet-monogram").length, 0);
  assert.equal(none.findClass("cv-sheet-photo").length, 0);
  assert.equal(none.findClass("cv-sheet-monogram").length, 0);
});

test("user-provided markup is kept as text, never interpreted as HTML", () => {
  const paper = createRenderer()(new Element("div"), { ...sample, name: "<img src=x onerror=alert(1)>" });
  assert.ok(paper.allText.includes("<img src=x onerror=alert(1)>"));
  assert.equal(paper.findClass("cv-sheet-photo").length, 0);
});
