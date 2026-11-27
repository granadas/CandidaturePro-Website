import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const encoder = new TextEncoder();
const encoderHex = (bytes: Uint8Array) => [...bytes].map(value => value.toString(16).padStart(2, "0")).join("");

async function verifyStripeSignature(raw: string, header: string, secret: string) {
  const parts = header.split(",").map(part => part.trim());
  const timestamp = parts.find(part => part.startsWith("t="))?.slice(2) || "";
  if (!/^\d+$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) return false;
  const key = await crypto.subtle.importKey("raw", encoder.encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  const expected = encoderHex(new Uint8Array(await crypto.subtle.sign("HMAC", key, encoder.encode(`${timestamp}.${raw}`))));
  return parts.filter(part => /^v1=[a-f0-9]{64}$/i.test(part)).some(part => {
    const actual = part.slice(3).toLowerCase();
    if (actual.length !== expected.length) return false;
    let difference = 0;
    for (let i = 0; i < expected.length; i++) difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
    return difference === 0;
  });
}

Deno.serve(async (req: Request) => {
  if (req.method !== "POST") return new Response("Method not allowed", { status: 405 });
  const secret = Deno.env.get("STRIPE_SANDBOX_WEBHOOK_SECRET");
  const url = Deno.env.get("SUPABASE_URL");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const configuredPrice = Deno.env.get("STRIPE_SANDBOX_PRICE_ID") || "price_1UgS6DLUEvqvukzc3dY7vPq5";
  if (!secret || !url || !service || !configuredPrice) return new Response("Not configured", { status: 503 });

  const raw = await req.text();
  if (!(await verifyStripeSignature(raw, req.headers.get("stripe-signature") || "", secret))) {
    return new Response("Invalid signature", { status: 400 });
  }

  let event: any;
  try { event = JSON.parse(raw); } catch { return new Response("Invalid JSON", { status: 400 }); }
  if (event?.livemode !== false || !/^evt_[A-Za-z0-9]+$/.test(event.id || "") ||
      !Number.isSafeInteger(event.created) || event.created < 0 || event.created > 253402300799) {
    return new Response("Invalid sandbox event", { status: 400 });
  }
  const accepted = new Set(["customer.subscription.created", "customer.subscription.updated", "customer.subscription.deleted"]);
  if (!accepted.has(event.type)) return new Response("Ignored", { status: 200 });

  const subscription = event.data?.object;
  const userId = subscription?.metadata?.candidaturepro_user_id;
  const customerId = typeof subscription?.customer === "string" ? subscription.customer : subscription?.customer?.id;
  const priceId = subscription?.items?.data?.map((item: any) => item?.price?.id).find((id: string) => id === configuredPrice);
  const periodEnd = subscription?.current_period_end;
  const status = subscription?.status;
  if (!/^sub_[A-Za-z0-9]+$/.test(subscription?.id || "") ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(userId || "") ||
      !/^cus_[A-Za-z0-9]+$/.test(customerId || "") || priceId !== configuredPrice ||
      !Number.isSafeInteger(periodEnd) || periodEnd < 0 || periodEnd > 253402300799 ||
      !["active", "trialing", "past_due", "unpaid", "canceled", "incomplete", "incomplete_expired", "paused"].includes(status)) {
    return new Response("Invalid subscription payload", { status: 400 });
  }

  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(userId)}&select=id`, {
    headers: { apikey: service, Authorization: `Bearer ${service}`, Accept: "application/json" }
  });
  if (!profileResponse.ok) return new Response("Profile lookup failed", { status: 503 });
  if ((await profileResponse.json()).length === 0) return new Response("Unknown account", { status: 200 });

  const response = await fetch(`${url}/rest/v1/rpc/apply_stripe_sandbox_subscription_event`, {
    method: "POST",
    headers: { apikey: service, Authorization: `Bearer ${service}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      p_event_id: event.id,
      p_event_type: event.type,
      p_event_created_at: new Date(event.created * 1000).toISOString(),
      p_subscription_id: subscription.id,
      p_user_id: userId,
      p_customer_id: customerId,
      p_price_id: priceId,
      p_status: event.type === "customer.subscription.deleted" ? "canceled" : status,
      p_current_period_end: new Date(periodEnd * 1000).toISOString(),
      p_cancel_at_period_end: subscription.cancel_at_period_end === true
    })
  });
  if (!response.ok) return new Response("Subscription update failed", { status: 503 });
  return new Response("Received", { status: 200 });
});
