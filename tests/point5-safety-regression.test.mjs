import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const market = readFileSync(new URL("../supabase/functions/job-market-refresh/index.ts", import.meta.url), "utf8");

test("tracking delay is validated and HTML-escaped before attribute interpolation", () => {
  assert.match(app, /escapeHtml\(Number\.isInteger\(Number\(row\.follow_up_delay_days\)\)/);
  assert.match(app, /Number\(row\.follow_up_delay_days\) >= 1/);
  assert.match(app, /Number\(row\.follow_up_delay_days\) <= 365/);
});

test("employer location caption declaration is not accidentally swallowed by a comment", () => {
  const declaration = market.match(/^  const employerLocationCaption = .*$/m);
  assert.ok(declaration, "missing employerLocationCaption declaration");
  assert.match(declaration[0], /snippet\.match\(/);
  assert.doesNotMatch(market, /\/\/ Explicit provider caption:[^\n]*\\n[^\n]*const employerLocationCaption/);
});
