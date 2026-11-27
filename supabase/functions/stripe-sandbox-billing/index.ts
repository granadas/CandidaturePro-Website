import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const PRICE_ID = Deno.env.get("STRIPE_SANDBOX_PRICE_ID") || "price_1UgS6DLUEvqvukzc3dY7vPq5";
const PORTAL_CONFIGURATION_ID = Deno.env.get("STRIPE_SANDBOX_PORTAL_CONFIGURATION_ID") || "bpc_1UgXDlLUEvqvukzcPjA13rQe";
const SITE_URL = Deno.env.get("CANDIDATURE_PRO_SITE_URL") || "https://candidaturepro.ch";
const ALLOWED_ORIGINS = new Set(["https://candidaturepro.ch", "https://www.candidaturepro.ch"]);
const headersFor = (origin: string | null) => ({
  "Access-Control-Allow-Origin": origin && ALLOWED_ORIGINS.has(origin) ? origin : "https://candidaturepro.ch",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Vary": "Origin",
  "Content-Type": "application/json"
});

function reply(status: number, body: unknown, origin: string | null) {
  return new Response(JSON.stringify(body), { status, headers: headersFor(origin) });
}

async function stripePost(path: string, params: URLSearchParams, key: string, idempotencyKey: string) {
  return await fetch(`https://api.stripe.com/v1/${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/x-www-form-urlencoded",
      "Idempotency-Key": idempotencyKey
    },
    body: params
  });
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("origin");
  if (origin && !ALLOWED_ORIGINS.has(origin)) return reply(403, { error: "Origin non autorisée." }, origin);
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: headersFor(origin) });
  if (req.method !== "POST") return reply(405, { error: "Méthode non autorisée." }, origin);

  const auth = req.headers.get("authorization");
  if (!auth?.startsWith("Bearer ")) return reply(401, { error: "Connectez-vous pour continuer." }, origin);
  const url = Deno.env.get("SUPABASE_URL");
  const anon = Deno.env.get("SUPABASE_ANON_KEY");
  const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const stripeKey = Deno.env.get("STRIPE_SANDBOX_SECRET_KEY");
  if (!url || !anon || !service || !stripeKey?.startsWith("sk_test_") || !PRICE_ID.startsWith("price_")) {
    return reply(503, { error: "Le paiement sandbox n’est pas configuré." }, origin);
  }

  const userResponse = await fetch(`${url}/auth/v1/user`, { headers: { Authorization: auth, apikey: anon } });
  if (!userResponse.ok) return reply(401, { error: "Session expirée. Reconnectez-vous." }, origin);
  const user = await userResponse.json();
  if (!user?.id || user.is_anonymous) return reply(403, { error: "Un compte candidat est requis." }, origin);

  let body: { action?: string };
  try { body = await req.json(); } catch { return reply(400, { error: "Requête invalide." }, origin); }
  if (!["status", "checkout", "portal"].includes(body.action || "")) return reply(400, { error: "Action de paiement invalide." }, origin);

  const profileResponse = await fetch(`${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin,plan,premium_until`, {
    headers: { apikey: service, Authorization: `Bearer ${service}`, Accept: "application/json" }
  });
  const profiles = profileResponse.ok ? await profileResponse.json() : [];
  const profile = profiles[0];
  if (!profile) return reply(404, { error: "Profil candidat introuvable." }, origin);

  const subscriptionsResponse = await fetch(`${url}/rest/v1/stripe_sandbox_subscriptions?user_id=eq.${encodeURIComponent(user.id)}&select=subscription_id,customer_id,status,current_period_end,cancel_at_period_end,updated_at&order=updated_at.desc&limit=1`, {
    headers: { apikey: service, Authorization: `Bearer ${service}`, Accept: "application/json" }
  });
  if (!subscriptionsResponse.ok) return reply(503, { error: "Impossible de vérifier l’abonnement." }, origin);
  const subscriptions = await subscriptionsResponse.json();
  const subscription = subscriptions[0] || null;
  if (body.action === "status") return reply(200, { subscription, plan: profile.plan || "free" }, origin);
  if (body.action === "checkout" && profile.is_admin !== true) return reply(403, { error: "Le paiement de validation est réservé à l’administrateur." }, origin);

  const now = Date.now();
  const active = subscription && ["active", "trialing", "past_due"].includes(subscription.status) &&
    (!subscription.current_period_end || Date.parse(subscription.current_period_end) > now);
  if (body.action === "checkout" && active) return reply(409, { error: "Un abonnement est déjà actif. Gérez-le depuis votre espace Premium." }, origin);

  const requestId = crypto.randomUUID().replaceAll("-", "");
  if (body.action === "checkout") {
    const params = new URLSearchParams({
      mode: "subscription",
      "line_items[0][price]": PRICE_ID,
      "line_items[0][quantity]": "1",
      success_url: `${SITE_URL}/app/?billing=success`,
      cancel_url: `${SITE_URL}/app/?billing=cancelled`,
      locale: "fr",
      client_reference_id: user.id,
      "metadata[candidaturepro_user_id]": user.id,
      "subscription_data[metadata][candidaturepro_user_id]": user.id,
      integration_identifier: `candidaturepro-${crypto.getRandomValues(new Uint8Array(4)).reduce((s, x) => s + x.toString(16).padStart(2, "0"), "")}`
    });
    const response = await stripePost("checkout/sessions", params, stripeKey, `candidaturepro-sandbox-checkout-${requestId}`);
    const session = await response.json();
    if (!response.ok || session.livemode !== false || !session.url?.startsWith("https://checkout.stripe.com/")) {
      return reply(502, { error: "Impossible d’ouvrir le paiement Stripe de test." }, origin);
    }
    return reply(200, { url: session.url, sandbox: true }, origin);
  }

  if (body.action === "portal") {
    if (!subscription?.customer_id) return reply(404, { error: "Aucun abonnement à gérer n’est associé à votre compte." }, origin);
    const params = new URLSearchParams({ customer: subscription.customer_id, configuration: PORTAL_CONFIGURATION_ID, return_url: `${SITE_URL}/app/?billing=returned` });
    const response = await stripePost("billing_portal/sessions", params, stripeKey, `candidaturepro-sandbox-portal-${requestId}`);
    const portal = await response.json();
    if (!response.ok || portal.livemode === true || !portal.url?.startsWith("https://billing.stripe.com/")) {
      return reply(502, { error: "Impossible d’ouvrir la gestion Stripe." }, origin);
    }
    return reply(200, { url: portal.url, sandbox: true }, origin);
  }
  return reply(400, { error: "Action de paiement invalide." }, origin);
});
