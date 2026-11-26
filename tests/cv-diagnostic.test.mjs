import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";

const source = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const fragment = source.slice(source.indexOf("  function analyzeCvFields("), source.indexOf("  function renderCvAnalysis("));
const analyze = runInNewContext(fragment + "\nanalyzeCvFields", {});
const base = { title: "", contact: "", summary: "", experience: "", education: "", skills: "", template: "classic" };

test("a sparse CV receives a low diagnostic score", () => {
  const report = analyze({ ...base, title: "Gestionnaire" }, "");
  assert.ok(report.overall < 40);
  assert.equal(report.hasTarget, false);
  assert.equal(report.keywords, 0);
});

test("the chosen visual template does not change the diagnostic score", () => {
  const fields = { ...base, title: "Responsable logistique", contact: "camille@exemple.ch",
    summary: "Professionnelle de la logistique avec sept années d’expérience dans la coordination et la qualité.",
    experience: "Responsable logistique · 2022–2026\nAlpine Conseil\n• Coordination de 12 projets.\n• Réduction des délais de 18 %.",
    education: "Bachelor · 2018\nHaute école de gestion", skills: "Coordination\nGestion\nQualité\nAnalyse\nFrançais" };
  const classic = analyze(fields, "Responsable logistique");
  const modern = analyze({ ...fields, template: "modern" }, "Responsable logistique");
  assert.equal(classic.overall, modern.overall);
  assert.ok(classic.overall > analyze({ ...base, title: fields.title }, "Responsable logistique").overall);
  assert.equal(classic.keywords, 100);
});

test("keywords are scored on whole words and omitted from the overall score without a target", () => {
  const fields = { ...base, title: "Responsable logistique", skills: "Gestion" };
  assert.equal(analyze(fields, "logistique").keywords, 100);
  assert.equal(analyze(fields, "logisticien").keywords, 0);
  assert.equal(analyze(fields, "").hasTarget, false);
});

test("the live CV word counter separates spaces and line breaks", () => {
  const start = source.indexOf('    const written = ["summary", "experience", "education", "skills"]');
  const end = source.indexOf('    const lengthLabel =', start);
  assert.ok(start > 0 && end > start);
  const count = runInNewContext(`(fields) => { ${source.slice(start, end)} return wordCount; }`, {});
  assert.equal(count({ summary: "Deux mots", experience: "Une\nautre ligne", education: "", skills: "" }), 5);
  assert.equal(count({ summary: "", experience: "", education: "", skills: "" }), 0);
});

test("premium A4 status explains the one-page limit without implying a page break is acceptable", () => {
  assert.match(source, /Page A4 dépassée : export bloqué\. Raccourcissez le contenu ; aucun texte ne sera supprimé\./);
  assert.match(source, /Page A4 : .* % remplie/);
  const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");
  assert.match(html, /Le PDF Premium est limité à une page A4/);
  assert.doesNotMatch(html, /Vérifiez les éventuels sauts de page/);
});
