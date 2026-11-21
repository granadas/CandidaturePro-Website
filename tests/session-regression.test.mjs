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

test("temporary refresh failures do not delete the saved login", () => {
  const auth = block("async function authRequest(", "function authErrorMessage(");
  const ensure = block("async function ensureSession()", "async function supabaseFetch(");
  assert.match(auth, /error\.status\s*=\s*response\.status/);
  assert.match(ensure, /error\?\.status\s*===\s*400/);
  assert.match(ensure, /error\?\.status\s*===\s*401/);
  assert.match(ensure, /if\s*\(invalidToken\s*&&\s*getSession\(\)\?\.refresh_token\s*===\s*session\.refresh_token\)/);
});

test("read retry retains original session generation", () => {
  const read = block("async function supabaseFetch(", "async function supabaseWrite(");
  assert.equal((read.match(/const generation\s*=\s*sessionGeneration/g) || []).length, 1);
  assert.match(read, /if\s*\(response\.status\s*===\s*401\s*&&\s*retry\)/);
  assert.match(read, /await refreshSession\(\)/);
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
