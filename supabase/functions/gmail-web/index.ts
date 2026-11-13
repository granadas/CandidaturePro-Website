const scope = "https://www.googleapis.com/auth/gmail.send";
const tokenEndpoint = "https://oauth2.googleapis.com/token";

Deno.serve(async (request: Request) => {
  const redirect = Deno.env.get("GMAIL_WEB_REDIRECT_URI") || "";
  const clientId = Deno.env.get("GMAIL_WEB_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("GMAIL_WEB_CLIENT_SECRET") || "";
  const siteOrigin = redirect ? new URL(redirect).origin : "https://candidaturepro.ch";
  const origin = request.headers.get("origin");
  const headers = {
    "Access-Control-Allow-Origin": siteOrigin,
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  const json = (data: object, status = 200) => Response.json(data, { status, headers });
  if (origin !== siteOrigin) return json({ message: "Origine non autorisée." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ message: "Méthode non autorisée." }, 405);

  const root = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ message: "Connectez-vous à Candidature Pro." }, 401);
  if (!root || !anonKey || !serviceKey) return json({ message: "Service indisponible." }, 503);

  try {
    const auth = await fetch(root + "/auth/v1/user", { headers: { apikey: anonKey, authorization } });
    if (!auth.ok) return json({ message: "Session Candidature Pro expirée." }, 401);
    const { id } = await auth.json();
    if (!id) return json({ message: "Session Candidature Pro invalide." }, 401);
    const body = await request.json().catch(() => null);
    const endpoint = root + "/rest/v1/web_gmail_connections";
    const filter = "?user_id=eq." + encodeURIComponent(id);
    const serviceHeaders = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };
    const configured = Boolean(redirect && clientId && clientSecret);

    if (body?.action === "status") {
      const status = await fetch(endpoint + filter + "&select=connected_at", { headers: serviceHeaders });
      if (!status.ok) return json({ message: "Statut Gmail indisponible." }, 503);
      const rows = await status.json();
      return json({ configured, connected: rows.length > 0 });
    }

    if (body?.action === "disconnect") {
      const read = await fetch(endpoint + filter + "&select=refresh_token,connected_at", { headers: serviceHeaders });
      if (!read.ok) return json({ message: "Déconnexion Gmail indisponible." }, 503);
      const [connection] = await read.json();
      if (!connection) return json({ connected: false });
      const revoked = await fetch("https://oauth2.googleapis.com/revoke", {
        method: "POST", body: new URLSearchParams({ token: connection.refresh_token })
      });
      if (!revoked.ok) {
        const error = await revoked.json().catch(() => null);
        if (error?.error !== "invalid_token") return json({ message: "Google n’a pas confirmé la révocation." }, 502);
      }
      const removed = await fetch(endpoint + filter + "&select=user_id&connected_at=eq." + encodeURIComponent(connection.connected_at), {
        method: "DELETE", headers: { ...serviceHeaders, Prefer: "return=representation" }
      });
      if (!removed.ok) return json({ message: "Impossible de retirer la connexion Gmail." }, 503);
      if (!(await removed.json()).length) return json({ message: "La connexion Gmail a changé. Actualisez les paramètres." }, 409);
      return json({ connected: false });
    }

    if (!configured) return json({ message: "La connexion Gmail web attend la configuration Google." }, 503);

    if (body?.action === "start" && /^[a-zA-Z0-9_-]{43}$/.test(body.challenge || "") && /^[a-zA-Z0-9_-]{43}$/.test(body.state || "")) {
      const url = new URL("https://accounts.google.com/o/oauth2/v2/auth");
      url.search = new URLSearchParams({
        client_id: clientId, redirect_uri: redirect, response_type: "code",
        scope, state: body.state, code_challenge: body.challenge,
        code_challenge_method: "S256", access_type: "offline", prompt: "consent"
      }).toString();
      return json({ url: url.href });
    }

    if (body?.action === "exchange" && typeof body.code === "string" && body.code.length > 0 && body.code.length <= 4096 && /^[a-zA-Z0-9_-]{43}$/.test(body.verifier || "")) {
      const response = await fetch(tokenEndpoint, {
        method: "POST",
        body: new URLSearchParams({
          code: body.code, code_verifier: body.verifier, client_id: clientId,
          client_secret: clientSecret, redirect_uri: redirect, grant_type: "authorization_code"
        })
      });
      const token = await response.json().catch(() => null);
      if (!response.ok || !token?.refresh_token || !token?.scope?.split(" ").includes(scope)) {
        return json({ message: "Google n’a pas accordé l’autorisation Gmail. Relancez la connexion." }, 422);
      }
      const saved = await fetch(endpoint + "?on_conflict=user_id&select=user_id", {
        method: "POST",
        headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "resolution=ignore-duplicates,return=representation" },
        body: JSON.stringify({ user_id: id, refresh_token: token.refresh_token })
      });
      if (!saved.ok) return json({ message: "Impossible d’enregistrer la connexion Gmail." }, 503);
      if (!(await saved.json()).length) return json({ message: "Un compte Gmail est déjà lié. Déconnectez-le avant d’en choisir un autre." }, 409);
      return json({ connected: true });
    }
    return json({ message: "Requête Gmail invalide." }, 400);
  } catch {
    return json({ message: "Le service Gmail est temporairement indisponible." }, 503);
  }
});
