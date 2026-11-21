import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import assert from "node:assert/strict";
import test from "node:test";

// Exercise the actual production implementation, not a duplicated copy.
// The helper uses only TypeScript parameter annotations and no Deno APIs.
const source = readFileSync(new URL("../supabase/functions/job-market-refresh/index.ts", import.meta.url), "utf8");
const start = source.indexOf("function jobIdentity(");
const end = source.indexOf("\n}\n\nDeno.serve(", start);
assert.ok(start >= 0 && end > start, "production jobIdentity must be found");
const functionSource = source.slice(start, end + 2)
  .replace("title: string, snippet: string", "title, snippet");
const jobIdentity = runInNewContext(`(${functionSource})`);

test("parses employer from explicit poste chez title", () => {
  const result = jobIdentity("Préparateur logistique poste chez Coop - Genève", "");
  assert.equal(result.title, "Préparateur logistique");
  assert.equal(result.company, "Coop");
});

test("parses employer from JobScout24 chez caption", () => {
  const result = jobIdentity("Préparateur logistique", "Offre chez Migros - Genève sur JobScout24");
  assert.equal(result.company, "Migros");
});

test("parses employer from explicit company-city caption", () => {
  const result = jobIdentity("Cash Reconciliation Specialist", "Cash Reconciliation Specialist. Banque Pictet & Cie SA | Genève.");
  assert.equal(result.company, "Banque Pictet & Cie SA");
});

test("does not infer employer from client mention", () => {
  const result = jobIdentity("Peintre automobile", "Nous recherchons pour l'un de nos clients de renom basé à Genève un peintre.");
  assert.equal(result.company, "");
});

test("rejects generic job labels as employers", () => {
  const result = jobIdentity("Préparateur", "Offre de recrutement | Genève.");
  assert.equal(result.company, "");
});
