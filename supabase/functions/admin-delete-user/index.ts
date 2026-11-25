import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const headers = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (message: string, status: number) =>
  new Response(JSON.stringify({ message }), { status, headers });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers });
  if (request.method !== "POST") return reply("Méthode non autorisée.", 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return reply("Service indisponible.", 503);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply("Connectez-vous.", 401);
  let body: { user_id?: unknown; email?: unknown; confirmation?: unknown };
  try { body = await request.json(); } catch { return reply("Requête invalide.", 400); }
  if (body?.confirmation !== "SUPPRIMER" || typeof body.user_id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,36}$/i.test(body.user_id) || typeof body.email !== "string")
    return reply("Confirmation invalide.", 400);
  const adminResponse = await fetch(url + "/auth/v1/user", {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!adminResponse.ok) return reply("Session expirée.", 401);
  const admin = await adminResponse.json().catch(() => null);
  if (!admin?.id || admin.id === body.user_id) return reply("Impossible de supprimer ce compte.", 403);
  const profileResponse = await fetch(url + "/rest/v1/profiles?id=eq." + encodeURIComponent(admin.id) + "&select=is_admin", {
    headers: { Authorization: "Bearer " + serviceKey, apikey: serviceKey },
  });
  const profiles = profileResponse.ok ? await profileResponse.json().catch(() => []) : [];
  if (profiles?.[0]?.is_admin !== true) return reply("Accès administrateur requis.", 403);
  const targetResponse = await fetch(url + "/auth/v1/admin/users/" + encodeURIComponent(body.user_id), {
    headers: { Authorization: "Bearer " + serviceKey, apikey: serviceKey },
  });
  const target = targetResponse.ok ? await targetResponse.json().catch(() => null) : null;
  if (!target?.id || String(target.email || "").toLowerCase() !== body.email.trim().toLowerCase())
    return reply("Le compte ou l’e-mail ne correspond plus. Actualisez la liste.", 409);
  const targetProfileResponse = await fetch(url + "/rest/v1/profiles?id=eq." + encodeURIComponent(body.user_id) + "&select=is_admin", {
    headers: { Authorization: "Bearer " + serviceKey, apikey: serviceKey },
  });
  const targetProfiles = targetProfileResponse.ok ? await targetProfileResponse.json().catch(() => []) : [];
  if (targetProfiles?.[0]?.is_admin === true)
    return reply("La suppression d’un compte administrateur est bloquée.", 403);
  const deleted = await fetch(url + "/auth/v1/admin/users/" + encodeURIComponent(body.user_id), {
    method: "DELETE", headers: { Authorization: "Bearer " + serviceKey, apikey: serviceKey },
  });
  if (!deleted.ok) {
    console.error("Admin account deletion failed", deleted.status);
    return reply("La suppression n’a pas abouti.", 500);
  }
  const audit = await fetch(url + "/rest/v1/admin_audit_log", {
    method: "POST",
    headers: {
      Authorization: "Bearer " + serviceKey,
      apikey: serviceKey,
      "Content-Type": "application/json",
      Prefer: "return=minimal",
    },
    body: JSON.stringify({
      action: "account_deleted",
      entity_type: "user",
      entity_key: body.user_id,
      summary: "Compte utilisateur supprimé par un administrateur.",
      old_values: { email: target.email },
      actor_id: admin.id,
    }),
  });
  if (!audit.ok) console.error("Admin account deletion audit failed", audit.status);
  return new Response(JSON.stringify({ deleted: true }), { headers });
});
