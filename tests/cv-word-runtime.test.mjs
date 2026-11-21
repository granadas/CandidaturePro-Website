import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync(new URL("../app/cv-word.js", import.meta.url), "utf8");
function generate(fields) {
  let entries;
  const window = { CP_BACKUP: { buildArchive(items) {
    entries = items;
    return new Uint8Array([80, 75, 3, 4]);
  } } };
  runInNewContext(source, { window, TextEncoder, Blob, Uint8Array, DataView, atob });
  const blob = window.CP_CV_WORD.create(fields);
  return { blob, files: Object.fromEntries(entries.map(entry => [entry.name, new TextDecoder().decode(entry.bytes)])) };
}
const fields = {
  name: "Camille Exemple", title: "Responsable de projets", contact: "Genève",
  summary: "Organisation & qualité <fiable>",
  experience: "Responsable · 2021–2026\\nEntreprise Exemple\\n• Réduction de 18 % des délais",
  education: "Bachelor · 2020\\nUniversité", skills: "Français\\nAnglais",
  template: "classic", accent: "jade", font: "sans", photo: ""
};
for (const template of ["classic", "modern", "compact"]) {
  test("Word export builds a valid package structure for " + template, () => {
    const { blob, files } = generate({ ...fields, template });
    assert.equal(blob.type, "application/vnd.openxmlformats-officedocument.wordprocessingml.document");
    for (const path of ["[Content_Types].xml", "_rels/.rels", "word/document.xml", "word/styles.xml", "word/_rels/document.xml.rels"]) {
      assert.ok(files[path], "Missing Word package file: " + path);
    }
    const document = files["word/document.xml"];
    for (const expected of ["Camille Exemple", "Responsable de projets", "Réduction de 18 % des délais", "Bachelor", "Français"]) {
      assert.ok(document.includes(expected), "Missing Word content: " + expected);
    }
    assert.ok(document.includes("Organisation &amp; qualité &lt;fiable&gt;"));
    assert.ok(files["word/styles.xml"].includes("147C75"));
  });
}
test("Word export rejects an unknown template", () => {
  assert.throws(() => generate({ ...fields, template: "invalid" }), /modèle de CV/);
});
test("Word export requires candidate identity", () => {
  assert.throws(() => generate({ ...fields, name: "" }), /nom et le titre/);
});

test("Word export respects editorial and sans-serif font choices", () => {
  const editorial = generate({ ...fields, font: "editorial" }).files["word/styles.xml"];
  const sans = generate({ ...fields, font: "sans" }).files["word/styles.xml"];
  assert.ok(editorial.includes('w:ascii="Georgia"'));
  assert.ok(sans.includes('w:ascii="Aptos"'));
});
