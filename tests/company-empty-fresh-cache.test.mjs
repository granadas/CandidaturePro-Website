import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const source = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
test("invalid fresh cache does not prevent an Internet company search", () => {
  const start = source.indexOf("async function searchCompanies()");
  const end = source.indexOf("function renderJobs()", start);
  assert.ok(start >= 0 && end > start);
  const body = source.slice(start, end);
  assert.match(body, /const usableCachedCompanies = uniqueSearchableCompanies\(cachedCompanies\)/);
  assert.match(body, /if \(usableCachedCompanies\.length && usableCachedCompanies\.some\(company => company\.isFresh\)\)/);
  assert.match(body, /companyResults = usableCachedCompanies/);
  assert.match(body, /action: "company_search"/);
  assert.doesNotMatch(body, /cachedCompanies\.length && cachedCompanies\.some/);
});
