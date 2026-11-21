const authority = "https://login.microsoftonline.com/common/oauth2/v2.0";
const scopes = ["offline_access", "Mail.Read", "Mail.ReadWrite", "Mail.Send"];

async function saveRotatedRefreshToken(root: string, key: string, userId: string, refreshToken: unknown) {
  if (typeof refreshToken !== "string" || !refreshToken) return;
  await fetch(root + "/rest/v1/web_outlook_connections?user_id=eq." + encodeURIComponent(userId), {
    method: "PATCH", headers: { apikey: key, Authorization: "Bearer " + key, "Content-Type": "application/json",
      Prefer: "return=minimal" }, body: JSON.stringify({ refresh_token: refreshToken, connected_at: new Date().toISOString() })
  });
}

function parseAttachments(input: unknown) {
  if (!Array.isArray(input) || input.length > 8) return null;
  let size = 0;
  for (const item of input) {
    if (typeof item?.name !== "string" || !/\.pdf$/i.test(item.name) || item.name.length > 255 ||
        typeof item.data !== "string" || item.data.length > 14_000_000 || item.data.length % 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(item.data)) return null;
    try { if (!atob(item.data.slice(0, 8)).startsWith("%PDF-")) return null; }
    catch { return null; }
    size += item.data.length / 4 * 3 - (item.data.match(/=+$/)?.[0].length ?? 0);
  }
  return size <= 10 * 1024 * 1024 ? input as { name: string; data: string }[] : null;
}

const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9-]+(?:\.[a-zA-Z0-9-]+)+$/;

function isAutomaticReply(headers: { name: string; value: string }[] = []) {
  const values = new Map(headers.map(header => [header.name.toLowerCase(), header.value.trim().toLowerCase()]));
  const from = values.get("from") || "";
  const contentType = values.get("content-type") || "";
  if (/mailer-daemon|postmaster@/.test(from) || /delivery-status|multipart\/report/.test(contentType) || values.get("return-path") === "<>") return false;
  const submitted = (values.get("auto-submitted") || "").split(";")[0].trim();
  return submitted === "auto-replied" || ["x-autoreply", "x-autorespond"].some(name => {
    const value = (values.get(name) || "").split(";")[0].trim(); return Boolean(value && value !== "no");
  });
}

