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

for (const template of ["classic", "modern", "compact"]) {
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
    assert.equal(paper.findClass("cv-sheet-main").length, template === "modern" ? 1 : 0);
    assert.equal(paper.findClass("cv-sheet-side").length, template === "modern" ? 1 : 0);
  });
}

test("unknown template and accent fall back to safe defaults", () => {
  const paper = createRenderer()(new Element("div"), { ...sample, template: "unknown", accent: "unknown" });
  assert.equal(paper.dataset.template, "classic");
  assert.equal(paper.style.values["--cv-accent"], "#a85d3a");
});

test("user-provided markup is kept as text, never interpreted as HTML", () => {
  const paper = createRenderer()(new Element("div"), { ...sample, name: "<img src=x onerror=alert(1)>" });
  assert.ok(paper.allText.includes("<img src=x onerror=alert(1)>"));
  assert.equal(paper.findClass("cv-sheet-photo").length, 0);
});
