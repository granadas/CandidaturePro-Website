import "jsr:@supabase/functions-js/edge-runtime.d.ts";

// Retire the first manual-test endpoint. The maintained billing handler adds
// server-side admin gating and customer-portal support.
Deno.serve((req: Request) => {
  const headers = {
    "Access-Control-Allow-Origin": "https://candidaturepro.ch",
    "Access-Control-Allow-Headers": "authorization, apikey, content-type, x-client-info",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Content-Type": "application/json"
  };
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers });
  return new Response(JSON.stringify({ error: "Cette ancienne route de test est désactivée. Utilisez le menu Premium du site." }), { status: 410, headers });
});
