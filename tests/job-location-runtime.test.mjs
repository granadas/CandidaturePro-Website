import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

const source = readFileSync(new URL("../supabase/functions/job-market-refresh/index.ts", import.meta.url), "utf8");
const start = source.indexOf("function jobLocation(");
const end = source.indexOf("\n}\n\nfunction jobIdentity(", start);
assert.ok(start >= 0 && end > start, "production jobLocation must be found");
const functionSource = source.slice(start, end + 2)
  .replace("title: string, snippet: string", "title, snippet");
const jobLocation = runInNewContext(`(${functionSource})`);

test("prefers city in job title over unrelated snippet", () => {
  assert.equal(jobLocation("Logisticien à Lausanne", "Notre groupe est présent à Genève."), "Lausanne");
});

test("extracts location from JobScout24 hiring caption", () => {
  assert.equal(jobLocation("Logisticien", "Offre chez Coop - Nyon sur JobScout24"), "Nyon");
});

test("does not substitute unrelated snippet city for unknown caption location", () => {
  assert.equal(jobLocation("Logisticien", "Offre chez Coop - Écublens sur JobScout24. Siège social à Genève."), "À vérifier");
});

test("does not infer city from generic search snippets", () => {
  assert.equal(jobLocation("Logisticien", "Postes et offres d'emploi en Suisse, Genève et ailleurs"), "À vérifier");
});

test("returns unknown location if no supported city is present", () => {
  assert.equal(jobLocation("Logisticien", "Travail dans une région suisse"), "À vérifier");
});