Deno.serve(async (request: Request) => {
  const productionRedirect = "https://candidaturepro.ch/app/";
  const configuredRedirect = Deno.env.get("OUTLOOK_WEB_REDIRECT_URI") || "";
  const origin = request.headers.get("origin");
  const redirect = origin === new URL(productionRedirect).origin ? productionRedirect : configuredRedirect;
  const siteOrigin = redirect ? new URL(redirect).origin : null;
  const headers = {
    "Access-Control-Allow-Origin": siteOrigin || "null",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Cache-Control": "no-store",
    "Vary": "Origin"
  };
  const json = (data: object, status = 200) => Response.json(data, { status, headers });
  if (!siteOrigin || origin !== siteOrigin) return json({ message: "Origine non autorisée." }, 403);
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return json({ message: "Méthode non autorisée." }, 405);

  const root = Deno.env.get("SUPABASE_URL");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  let clientId = Deno.env.get("OUTLOOK_WEB_CLIENT_ID") || Deno.env.get("MAIL_PROVIDER_B_CLIENT_ID") || "";
  const clientSecret = Deno.env.get("OUTLOOK_WEB_CLIENT_SECRET") || Deno.env.get("MAIL_PROVIDER_B_CLIENT_SECRET") || "";
  const authorization = request.headers.get("authorization");
  if (!authorization) return json({ message: "Connectez-vous à Candidature Pro." }, 401);
  if (!root || !anonKey || !serviceKey) return json({ message: "Service indisponible." }, 503);

  try {
    const auth = await fetch(root + "/auth/v1/user", { headers: { apikey: anonKey, authorization } });
    if (!auth.ok) return json({ message: "Session Candidature Pro expirée." }, 401);
    const { id } = await auth.json();
    if (!id) return json({ message: "Session Candidature Pro invalide." }, 401);
    if (!clientId) {
      const providerConfig = await fetch(root + "/functions/v1/mail-oauth-config?provider=outlook", {
        headers: { apikey: anonKey, authorization }
      });
      const config = providerConfig.ok ? await providerConfig.json().catch(() => null) : null;
      if (typeof config?.clientId === "string") clientId = config.clientId;
    }
    const body = await request.json().catch(() => null);
    const endpoint = root + "/rest/v1/web_outlook_connections";
    const filter = "?user_id=eq." + encodeURIComponent(id);
    const serviceHeaders = { apikey: serviceKey, Authorization: "Bearer " + serviceKey };

    if (body?.action === "status") {
      const status = await fetch(endpoint + filter + "&select=connected_at", { headers: serviceHeaders });
      if (!status.ok) return json({ message: "Statut Outlook indisponible." }, 503);
      return json({ configured: Boolean(clientId && clientSecret && redirect), connected: (await status.json()).length > 0 });
    }
    if (body?.action === "start") {
      if (!clientId || !clientSecret || !redirect) return json({ message: "La connexion Outlook web attend la configuration Microsoft." }, 503);
      if (!/^[A-Za-z0-9_-]{43}$/.test(body.challenge || "") || !/^[A-Za-z0-9_-]{43}$/.test(body.state || "")) {
        return json({ message: "Demande OAuth invalide." }, 400);
      }
      const url = new URL(authority + "/authorize");
      url.search = new URLSearchParams({
        client_id: clientId, response_type: "code", response_mode: "query", redirect_uri: redirect,
        scope: scopes.join(" "), state: body.state, code_challenge: body.challenge,
        code_challenge_method: "S256", prompt: "select_account"
      }).toString();
      return json({ url: url.href });
    }
    if (body?.action === "exchange") {
      if (!clientId || !clientSecret || !redirect) return json({ message: "La connexion Outlook web attend la configuration Microsoft." }, 503);
      if (typeof body.code !== "string" || !body.code || body.code.length > 4096 ||
          !/^[A-Za-z0-9_-]{43}$/.test(body.verifier || "")) return json({ message: "Code Outlook invalide." }, 400);
      const response = await fetch(authority + "/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "authorization_code", code: body.code,
          redirect_uri: redirect, code_verifier: body.verifier, scope: scopes.join(" ") })
      });
      const token = await response.json().catch(() => null);
      const granted = typeof token?.scope === "string" ? token.scope.split(" ") : [];
      if (!response.ok || !token?.refresh_token || !granted.includes("Mail.Read") || !granted.includes("Mail.ReadWrite") || !granted.includes("Mail.Send")) {
        return json({ message: "Microsoft n’a pas accordé l’accès nécessaire à Outlook. Relancez la connexion." }, 422);
      }
      const saved = await fetch(endpoint + "?on_conflict=user_id&select=user_id", {
        method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json", Prefer: "resolution=merge-duplicates,return=representation" },
        body: JSON.stringify({ user_id: id, refresh_token: token.refresh_token, scopes: granted, connected_at: new Date().toISOString() })
      });
      if (!saved.ok) return json({ message: "Impossible d’enregistrer la connexion Outlook." }, 503);
      return json({ connected: true });
    }
    if (body?.action === "disconnect") {
      const removed = await fetch(endpoint + filter + "&select=user_id", { method: "DELETE", headers: serviceHeaders });
      if (!removed.ok) return json({ message: "Impossible de retirer la connexion Outlook." }, 503);
      return json({ connected: false });
    }

    if (body?.action === "send") {
      if (!clientId || !clientSecret) return json({ message: "La connexion Outlook web attend la configuration Microsoft." }, 503);
      const { applicationId, recipient, subject, message, reviewedAt } = body;
      if (typeof applicationId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(applicationId) ||
          typeof recipient !== "string" || recipient.length > 254 || !emailPattern.test(recipient) ||
          typeof subject !== "string" || !subject.trim() || subject.length > 120 || /[\r\n]/.test(subject) ||
          typeof message !== "string" || !message.trim() || message.length > 12000 ||
          (reviewedAt !== undefined && (typeof reviewedAt !== "string" || !Number.isFinite(Date.parse(reviewedAt))))) {
        return json({ message: "Vérifiez le destinataire, l’objet et le texte du message." }, 400);
      }
      const connectionResponse = await fetch(endpoint + filter + "&select=refresh_token", { headers: serviceHeaders });
      if (!connectionResponse.ok) return json({ message: "Connexion Outlook indisponible." }, 503);
      const [connection] = await connectionResponse.json();
      if (!connection) return json({ message: "Connectez Outlook dans Paramètres avant de poursuivre." }, 409);
      const refreshed = await fetch(authority + "/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: connection.refresh_token,
          scope: scopes.join(" ") })
      });
      const token = await refreshed.json().catch(() => null);
      if (!refreshed.ok || !token?.access_token) return json({ message: "Reconnectez Outlook dans les paramètres." }, 409);
      await saveRotatedRefreshToken(root, serviceKey, id, token.refresh_token);
      const attachments = parseAttachments(body.attachments ?? []);
      if (!attachments) return json({ message: "Ajoutez au maximum huit PDF de 10 Mo au total." }, 400);
      const rpc = (name: string, args: object) => fetch(root + "/rest/v1/rpc/" + name, {
        method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ p_user: id, p_application: applicationId, ...args })
      });
      const reservation = reviewedAt === undefined
        ? await rpc("reserve_web_gmail_delivery", { p_email: recipient })
        : await rpc("reserve_reviewed_web_gmail_delivery", { p_email: recipient, p_reviewed_at: reviewedAt });
      const reserved = await reservation.json().catch(() => null);
      if (!reservation.ok) return json({ message: "Impossible de vérifier le quota d’envoi." }, 503);
      if (!reserved?.reserved) return json({ message: reserved?.error || "Envoi indisponible." }, 409);
      const writeHeaders = { ...serviceHeaders, "Content-Type": "application/json" };
      const providerSet = await fetch(root + "/rest/v1/web_gmail_deliveries" + filter + "&application_id=eq." +
        encodeURIComponent(applicationId), { method: "PATCH", headers: { ...writeHeaders, Prefer: "return=minimal" },
        body: JSON.stringify({ provider: "outlook" }) });
      if (!providerSet.ok) return json({ message: "Impossible de préparer le suivi Outlook." }, 503);
      const graphHeaders = { Authorization: "Bearer " + token.access_token, "Content-Type": "application/json", Prefer: 'IdType="ImmutableId"' };
      const draftResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages", {
        method: "POST", signal: AbortSignal.timeout(20000), headers: graphHeaders,
        body: JSON.stringify({ subject, body: { contentType: "text", content: message },
          toRecipients: [{ emailAddress: { address: recipient } }],
          attachments: attachments.map(file => ({ "@odata.type": "#microsoft.graph.fileAttachment", name: file.name,
            contentType: "application/pdf", contentBytes: file.data })) })
      });
      const draft = await draftResponse.json().catch(() => null);
      if (!draftResponse.ok || typeof draft?.id !== "string") {
        const released = await rpc("finish_web_gmail_delivery", { p_message: null });
        return json({ message: released.ok ? "Outlook a refusé le message." : "Envoi incertain. Vérifiez les Brouillons Outlook avant de réessayer." }, released.ok ? 422 : 502);
      }
      const sent = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id) + "/send", {
        method: "POST", signal: AbortSignal.timeout(20000), headers: { Authorization: "Bearer " + token.access_token, Prefer: 'IdType="ImmutableId"' }
      });
      if (!sent.ok) {
        const deleted = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id), {
          method: "DELETE", headers: { Authorization: "Bearer " + token.access_token }
        });
        const released = deleted.ok ? await rpc("finish_web_gmail_delivery", { p_message: null }) : null;
        return json({ message: released?.ok ? "Outlook n’a pas envoyé le message. Vous pouvez réessayer." :
          "Résultat incertain. Vérifiez les éléments Envoyés et Brouillons Outlook avant de réessayer.", uncertain: !released?.ok }, released?.ok ? 422 : 502);
      }
      const tracked = await rpc("finish_web_gmail_delivery", { p_message: draft.id });
      if (!tracked.ok) return json({ message: "Outlook a envoyé le message, mais le suivi n’a pas été enregistré. Ne le renvoyez pas.", uncertain: true }, 502);
      return json({ sent: true });
    }

    if (body?.action === "refresh_replies") {
      if (!clientId || !clientSecret) return json({ message: "La connexion Outlook web attend la configuration Microsoft." }, 503);
      const connectionResponse = await fetch(endpoint + filter + "&select=refresh_token", { headers: serviceHeaders });
      if (!connectionResponse.ok) return json({ message: "Connexion Outlook indisponible." }, 503);
      const [connection] = await connectionResponse.json();
      if (!connection) return json({ needsConsent: true });
      const refreshed = await fetch(authority + "/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: connection.refresh_token,
          scope: scopes.join(" ") })
      });
      const token = await refreshed.json().catch(() => null);
      if (!refreshed.ok || !token?.access_token) return json({ needsConsent: true });
      await saveRotatedRefreshToken(root, serviceKey, id, token.refresh_token);
      const rest = root + "/rest/v1/";
      const after = typeof body.after === "string" && /^[0-9a-f-]{36}$/i.test(body.after) ? body.after : null;
      const pageSize = 10;
      const rowsResponse = await fetch(rest + "web_gmail_deliveries" + filter +
        "&provider=eq.outlook&select=application_id,message_id&message_id=not.is.null&order=application_id.asc&limit=" +
        (pageSize + 1) + (after ? "&application_id=gt." + encodeURIComponent(after) : ""), { headers: serviceHeaders });
      if (!rowsResponse.ok) return json({ message: "Dossiers envoyés indisponibles." }, 503);
      const rows = await rowsResponse.json();
      const page = rows.slice(0, pageSize);
      const graphHeaders = { Authorization: "Bearer " + token.access_token, Prefer: 'IdType="ImmutableId"' };
      const processDelivery = async (delivery: { application_id: string; message_id: string }) => {
        const originalResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages/" +
          encodeURIComponent(delivery.message_id) + "?$select=id,conversationId,sentDateTime,from", { headers: graphHeaders, signal: AbortSignal.timeout(10000) });
        if (originalResponse.status === 404) return 0;
        if (!originalResponse.ok) throw new Error("Impossible de consulter les conversations Outlook.");
        const original = await originalResponse.json();
        if (!original.conversationId) return 0;
        const query = new URLSearchParams({ "$filter": "conversationId eq '" + String(original.conversationId).replace(/'/g, "''") + "'",
          "$select": "id,receivedDateTime,sentDateTime,isDraft,from,internetMessageHeaders", "$top": "100" });
        const messagesResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages?" + query, {
          headers: graphHeaders, signal: AbortSignal.timeout(10000)
        });
        if (!messagesResponse.ok) throw new Error("Impossible de lire les réponses Outlook.");
        const messages = (await messagesResponse.json()).value || [];
        const originalAt = Date.parse(original.sentDateTime || "");
        if (!Number.isFinite(originalAt)) return 0;
        const ownEmail = String(original.from?.emailAddress?.address || "").toLowerCase();
        let automatic = originalAt, human = originalAt;
        for (const item of messages) {
          if (item.id === delivery.message_id || item.isDraft || !item.from?.emailAddress?.address ||
              String(item.from.emailAddress.address).toLowerCase() === ownEmail) continue;
          const received = Date.parse(item.receivedDateTime || item.sentDateTime || "");
          if (!Number.isFinite(received) || received <= originalAt) continue;
          const headers = new Map((item.internetMessageHeaders || []).map((entry: { name: string; value: string }) =>
            [entry.name.toLowerCase(), entry.value.trim().toLowerCase()]));
          const submitted = String(headers.get("auto-submitted") || "").split(";")[0].trim();
          const auto = submitted === "auto-replied" || ["x-autoreply", "x-autorespond"].some(name => {
            const value = String(headers.get(name) || "").split(";")[0].trim(); return Boolean(value && value !== "no");
          });
          if (auto) automatic = Math.max(automatic, received); else human = Math.max(human, received);
        }
        if (automatic === originalAt && human === originalAt) return 0;
        const changed = await fetch(rest + "rpc/record_web_gmail_replies", {
          method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json" },
          body: JSON.stringify({ p_user: id, p_application: delivery.application_id,
            p_automatic: automatic > originalAt ? new Date(automatic).toISOString() : null,
            p_human: human > originalAt ? new Date(human).toISOString() : null })
        });
        if (!changed.ok) throw new Error("Impossible d’enregistrer une réponse Outlook.");
        return (await changed.json()) === true ? 1 : 0;
      };
      let updated = 0;
      try {
        for (let offset = 0; offset < page.length; offset += 4) {
          const results = await Promise.all(page.slice(offset, offset + 4).map(processDelivery));
          updated += results.reduce((sum: number, count: number) => sum + count, 0);
        }
      } catch (error) { return json({ message: error instanceof Error ? error.message : "La vérification Outlook a échoué." }, 502); }
      return json({ updated, checked: page.length, next: rows.length > pageSize ? page.at(-1).application_id : null });
    }

    if (body?.action === "open_reply") {
      if (!clientId || !clientSecret) return json({ message: "La connexion Outlook web attend la configuration Microsoft." }, 503);
      const applicationId = body.applicationId;
      if (typeof applicationId !== "string" || !/^[0-9a-f-]{36}$/i.test(applicationId)) return json({ message: "Dossier invalide." }, 400);
      const [deliveryResponse, connectionResponse] = await Promise.all([
        fetch(root + "/rest/v1/web_gmail_deliveries" + filter + "&application_id=eq." + encodeURIComponent(applicationId) +
          "&provider=eq.outlook&select=message_id", { headers: serviceHeaders }),
        fetch(endpoint + filter + "&select=refresh_token", { headers: serviceHeaders })
      ]);
      if (!deliveryResponse.ok || !connectionResponse.ok) return json({ message: "Conversation Outlook indisponible." }, 503);
      const [delivery] = await deliveryResponse.json();
      const [connection] = await connectionResponse.json();
      if (!delivery?.message_id || !connection) return json({ message: "Aucune conversation Outlook associée à ce dossier." }, 404);
      const refreshed = await fetch(authority + "/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: connection.refresh_token,
          scope: scopes.join(" ") })
      });
      const token = await refreshed.json().catch(() => null);
      if (!refreshed.ok || !token?.access_token) return json({ message: "Reconnectez Outlook dans les paramètres." }, 409);
      await saveRotatedRefreshToken(root, serviceKey, id, token.refresh_token);
      const graphHeaders = { Authorization: "Bearer " + token.access_token };
      const originalResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(delivery.message_id) +
        "?$select=id,conversationId,sentDateTime,from,subject", { headers: graphHeaders });
      if (!originalResponse.ok) return json({ message: "Impossible de retrouver ce fil dans Outlook." }, 502);
      const original = await originalResponse.json();
      const ownEmail = String(original.from?.emailAddress?.address || "").toLowerCase();
      const query = new URLSearchParams({ "$filter": "conversationId eq '" + String(original.conversationId).replace(/'/g, "''") + "'",
        "$select": "id,receivedDateTime,sentDateTime,isDraft,from,subject,body,internetMessageHeaders", "$top": "100" });
      const threadResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages?" + query, { headers: graphHeaders });
      if (!threadResponse.ok) return json({ message: "Impossible de lire la réponse Outlook." }, 502);
      const messages = (await threadResponse.json()).value || [];
      const originalTime = Date.parse(original.sentDateTime || "");
      if (!Number.isFinite(originalTime)) return json({ message: "Date du message Outlook invalide." }, 502);
      const incoming = messages.filter((item: any) => item.id !== delivery.message_id && !item.isDraft &&
        String(item.from?.emailAddress?.address || "").toLowerCase() !== ownEmail &&
        Number.isFinite(Date.parse(item.receivedDateTime || item.sentDateTime || "")) &&
        Date.parse(item.receivedDateTime || item.sentDateTime || "") > originalTime)
        .sort((left: any, right: any) => Date.parse(left.receivedDateTime || left.sentDateTime) - Date.parse(right.receivedDateTime || right.sentDateTime));
      const previewMessages = incoming.slice(-20).map((item: any) => {
        const messageHeaders = new Map((item.internetMessageHeaders || []).map((header: { name: string; value: string }) =>
          [header.name.toLowerCase(), header.value.trim().toLowerCase()]));
        const submitted = String(messageHeaders.get("auto-submitted") || "").split(";")[0].trim();
        const automatic = submitted === "auto-replied" || ["x-autoreply", "x-autorespond"].some(name => {
          const value = String(messageHeaders.get(name) || "").split(";")[0].trim(); return Boolean(value && value !== "no");
        });
        const text = item.body?.contentType?.toLowerCase() === "text" ? item.body.content : "";
        const html = item.body?.contentType?.toLowerCase() === "html" ? item.body.content : "";
        return { id: item.id, from: item.from?.emailAddress?.address || "", subject: item.subject || "",
          receivedAt: item.receivedDateTime || item.sentDateTime || null, automatic,
          text: typeof text === "string" ? text.slice(0, 30000) : "", html: typeof html === "string" ? html.slice(0, 120000) : "" };
      });
      const latest = incoming.at(-1);
      const replyTo = latest && emailPattern.test(latest.from?.emailAddress?.address || "")
        ? { id: latest.id, recipient: latest.from.emailAddress.address } : null;
      return json({ threadId: original.conversationId, outlookMessageId: delivery.message_id,
        replies: previewMessages.map((item: any) => item.text), previewMessages,
        latestInboundAt: latest?.receivedDateTime || latest?.sentDateTime || null, replyTo,
        openUrl: "https://outlook.office.com/mail/inbox/id/" + encodeURIComponent(original.id) });
    }

    if (body?.action === "send_reply") {
      if (!clientId || !clientSecret) return json({ message: "La connexion Outlook web attend la configuration Microsoft." }, 503);
      const { applicationId, replyId, recipient, requestId, message } = body;
      if (typeof applicationId !== "string" || !/^[0-9a-f-]{36}$/i.test(applicationId) ||
          typeof replyId !== "string" || !replyId || replyId.length > 1024 ||
          typeof recipient !== "string" || !emailPattern.test(recipient) ||
          typeof requestId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) ||
          typeof message !== "string" || !message.trim() || message.length > 12000) {
        return json({ message: "Vérifiez le destinataire et le texte de la réponse." }, 400);
      }
      const [deliveryResponse, connectionResponse] = await Promise.all([
        fetch(root + "/rest/v1/web_gmail_deliveries" + filter + "&application_id=eq." + encodeURIComponent(applicationId) +
          "&provider=eq.outlook&select=message_id", { headers: serviceHeaders }),
        fetch(endpoint + filter + "&select=refresh_token", { headers: serviceHeaders })
      ]);
      if (!deliveryResponse.ok || !connectionResponse.ok) return json({ message: "Conversation Outlook indisponible." }, 503);
      const [delivery] = await deliveryResponse.json();
      const [connection] = await connectionResponse.json();
      if (!delivery?.message_id || !connection) return json({ message: "Aucune conversation Outlook associée à ce dossier." }, 404);
      const refreshed = await fetch(authority + "/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: connection.refresh_token,
          scope: scopes.join(" ") })
      });
      const token = await refreshed.json().catch(() => null);
      if (!refreshed.ok || !token?.access_token) return json({ message: "Reconnectez Outlook dans les paramètres." }, 409);
      await saveRotatedRefreshToken(root, serviceKey, id, token.refresh_token);
      const bearer = { Authorization: "Bearer " + token.access_token, Prefer: 'IdType="ImmutableId"' };
      const targetResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(replyId) +
        "?$select=id,conversationId,receivedDateTime,from", { headers: bearer });
      if (!targetResponse.ok) return json({ message: "La réponse a changé. Rouvrez le fil Outlook." }, 409);
      const target = await targetResponse.json();
      const originalResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(delivery.message_id) +
        "?$select=conversationId,sentDateTime,from", { headers: bearer });
      if (!originalResponse.ok) return json({ message: "Impossible de vérifier le fil Outlook." }, 502);
      const original = await originalResponse.json();
      const actualRecipient = String(target.from?.emailAddress?.address || "").toLowerCase();
      if (target.conversationId !== original.conversationId || actualRecipient !== recipient.trim().toLowerCase() ||
          Date.parse(target.receivedDateTime || "") <= Date.parse(original.sentDateTime || "")) {
        return json({ message: "Le fil a changé. Rouvrez la réponse avant l’envoi." }, 409);
      }
      const query = new URLSearchParams({ "$filter": "conversationId eq '" + String(original.conversationId).replace(/'/g, "''") + "'",
        "$select": "id,receivedDateTime,sentDateTime,isDraft,from", "$top": "100" });
      const latestResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages?" + query, { headers: bearer });
      if (!latestResponse.ok) return json({ message: "Impossible de vérifier la dernière réponse Outlook." }, 502);
      const ownSender = String(original.from?.emailAddress?.address || "").toLowerCase();
      const latestInbound = ((await latestResponse.json()).value || []).filter((item: any) => item.id !== delivery.message_id && !item.isDraft &&
        String(item.from?.emailAddress?.address || "").toLowerCase() !== ownSender &&
        Number.isFinite(Date.parse(item.receivedDateTime || item.sentDateTime || "")) &&
        Date.parse(item.receivedDateTime || item.sentDateTime || "") > Date.parse(original.sentDateTime || ""))
        .sort((left: any, right: any) => Date.parse(right.receivedDateTime || right.sentDateTime) - Date.parse(left.receivedDateTime || left.sentDateTime));
      if (latestInbound[0]?.id !== replyId) return json({ message: "Une réponse plus récente est arrivée. Rouvrez le fil Outlook." }, 409);
      const outbox = root + "/rest/v1/web_gmail_thread_sends";
      const attempt = outbox + filter + "&request_id=eq." + encodeURIComponent(requestId);
      const reservation = await fetch(outbox, { method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: id, request_id: requestId, application_id: applicationId, kind: "reply" }) });
      if (reservation.status === 409) {
        const previous = await fetch(attempt + "&select=confirmed_at,application_id,kind", { headers: serviceHeaders });
        const [row] = previous.ok ? await previous.json() : [];
        if (row?.confirmed_at && row.application_id === applicationId && row.kind === "reply") return json({ sent: true });
        return json({ message: "Cet envoi a déjà été demandé. Vérifiez les éléments Envoyés dans Outlook.", uncertain: true }, 409);
      }
      if (!reservation.ok) return json({ message: "Impossible de réserver l’envoi Outlook.", uncertain: true }, 503);
      const createReply = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(replyId) + "/createReply", {
        method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({})
      });
      const draft = await createReply.json().catch(() => null);
      if (!createReply.ok || typeof draft?.id !== "string") {
        await fetch(attempt, { method: "DELETE", headers: serviceHeaders });
        return json({ message: "Outlook n’a pas pu préparer la réponse." }, 502);
      }
      const patched = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id), {
        method: "PATCH", headers: { ...bearer, "Content-Type": "application/json" },
        body: JSON.stringify({ body: { contentType: "text", content: message.trim() } })
      });
      if (!patched.ok) {
        const deleted = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id), { method: "DELETE", headers: bearer });
        if (deleted.ok) await fetch(attempt, { method: "DELETE", headers: serviceHeaders });
        return json({ message: deleted.ok ? "Outlook n’a pas pu préparer le texte de la réponse." : "Vérifiez les Brouillons Outlook avant de réessayer.", uncertain: !deleted.ok }, 502);
      }
      const sent = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id) + "/send", {
        method: "POST", headers: bearer, signal: AbortSignal.timeout(20000)
      });
      if (!sent.ok) {
        const deleted = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id), { method: "DELETE", headers: bearer });
        if (deleted.ok) await fetch(attempt, { method: "DELETE", headers: serviceHeaders });
        return json({ message: deleted.ok ? "Outlook n’a pas envoyé la réponse. Vous pouvez réessayer." :
          "Résultat incertain. Vérifiez les éléments Envoyés et Brouillons Outlook avant de réessayer.", uncertain: !deleted.ok }, 502);
      }
      const tracked = await fetch(root + "/rest/v1/rpc/confirm_web_gmail_thread_send", {
        method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ p_user_id: id, p_request_id: requestId, p_previous_reminder: null })
      }).then(async response => response.ok && (await response.json()) === true).catch(() => false);
      return json({ sent: true, tracked });
    }

    if (body?.action === "send_followup") {
      if (!clientId || !clientSecret) return json({ message: "La connexion Outlook web attend la configuration Microsoft." }, 503);
      const { applicationId, recipient, requestId, message } = body;
      if (typeof applicationId !== "string" || !/^[0-9a-f-]{36}$/i.test(applicationId) ||
          typeof recipient !== "string" || !emailPattern.test(recipient) ||
          typeof requestId !== "string" || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i.test(requestId) ||
          typeof message !== "string" || !message.trim() || message.length > 12000) return json({ message: "Vérifiez le dossier et le texte de la relance." }, 400);
      const [deliveryResponse, connectionResponse, applicationResponse] = await Promise.all([
        fetch(root + "/rest/v1/web_gmail_deliveries" + filter + "&application_id=eq." + encodeURIComponent(applicationId) +
          "&provider=eq.outlook&select=message_id", { headers: serviceHeaders }),
        fetch(endpoint + filter + "&select=refresh_token", { headers: serviceHeaders }),
        fetch(root + "/rest/v1/user_applications" + filter + "&id=eq." + encodeURIComponent(applicationId) +
          "&status=in.(sent,reply_received)&hidden_at=is.null&select=status,company_email,last_inbound_at,last_human_reply_at,last_automatic_reply_at,next_follow_up_at", { headers: serviceHeaders })
      ]);
      if (!deliveryResponse.ok || !connectionResponse.ok || !applicationResponse.ok) return json({ message: "Dossier Outlook indisponible." }, 503);
      const [delivery] = await deliveryResponse.json();
      const [connection] = await connectionResponse.json();
      const [application] = await applicationResponse.json();
      const eligible = application && !application.last_human_reply_at &&
        (application.last_inbound_at ? application.last_inbound_at === application.last_automatic_reply_at : application.status === "sent") &&
        application.company_email?.trim().toLowerCase() === recipient.trim().toLowerCase();
      if (!delivery?.message_id || !connection || !eligible) return json({ message: "Ce dossier a changé ou reçu une réponse humaine. Actualisez le suivi avant la relance." }, 409);
      const refreshed = await fetch(authority + "/token", {
        method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ client_id: clientId, client_secret: clientSecret, grant_type: "refresh_token", refresh_token: connection.refresh_token,
          scope: scopes.join(" ") })
      });
      const token = await refreshed.json().catch(() => null);
      if (!refreshed.ok || !token?.access_token) return json({ message: "Reconnectez Outlook dans les paramètres." }, 409);
      await saveRotatedRefreshToken(root, serviceKey, id, token.refresh_token);
      const bearer = { Authorization: "Bearer " + token.access_token, Prefer: 'IdType="ImmutableId"' };
      const originalResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(delivery.message_id) +
        "?$select=id,conversationId,sentDateTime,toRecipients,from", { headers: bearer });
      if (!originalResponse.ok) return json({ message: "Impossible de retrouver ce fil Outlook." }, 502);
      const original = await originalResponse.json();
      const to = (original.toRecipients || []).map((entry: any) => String(entry.emailAddress?.address || "").toLowerCase());
      if (!to.includes(recipient.trim().toLowerCase())) return json({ message: "Le destinataire ne correspond plus au fil Outlook." }, 409);
      const query = new URLSearchParams({ "$filter": "conversationId eq '" + String(original.conversationId).replace(/'/g, "''") + "'",
        "$select": "id,receivedDateTime,sentDateTime,isDraft,from,internetMessageHeaders", "$top": "100" });
      const threadResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages?" + query, { headers: bearer });
      if (!threadResponse.ok) return json({ message: "Impossible de vérifier les réponses Outlook." }, 502);
      const messages = (await threadResponse.json()).value || [];
      const originalTime = Date.parse(original.sentDateTime || "");
      if (!Number.isFinite(originalTime)) return json({ message: "Date du message Outlook invalide." }, 502);
      const ownEmail = String(original.from?.emailAddress?.address || "").toLowerCase();
      const inbound = messages.filter((item: any) => item.id !== delivery.message_id && !item.isDraft &&
        String(item.from?.emailAddress?.address || "").toLowerCase() !== ownEmail &&
        Number.isFinite(Date.parse(item.receivedDateTime || "")) && Date.parse(item.receivedDateTime) > originalTime);
      if (inbound.some((item: any) => !isAutomaticReply(item.internetMessageHeaders || []))) {
        return json({ message: "Une réponse Outlook est arrivée. Ouvrez-la avant toute relance." }, 409);
      }
      const outbox = root + "/rest/v1/web_gmail_thread_sends";
      const attempt = outbox + filter + "&request_id=eq." + encodeURIComponent(requestId);
      const reservation = await fetch(outbox, { method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ user_id: id, request_id: requestId, application_id: applicationId, kind: "followup" }) });
      if (reservation.status === 409) {
        const previous = await fetch(attempt + "&select=confirmed_at,application_id,kind", { headers: serviceHeaders });
        const [row] = previous.ok ? await previous.json() : [];
        if (row?.confirmed_at && row.application_id === applicationId && row.kind === "followup") return json({ sent: true });
        return json({ message: "Cette relance a déjà été demandée. Vérifiez les éléments Envoyés dans Outlook.", uncertain: true }, 409);
      }
      if (!reservation.ok) return json({ message: "Impossible de réserver la relance Outlook." }, 503);
      const draftResponse = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(delivery.message_id) + "/createReply", {
        method: "POST", headers: { ...bearer, "Content-Type": "application/json" }, body: JSON.stringify({})
      });
      const draft = await draftResponse.json().catch(() => null);
      if (!draftResponse.ok || typeof draft?.id !== "string") {
        await fetch(attempt, { method: "DELETE", headers: serviceHeaders });
        return json({ message: "Outlook n’a pas pu préparer la relance." }, 502);
      }
      const patched = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id), {
        method: "PATCH", headers: { ...bearer, "Content-Type": "application/json" },
        body: JSON.stringify({ body: { contentType: "text", content: message.trim() } })
      });
      if (!patched.ok) {
        const deleted = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id), { method: "DELETE", headers: bearer });
        if (deleted.ok) await fetch(attempt, { method: "DELETE", headers: serviceHeaders });
        return json({ message: deleted.ok ? "Outlook n’a pas pu préparer le texte de la relance." : "Vérifiez les Brouillons Outlook avant de réessayer.", uncertain: !deleted.ok }, 502);
      }
      const sent = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id) + "/send", {
        method: "POST", headers: bearer, signal: AbortSignal.timeout(20000)
      });
      if (!sent.ok) {
        const deleted = await fetch("https://graph.microsoft.com/v1.0/me/messages/" + encodeURIComponent(draft.id), { method: "DELETE", headers: bearer });
        if (deleted.ok) await fetch(attempt, { method: "DELETE", headers: serviceHeaders });
        return json({ message: deleted.ok ? "Outlook n’a pas envoyé la relance. Vous pouvez réessayer." :
          "Résultat incertain. Vérifiez les éléments Envoyés et Brouillons Outlook.", uncertain: !deleted.ok }, 502);
      }
      const tracked = await fetch(root + "/rest/v1/rpc/confirm_web_gmail_thread_send", {
        method: "POST", headers: { ...serviceHeaders, "Content-Type": "application/json" },
        body: JSON.stringify({ p_user_id: id, p_request_id: requestId, p_previous_reminder: application.next_follow_up_at || null })
      }).then(async response => response.ok && (await response.json()) === true).catch(() => false);
      return json({ sent: true, tracked });
    }
    return json({ message: "Requête Outlook invalide." }, 400);
  } catch {
    return json({ message: "Le service Outlook est temporairement indisponible." }, 503);
  }
});
