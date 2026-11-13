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

    if (body?.action === "send") {
      const { applicationId, recipient, subject, message } = body;
      const email = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;
      if (typeof applicationId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(applicationId) ||
          typeof recipient !== "string" || recipient.length > 254 || !email.test(recipient) ||
          typeof subject !== "string" || !subject.trim() || subject.length > 120 || /[\r\n]/.test(subject) ||
          typeof message !== "string" || !message.trim() || message.length > 12000) {
        return json({ message: "Vérifiez le destinataire, l’objet et le texte du message." }, 400);
      }
      const read = await fetch(endpoint + filter + "&select=refresh_token", { headers: serviceHeaders });
      if (!read.ok) return json({ message: "Connexion Gmail indisponible." }, 503);
      const [connection] = await read.json();
      if (!connection) return json({ message: "Connectez Gmail dans les paramètres." }, 409);
      const refresh = await fetch(tokenEndpoint, {
        method: "POST",
        body: new URLSearchParams({ refresh_token: connection.refresh_token, client_id: clientId,
          client_secret: clientSecret, grant_type: "refresh_token" })
      });
      const access = await refresh.json().catch(() => null);
      if (!refresh.ok || !access?.access_token) {
        return json({ message: "Impossible d’autoriser l’envoi. Vérifiez la connexion Gmail dans les paramètres." }, 502);
      }
      const attachments = parseAttachments(body.attachments ?? []);
      if (!attachments) return json({ message: "Ajoutez au maximum deux PDF de 5 Mo au total." }, 400);
      const raw = encodeMessage(recipient, subject, message, attachments);
      const rpc = (name: string, args: object) => fetch(root + "/rest/v1/rpc/" + name, {
        method: "POST",
        headers: { ...serviceHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ p_user: id, p_application: applicationId, ...args })
      });
      const reservation = await rpc("reserve_web_gmail_delivery", { p_email: recipient });
      const reserved = await reservation.json().catch(() => null);
      if (!reservation.ok) return json({ message: "Impossible de vérifier le quota d’envoi." }, 503);
      if (!reserved?.reserved) return json({ message: reserved?.error || "Envoi indisponible." }, 409);
      const uncertain = () => json({ message: "Résultat incertain. Vérifiez le dossier Envoyés dans Gmail. Un second envoi est bloqué." }, 502);
      try {
        const sent = await fetch("https://gmail.googleapis.com/gmail/v1/users/me/messages/send", {
          method: "POST", signal: AbortSignal.timeout(20000),
          headers: { Authorization: "Bearer " + access.access_token, "Content-Type": "application/json" },
          body: JSON.stringify({ raw })
        });
        if ([400, 401, 403, 429].includes(sent.status)) {
          const released = await rpc("finish_web_gmail_delivery", { p_message: null });
          if (!released.ok) return uncertain();
          return json({ message: "Gmail a refusé le message. Vérifiez le compte Gmail avant de réessayer." }, 422);
        }
        if (!sent.ok) return uncertain();
        const result = await sent.json();
        if (typeof result.id !== "string" || !result.id) return uncertain();
        const recorded = await rpc("finish_web_gmail_delivery", { p_message: result.id });
        if (!recorded.ok) return uncertain();
        return json({ sent: true });
      } catch {
        return uncertain();
      }
    }

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

function mimeBase64(text: string) {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 8192) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  }
  return btoa(binary);
}

type Attachment = { name: string; data: string };

function parseAttachments(input: unknown): Attachment[] | null {
  if (!Array.isArray(input) || input.length > 2) return null;
  let size = 0;
  for (const item of input) {
    if (typeof item?.name !== "string" || !/\.pdf$/i.test(item.name) || item.name.length > 255 ||
        typeof item.data !== "string" || item.data.length > Math.ceil(5 * 1024 * 1024 / 3) * 4 ||
        item.data.length % 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data) ||
        !atob(item.data.slice(0, 8)).startsWith("%PDF-")) return null;
    size += item.data.length / 4 * 3 - (item.data.match(/=+$/)?.[0].length ?? 0);
  }
  return size <= 5 * 1024 * 1024 ? input : null;
}

function encodeMessage(recipient: string, subject: string, message: string, attachments: Attachment[]) {
  const words: string[] = [];
  let part = "";
  for (const char of subject) {
    if (mimeBase64(part + char).length > 60) {
      words.push("=?UTF-8?B?" + mimeBase64(part) + "?=");
      part = "";
    }
    part += char;
  }
  words.push("=?UTF-8?B?" + mimeBase64(part) + "?=");
  const wrap = (value: string) => value.match(/.{1,76}/g)?.join("\r\n") || "";
  const body = ["Content-Type: text/plain; charset=UTF-8", "Content-Transfer-Encoding: base64", "",
    wrap(mimeBase64(message.replace(/\r\n|\r|\n/g, "\r\n")))];
  const headers = ["To: " + recipient, "Subject: " + words.join("\r\n "), "MIME-Version: 1.0"];
  if (attachments.length) {
    const boundary = "candidature-" + crypto.randomUUID();
    headers.push('Content-Type: multipart/mixed; boundary="' + boundary + '"', "", "--" + boundary, ...body);
    for (const file of attachments) {
      const name = file.name.slice(0, -4).normalize("NFKD").replace(/[^a-zA-Z0-9._ -]/g, "").trim().slice(0, 90) || "document";
      headers.push("--" + boundary, "Content-Type: application/pdf", "Content-Transfer-Encoding: base64",
        'Content-Disposition: attachment; filename="' + name + '.pdf"', "", wrap(file.data));
    }
    headers.push("--" + boundary + "--");
  } else {
    headers.push(...body);
  }
  return mimeBase64(headers.join("\r\n") + "\r\n").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
