import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Content-Type": "application/json; charset=utf-8",
};
const reply = (message: string, status: number) => new Response(JSON.stringify({ message }), { status, headers: cors });

Deno.serve(async (request: Request) => {
  if (request.method === "OPTIONS") return new Response(null, { status: 204, headers: cors });
  if (request.method !== "POST") return reply("Méthode non autorisée.", 405);
  const url = Deno.env.get("SUPABASE_URL");
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY");
  if (!url || !serviceKey || !anonKey) return reply("Service indisponible.", 503);
  const authorization = request.headers.get("authorization") || "";
  if (!/^Bearer\s+\S+$/i.test(authorization)) return reply("Connectez-vous pour continuer.", 401);
  let body: { confirmation?: unknown } = {};
  try { body = await request.json(); } catch { return reply("Requête invalide.", 400); }
  if (body.confirmation !== "SUPPRIMER") return reply("Confirmez la suppression en saisissant SUPPRIMER.", 400);
  const userResponse = await fetch(url + "/auth/v1/user", {
    headers: { Authorization: authorization, apikey: anonKey },
  });
  if (!userResponse.ok) return reply("Votre session a expiré. Reconnectez-vous.", 401);
  const user = await userResponse.json().catch(() => null);
  if (!user?.id || typeof user.id !== "string") return reply("Compte introuvable.", 401);
  // The authenticated token is the only source of the user ID. Never accept an arbitrary ID from the caller.
  const deleteResponse = await fetch(url + "/auth/v1/admin/users/" + encodeURIComponent(user.id), {
    method: "DELETE",
    headers: { Authorization: "Bearer " + serviceKey, apikey: serviceKey },
  });
  if (!deleteResponse.ok) {
    console.error("Account deletion failed", deleteResponse.status);
    return reply("La suppression n'a pas abouti. Réessayez ou contactez le support.", 500);
  }
  return new Response(JSON.stringify({ deleted: true }), { status: 200, headers: cors });
});
