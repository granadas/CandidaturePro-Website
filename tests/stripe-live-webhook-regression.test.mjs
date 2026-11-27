import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../supabase/functions/stripe-live-webhook/index.ts");
const billing = read("../supabase/functions/stripe-live-billing/index.ts");
const migration = read("../supabase/migrations/20261127230000_stripe_live_billing_storage.sql");
const app = read("../app/app.js");
const has = (text, pattern, label) => assert.ok(pattern.test(text), `Missing live billing guard: ${label}`);

test("live webhook requires a dedicated signing secret and rejects test events", () => {
  has(source, /STRIPE_LIVE_WEBHOOK_SECRET/, "live signing secret");
  has(source, /event\?\.livemode !== true/, "live mode check");
  has(source, /verifyStripeSignature/, "signature verification");
  has(source, /300\) return false/, "signature timestamp window");
});

test("live webhook accepts only the configured recurring Premium price", () => {
  has(source, /price_1UgXeyLksdx1RrYz3hg6bfrK/, "inactive prelaunch live price");
  has(source, /priceId !== EXPECTED_PRICE_ID/, "price allowlist");
  has(source, /customer\.subscription\.deleted/, "cancellation handling");
});

test("live subscription storage stays isolated, private, and service-role-only", () => {
  has(migration, /livemode boolean not null default true check \(livemode = true\)/i, "live-only rows");
  has(migration, /enable row level security/i, "RLS");
  has(migration, /on conflict\(event_id\) do nothing/i, "event idempotency");
  has(migration, /to service_role/i, "service role only");
  has(migration, /last_event_created_at/i, "out-of-order protection");
});

test("live checkout stays gated until explicitly enabled and Stripe is ready", () => {
  has(billing, /STRIPE_LIVE_BILLING_ENABLED[\s\S]*?===\s*"true"/, "explicit live-payment switch");
  has(billing, /key\.startsWith\("sk_live_"\)/, "live-only secret key");
  has(billing, /account\.charges_enabled !== true/, "Stripe charge activation");
  has(billing, /price\.currency !== "chf".*price\.unit_amount !== 1499/, "CHF 14.99 amount guard");
  has(billing, /portal_available: portalReady/, "subscription portal remains separately available");
});

test("Premium UI selects live billing only after the server marks it available", () => {
  has(app, /invokeEdgeFunction\("stripe-live-billing", \{ action: "status" \}\)/, "live billing status");
  has(app, /result\.mode === "live" && result\.available === true/, "server-controlled live checkout gate");
  has(app, /mode === "live" \? "stripe-live-billing" : "stripe-sandbox-billing"/, "mode-specific checkout endpoint");
  has(app, /3 recherches par mois/, "Free tier monthly search limit");
});
