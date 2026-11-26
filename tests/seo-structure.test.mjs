import { readFileSync } from "node:fs";
import assert from "node:assert/strict";
import test from "node:test";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const home = read("../index.html");
const app = read("../app/index.html");
const cvModels = read("../app/cv-modeles.html");

test("the public landing page has a concise search snippet", () => {
  const description = home.match(/<meta name="description" content="([^"]+)"/i)?.[1];
  assert.ok(description);
  assert.ok(description.length <= 160);
});

test("the web app is noindex and uses one canonical URL for login query variants", () => {
  assert.match(app, /<meta name="robots" content="noindex,follow">/i);
  assert.match(app, /<link rel="canonical" href="https:\/\/candidaturepro\.ch\/app\/">/i);
  assert.equal((app.match(/<h1\b/gi) || []).length, 1);
});

test("the public premium CV gallery is indexable and has its own search snippet", () => {
  assert.doesNotMatch(cvModels, /<meta name="robots" content="noindex/i);
  assert.match(cvModels, /<meta name="description" content="[^"]{70,160}"/i);
  assert.match(cvModels, /<link rel="canonical" href="https:\/\/candidaturepro\.ch\/app\/cv-modeles">/i);
  assert.match(cvModels, /href="cv-gallery\.css\?/i);
  assert.doesNotMatch(cvModels, /href="app\.css\?/i);
});

test("robots.txt advertises a sitemap containing public pages only", () => {
  const robots = read("../robots.txt");
  const sitemap = read("../sitemap.xml");
  assert.match(robots, /Sitemap: https:\/\/candidaturepro\.ch\/sitemap\.xml/);
  assert.match(sitemap, /https:\/\/candidaturepro\.ch\/app\/cv-modeles/);
  assert.match(sitemap, /https:\/\/candidaturepro\.ch\/privacy/);
  assert.doesNotMatch(sitemap, /\/app\/?(?:<|\s)/);
});
