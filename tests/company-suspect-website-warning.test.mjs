import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const js = readFileSync(new URL("../app/app.js", import.meta.url), "utf8");
const start = js.indexOf("function isSuspectCompanyWebsite(");
const end = js.indexOf("function renderCompanies()", start);
test("flag known Proman/BM Emploi mismatch without blocking other sites", () => {
  assert.ok(start >= 0 && end > start);
  const context = { URL };
  vm.runInNewContext(`
    function safeExternalUrl(value) {
      try { const url = new URL(String(value || "")); return ["http:", "https:"].includes(url.protocol) ? url.href : ""; }
      catch { return ""; }
    }
    ${js.slice(start, end)}
    globalThis.check = isSuspectCompanyWebsite;
  `, context);
  assert.equal(context.check({name:"Proman",website:"https://www.bm-emploi.ch/geneve"}), true);
  assert.equal(context.check({name:"Proman",website:"https://www.proman-group.ch/"}), false);
  assert.equal(context.check({name:"BM Emploi",website:"https://www.bm-emploi.ch/geneve"}), false);
  assert.equal(context.check({name:"Proman",website:"javascript:alert(1)"}), false);
  assert.match(js, /Lien à vérifier \(autre enseigne\)/);
});
