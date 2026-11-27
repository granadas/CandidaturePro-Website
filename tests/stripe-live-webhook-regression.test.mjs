import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const read = path => readFileSync(new URL(path, import.meta.url), "utf8");
const source = read("../supabase/functions/stripe-live-webhook/index.ts");
const migration = read("../supabase/migrations/20261127230000_stripe_live_billing_storage.sql");
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
