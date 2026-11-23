import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
test("company search deduplicates cached and Internet results without merging distinct branches", () => {
  const start = js.indexOf("function uniqueSearchableCompanies(");
  const end = js.indexOf("function renderCompanies(", start);
  assert.ok(start >= 0 && end > start);
  const fn = js.slice(start, end);
  assert.match(fn, /isSearchableCompany\(company\)/);
  assert.match(fn, /normalize\("NFKC"\)/);
  assert.match(fn, /company\.address \|\| company\.city/);
  assert.match(fn, /seen\.has\(key\)/);
  assert.match(js, /companyResults = uniqueSearchableCompanies\(cachedCompanies\)/);
  assert.match(js, /companyResults = uniqueSearchableCompanies\(\(Array\.isArray\(verified\)/);
});
