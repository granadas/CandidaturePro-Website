import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const js = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
test("company searches warn about possible incomplete coverage at 100 source records", () => {
  const start = js.indexOf("async function searchCompanies()");
  const end = js.indexOf("function renderJobs()", start);
  assert.ok(start >= 0 && end > start);
  const search = js.slice(start, end);
  assert.match(search, /cachedCompanies\.length >= 100/);
  assert.match(search, /rawCompanies\.length >= 100/);
  assert.match(search, /verified\.length >= 100/);
  assert.match(search, /la liste peut être incomplète/);
  assert.match(search, /Affinez la ville ou le rayon/);
});
