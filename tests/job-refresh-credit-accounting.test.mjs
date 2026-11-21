import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const edge = readFileSync(new URL("../supabase/functions/job-market-refresh/index.ts", import.meta.url), "utf8");

test("Serper credits are reserved and persisted before sending paid requests", () => {
  const start = edge.indexOf("for (const sector of sectors)");
  const end = edge.indexOf("const offers =", start);
  assert.ok(start >= 0 && end > start);
  const section = edge.slice(start, end);
  const counted = section.indexOf("credits++;");
  const checkpoint = section.indexOf("const creditCheckpoint = await fetch");
  const checked = section.indexOf("if (!creditCheckpoint.ok)");
  const dispatched = section.indexOf('await fetch("https://google.serper.dev/search"');
  const parsed = section.indexOf("await searchResponse.json()");
  assert.ok(counted >= 0 && checkpoint > counted && checked > checkpoint &&
    dispatched > checked && parsed > dispatched);
});

test("stale refresh recovery retains credit checkpoints", () => {
  const start = edge.indexOf("const staleBefore =");
  const end = edge.indexOf("const month = new Date()", start);
  assert.ok(start >= 0 && end > start);
  const section = edge.slice(start, end);
  assert.match(section, /status: "failed"/);
  assert.doesNotMatch(section, /credits_used\s*:/);
});

test("monthly budget includes all credit checkpoints", () => {
  assert.match(edge, /select=credits_used/);
  assert.match(edge, /usageRows\.reduce/);
  assert.match(edge, /Math\.max\(0, 100 - used\)/);
});

test("legacy offer cleanup errors cannot be reported as successful refreshes", () => {
  const start = edge.indexOf("if (found > 0) {");
  const end = edge.indexOf("const completionResponse =", start);
  assert.ok(start >= 0 && end > start);
  const cleanup = edge.slice(start, end);
  assert.match(cleanup, /const legacyDeactivationResponse = await fetch/);
  assert.match(cleanup, /if \(!legacyDeactivationResponse\.ok\)/);
  assert.match(cleanup, /throw new Error/);
});

test("malformed credit totals block paid searches", () => {
  const start = edge.indexOf("let usageRows: unknown;");
  const end = edge.indexOf("const runResponse = await fetch", start);
  assert.ok(start >= 0 && end > start);
  const section = edge.slice(start, end);
  assert.match(section, /catch \{/);
  assert.match(section, /!Array\.isArray\(usageRows\)/);
  assert.match(section, /!Number\.isSafeInteger\(row\.credits_used\)/);
  assert.match(section, /Number\(row\.credits_used\) < 0/);
  assert.match(section, /!Number\.isSafeInteger\(used\)/);
  assert.match(section, /Actualisation bloquée/);
  assert.match(section, /Math\.max\(0, 100 - used\)/);
});

test("optional offer count cannot invalidate a completed refresh or fabricate zero", () => {
  const start = edge.indexOf("const completionResponse =");
  const end = edge.indexOf('return json({ status: "completed"', start);
  assert.ok(start >= 0 && end > start);
  const section = edge.slice(start, end);
  assert.match(section, /let totalOffers: number \| null = null/);
  assert.match(section, /countResponse\.ok \? countResponse\.headers\.get/);
  assert.match(section, /Number\.isSafeInteger\(Number\(count\)\)/);
  assert.match(section, /\} catch \{/);
});

test("malformed refresh run creation response blocks all paid searches", () => {
  const start = edge.indexOf("let createdRuns: unknown;");
  const end = edge.indexOf("let credits = 0;", start);
  const provider = edge.indexOf('await fetch("https://google.serper.dev/search"');
  assert.ok(start >= 0 && end > start && provider > end);
  const section = edge.slice(start, end);
  assert.match(section, /await runResponse\.json\(\)/);
  assert.match(section, /!Array\.isArray\(createdRuns\)/);
  assert.match(section, /createdRuns\.length !== 1/);
  assert.match(section, /typeof createdRuns\[0\]\?\.id !== "string"/);
  assert.match(section, /return json\(/);
});

test("rejects malformed search inputs before creating paid refresh run", () => {
  const validation = edge.indexOf("if (requestedCity.length > 120");
  const creation = edge.indexOf('await fetch(`${url}/rest/v1/job_market_refresh_runs`, {');
  assert.ok(validation >= 0 && creation > validation);
  const section = edge.slice(validation, creation);
  assert.match(section, /requestedQuery.length > 120/);
  assert.match(section, /return json\(\{ message: "Ville ou recherche invalide/);
});
