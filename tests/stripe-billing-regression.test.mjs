import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const html = read("../app/index.html");
const app = read("../app/app.js");
const billing = read("../supabase/functions/stripe-sandbox-billing/index.ts");
const webhook = read("../supabase/functions/stripe-sandbox-webhook/index.ts");
const migration = read("../supabase/migrations/20261127170000_complete_stripe_sandbox_billing.sql");
const has = (text, pattern, label) => assert.ok(pattern.test(text), `Missing expected billing guard: ${label}`);

test("Premium checkout stays hidden until the signed-in admin status check succeeds", () => {
  has(html, /id="premium-checkout"[^>]*hidden/, "hidden checkout button");
  has(html, /14,99 CHF par mois/, "monthly amount");
  has(app, /profile\?\.is_admin/, "admin-only sandbox access");
  has(html, /S’abonner à Premium/, "checkout control");
  has(html, /Gérer mon abonnement/, "portal control");
});

test("checkout is sandbox-only and accepts no client-selected user or price", () => {
  has(billing, /stripeKey\?\.startsWith\("sk_test_"\)/, "test key guard");
  has(billing, /price_1UgS6DLUEvqvukzc3dY7vPq5/, "verified sandbox price");
  has(billing, /profile\.is_admin !== true/, "server-side admin gate");
  has(billing, /client_reference_id: user\.id/, "server-derived user id");
  has(billing, /checkout\/sessions/, "hosted checkout session");
  assert.equal(/livemode:\s*true/.test(billing), false, "sandbox handler must never create a live checkout");
});

test("portal sessions are bound to the authenticated user's stored Stripe customer", () => {
  has(billing, /body\.action === "portal"/, "portal action");
  has(billing, /customer: subscription\.customer_id/, "stored Stripe customer binding");
  has(billing, /STRIPE_SANDBOX_PORTAL_CONFIGURATION_ID/, "configured sandbox portal");
  has(billing, /https:\/\/billing\.stripe\.com\//, "Stripe portal destination");
  has(app, /destination\.origin === "https:\/\/billing\.stripe\.com"/, "client redirect allowlist");
});

test("webhooks verify Stripe signatures and pass subscription state to a private RPC", () => {
  has(webhook, /stripe-signature/, "Stripe signature header");
  has(webhook, /Math\.abs\(Date\.now\(\) \/ 1000 - Number\(timestamp\)\) > 300/, "signature recency");
  has(webhook, /event\?\.livemode !== false/, "sandbox-only webhook");
  has(webhook, /apply_stripe_sandbox_subscription_event/, "database subscription sync");
  has(migration, /enable row level security/i, "RLS on payment tables");
  has(migration, /check \(livemode = false\)/i, "live-mode rejection constraint");
  has(migration, /to service_role/i, "service-role-only RPC");
  has(migration, /on conflict\(event_id\) do nothing/i, "event idempotency");
});

test("the hosted return message never grants Premium by itself", () => {
  has(app, /sera activé uniquement après réception et validation de l’événement Stripe/, "webhook-only entitlement");
  has(app, /await refreshPremiumBillingStatus\(\)/, "refresh after hosted return");
});
