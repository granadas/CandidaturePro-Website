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
for (const template of ["classic", "elegance", "prestige", "signature"]) {
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

test("Word export respects initials, photo and no-mark identity choices", () => {
  const initials = generate({ ...fields, identityMark: "initials" }).files["word/document.xml"];
  const none = generate({ ...fields, identityMark: "none" }).files["word/document.xml"];
  assert.match(initials, /<w:pStyle w:val="CandidateMark"\/>/);
  assert.doesNotMatch(none, /<w:pStyle w:val="CandidateMark"\/>/);
});

test("Signature Word CV places education and skills in a distinct sidebar cell", () => {
  const document = generate({ ...fields, template: "signature" }).files["word/document.xml"];
  assert.ok(document.includes("<w:tbl>"));
  const cells = document.split("<w:tc>").slice(1);
  assert.equal(cells.length, 2);
  assert.ok(cells[0].includes("Profil"));
  assert.ok(cells[0].includes("Expériences"));
  assert.ok(!cells[0].includes("Compétences et langues"));
  assert.ok(cells[1].includes("Formation"));
  assert.ok(cells[1].includes("Compétences et langues"));
});
test("classic and Elegance Word CV remain single-column", () => {
  for (const template of ["classic", "elegance"]) {
    assert.ok(!generate({ ...fields, template }).files["word/document.xml"].includes("<w:tbl>"));
  }
});

test("legacy premium Word template names migrate to supported designs", () => {
  for (const template of ["modern", "compact"]) {
    assert.ok(generate({ ...fields, template }).files["word/document.xml"].includes("Camille Exemple"));
  }
});

test("Word export preserves individual skills separated by semicolons or pipes", () => {
  const document = generate({ ...fields, skills: "Français; Anglais | Allemand\nExcel" }).files["word/document.xml"];
  for (const skill of ["Français", "Anglais", "Allemand", "Excel"]) {
    assert.ok(document.includes('<w:t xml:space="preserve">' + skill + '</w:t>'));
  }
  assert.ok(!document.includes("Français; Anglais"));
});

test("black and gold palette is preserved in Word styles", () => {
  const styles = generate({ ...fields, accent: "gold" }).files["word/styles.xml"];
  assert.ok(styles.includes("F5B800"));
});
