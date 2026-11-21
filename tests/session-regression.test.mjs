import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const app = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../app/index.html", import.meta.url), "utf8");

function block(start, end) {
  const a = app.indexOf(start);
  const b = app.indexOf(end, a + start.length);
  assert.ok(a >= 0 && b > a, "Missing or reordered section: " + start);
  return app.slice(a, b);
}

test("search forms keep independent locks", () => {
  const companies = block('document.querySelector("#company-search-form").addEventListener', 'document.querySelector("#company-results").addEventListener');
  const jobs = block('document.querySelector("#jobs-search-form").addEventListener', 'document.querySelector("#jobs-results").addEventListener');
  assert.match(companies, /if\s*\(companySearchRunning\)\s*return/);
  assert.match(companies, /companySearchRunning\s*=\s*true/);
  assert.match(companies, /finally\s*\{\s*companySearchRunning\s*=\s*false/);
  assert.doesNotMatch(jobs, /companySearchRunning/);
});

test("coalesced refresh cannot return another account's session", () => {
  const ensure = block("async function ensureSession()", "async function supabaseFetch(");
  assert.match(ensure, /refreshed\?\.user\?\.id\s*!==\s*session\.user\?\.id/);
  assert.match(ensure, /current\?\.user\?\.id\s*!==\s*session\.user\?\.id/);
  assert.match(ensure, /current\?\.refresh_token\s*!==\s*refreshed\.refresh_token/);
});

test("temporary refresh failures do not delete the saved login", () => {
  const auth = block("async function authRequest(", "function authErrorMessage(");
  const ensure = block("async function ensureSession()", "async function supabaseFetch(");
  assert.match(auth, /error\.status\s*=\s*response\.status/);
  assert.match(ensure, /error\?\.status\s*===\s*400/);
  assert.match(ensure, /error\?\.status\s*===\s*401/);
  assert.match(ensure, /\["refresh_token_not_found", "refresh_token_already_used", "invalid_grant"\]\.includes\(error\?\.code\)/);
  assert.match(ensure, /if\s*\(invalidToken\s*&&\s*getSession\(\)\?\.refresh_token\s*===\s*session\.refresh_token\)/);
});

test("read retry retains original session generation", () => {
  const read = block("async function supabaseFetch(", "async function supabaseWrite(");
  assert.equal((read.match(/const generation\s*=\s*sessionGeneration/g) || []).length, 1);
  assert.match(read, /if\s*\(response\.status\s*===\s*401\s*&&\s*retry\)/);
  assert.match(read, /await refreshSession\(\)/);
});

test("refresh rejects responses for another user or without credentials", () => {
  const refresh = block("async function refreshSession()", "async function ensureSession()");
  assert.match(refresh, /refreshed\.user\.id\s*!==\s*session\.user\?\.id/);
  assert.match(refresh, /!refreshed\.access_token\s*\|\|\s*!refreshed\.refresh_token/);
  assert.ok(refresh.indexOf("refreshed.user.id !== session.user?.id") < refresh.indexOf("setSession(refreshed)"));
});

test("session refresh never overwrites a replaced session", () => {
  const refresh = block("async function refreshSession()", "async function ensureSession()");
  assert.match(refresh, /latest\?\.refresh_token\s*!==\s*session\.refresh_token/);
  assert.match(refresh, /latest\?\.user\?\.id\s*===\s*session\.user\?\.id/);
  assert.match(refresh, /setSession\(refreshed\)/);
});

test("authenticated request helpers reject stale sessions", () => {
  for (const [name, next] of [
    ["supabaseFetch", "supabaseWrite"],
    ["supabaseWrite", "supabaseRpc"],
    ["supabaseRpc", "invokeEdgeFunction"]
  ]) {
    const section = block("async function " + name + "(", "async function " + next + "(");
    assert.match(section, /generation\s*=\s*sessionGeneration/);
    assert.match(section, /getSession\(\)\?\.user\?\.id\s*!==\s*session\.user\?\.id/);
    assert.match(section, /response\.status\s*===\s*401/);
  }
});

test("Edge Function requests reject stale session responses", () => {
  const edge = block("async function invokeEdgeFunction(", "const profileDetailFields");
  assert.match(edge, /generation\s*=\s*sessionGeneration/);
  assert.match(edge, /La session a changé pendant l’opération/);
});

test("HTML includes a cache-busted application script", () => {
  assert.match(html, /app\.js\?v=[\w-]+/);
});

test("admin refresh shows remaining credits and disables when budget is exhausted or unknown", () => {
  const admin = block("function renderAdminJobMarket(", "let adminJobRefreshRunning =");
  assert.match(admin, /Math\.max\(0, 100 - usedCredits\)/);
  assert.match(admin, /remainingCredits === null \|\| remainingCredits === 0/);
  assert.match(admin, /button\.disabled = true/);
  assert.match(admin, /Budget Serper indisponible/);
});

test("admin paid refresh rejects submit when budget is blocked and stays disabled", () => {
  const admin = block("function renderAdminJobMarket(", "let adminJobRefreshRunning =");
  assert.match(admin, /adminJobRefreshRunning \|\| refreshBlocked/);
  assert.match(admin, /button\.disabled = refreshBlocked/);
  assert.doesNotMatch(admin, /adminJobRefreshRunning = button\.disabled = false/);
});

test("admin budget rejects null or malformed credit statistics", () => {
  const admin = block("function renderAdminJobMarket(", "let adminJobRefreshRunning =");
  assert.match(admin, /typeof usedCredits === "number"/);
  assert.match(admin, /Number\.isSafeInteger\(usedCredits\)/);
  assert.match(admin, /usedCredits >= 0/);
  assert.doesNotMatch(admin, /Number\(row\?\.month_credits_used\)/);
});

test("admin reflects server refresh status and blocks duplicate runs", () => {
  const admin = block("function renderAdminJobMarket(", "let adminJobRefreshRunning =");
  assert.match(admin, /row\?\.last_status === "running"/);
  assert.match(admin, /refreshBlocked = remainingCredits === null \|\| remainingCredits === 0 \|\| serverRefreshRunning/);
  assert.match(admin, /row\?\.last_status === "failed"/);
  assert.match(admin, /row\?\.last_status === "completed"/);
});

test("admin can refresh job statistics without triggering paid search", () => {
  const admin = block("function renderAdminJobMarket(", "let adminJobRefreshRunning =");
  assert.match(admin, /data-action="refresh-job-stats"/);
  assert.match(admin, /Rafraîchir les statistiques \(gratuit\)/);
  assert.match(admin, /statsButton\.addEventListener\("click"/);
  assert.match(admin, /void loadAdmin\(\)/);
});

test("job search warns when employer names need verification", () => {
  const start = app.indexOf("async function loadJobs()");
  const end = app.indexOf("function canEditApplication(", start);
  assert.ok(start >= 0 && end > start);
  const section = app.slice(start, end);
  assert.match(section, /const missingEmployers = jobResults\.filter/);
  assert.match(section, /employeur\(s\) à vérifier/);
  assert.match(section, /offre\(s\) non revérifiée\(s\)/);
});

test("job search can show only offers with identified employers without spending search credits", () => {
  assert.match(html, /id="jobs-known-employer-only"/);
  assert.match(app, /knownEmployerOnly \? results\.filter\(job => String\(job\.company_name \|\| ""\)\.trim\(\)\) : results/);
  assert.match(app, /jobs-known-employer-only"\)\.addEventListener\("change"/);
  assert.match(app, /jobs-known-employer-only"\)\.checked = false/);
});

test("indexed job listings never claim availability was verified", () => {
  assert.match(html, /ANNONCES RÉFÉRENCÉES/);
  assert.doesNotMatch(html, /OFFRES DISPONIBLES/);
  assert.match(app, /disponibilité à confirmer/);
  assert.match(app, /Vérifiez leur disponibilité sur le site source/);
});
