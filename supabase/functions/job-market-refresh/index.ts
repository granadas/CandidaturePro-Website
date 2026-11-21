const sectors = [
  "Hôtellerie", "Restauration", "Logistique / Transport", "Industrie / Production",
  "Construction / Bâtiment", "Nettoyage / Entretien", "Commerce / Vente",
  "Administration / Bureau", "Santé", "Sécurité", "Informatique / Technologie",
  "Automobile", "Banque / Assurance", "Immobilier", "Coiffure / Beauté",
  "Éducation / Formation", "Crèches / Petite enfance", "Agences d’intérim / Recrutement"
];

function jobLocation(text: string, fallback: string) {
  const cities = ["Genève", "Lausanne", "Nyon", "Morges", "Montreux", "Vevey", "Fribourg", "Neuchâtel", "Sion", "Martigny", "Delémont", "Berne", "Bâle", "Zurich", "Lugano"];
  const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
  return cities.find(city => normalized.includes(city.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase())) ?? fallback;
}

function jobIdentity(title: string) {
  const marker = " poste chez ";
  const index = title.toLowerCase().indexOf(marker);
  if (index < 0) return { title, company: "" };
  const jobTitle = title.slice(0, index).trim();
  const company = title.slice(index + marker.length).replace(/\s+-\s+[^-]+$/, "").trim();
  return { title: jobTitle, company };
}

Deno.serve(async (req: Request) => {
  const origin = req.headers.get("Origin");
  const responseHeaders = new Headers({ "Content-Type": "application/json", "Vary": "Origin" });
  const json = (data: unknown, status = 200) => new Response(JSON.stringify(data), { status, headers: responseHeaders });
  if (origin) {
    if (!["https://candidaturepro.ch", "https://feature-web-app-foundation.candidaturepro.pages.dev"].includes(origin)) {
      return json({ message: "Origine non autorisée." }, 403);
    }
    responseHeaders.set("Access-Control-Allow-Origin", origin);
    responseHeaders.set("Access-Control-Allow-Methods", "POST, OPTIONS");
    responseHeaders.set("Access-Control-Allow-Headers", "authorization, apikey, content-type");
  }
  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: responseHeaders });
  if (req.method !== "POST") return json({ message: "Méthode non autorisée." }, 405);

  const url = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
  const publicKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";
  const serperKey = Deno.env.get("WEB_SEARCH_KEY") ?? "";
  const cronSecret = Deno.env.get("JOB_MARKET_CRON_SECRET") ?? "";
  const suppliedSecret = req.headers.get("x-job-market-secret") ?? "";
  const authorization = req.headers.get("Authorization") ?? "";
  let requestedCity = "Genève";
  let requestedRadius = "30 km";
  let requestedQuery = "";
  try {
    const payload = await req.json();
    requestedCity = String(payload?.city ?? "Genève").trim() || "Genève";
    requestedRadius = String(payload?.radius ?? "30 km").trim() || "30 km";
    requestedQuery = String(payload?.query ?? "").trim();
  } catch { /* Le cron hebdomadaire utilise les valeurs par défaut. */ }

  let caller = "cron";
  if (!cronSecret || suppliedSecret !== cronSecret) {
    caller = "admin";
    if (!authorization.startsWith("Bearer "))
      return json({ message: "Connexion administrateur requise." }, 401);

    const userResponse = await fetch(`${url}/auth/v1/user`, {
      headers: { Authorization: authorization, apikey: publicKey }
    });
    if (!userResponse.ok) return json({ message: "Session expirée. Reconnectez-vous." }, 401);
    const user = await userResponse.json();
    if (!user?.id) return json({ message: "Utilisateur introuvable." }, 401);

    const adminResponse = await fetch(
      `${url}/rest/v1/profiles?id=eq.${encodeURIComponent(user.id)}&select=is_admin`,
      { headers: { apikey: serviceKey, Authorization: `Bearer ${serviceKey}` } }
    );
    const profiles = adminResponse.ok ? await adminResponse.json() : [];
    if (profiles.length !== 1 || profiles[0]?.is_admin !== true)
      return json({ message: "Accès administrateur requis." }, 403);
  }

  if (!url || !serviceKey || !serperKey)
    return json({ message: "Configuration serveur incomplète." }, 500);

  const headers = {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    "Content-Type": "application/json"
  };
  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  const usageResponse = await fetch(
    `${url}/rest/v1/job_market_refresh_runs?started_at=gte.${encodeURIComponent(month.toISOString())}&select=credits_used`,
    { headers }
  );
  if (!usageResponse.ok) return json({ message: "Impossible de vérifier le plafond mensuel." }, 500);
  const usageRows = await usageResponse.json();
  const used = usageRows.reduce((sum: number, row: { credits_used?: number }) => sum + (row.credits_used ?? 0), 0);
  const allowed = Math.max(0, 100 - used);
  if (allowed === 0)
    return json({ status: "blocked", credits: 0, added: 0, monthCredits: used, message: "Plafond mensuel de 100 crédits atteint." });

  const runResponse = await fetch(`${url}/rest/v1/job_market_refresh_runs`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      status: "running", credits_used: 0,
      message: `${caller === "admin" ? "Actualisation manuelle Admin" : "Actualisation hebdomadaire"} • ${requestedCity} • ${requestedRadius}`
    })
  });
  if (runResponse.status === 409) return json({ status: "busy", credits: 0, added: 0, monthCredits: used, message: "Une actualisation est déjà en cours. Réessayez après sa fin." }, 409);
  if (!runResponse.ok) return json({ message: "Impossible de démarrer l’actualisation." }, 500);
  const run = (await runResponse.json())[0];

  let credits = 0;
  let added = 0;
  let found = 0;
  try {
    for (const sector of sectors) {
      if (credits >= allowed) break;
      const searchResponse = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: { "X-API-KEY": serperKey, "Content-Type": "application/json" },
        body: JSON.stringify({
          q: `${requestedQuery ? requestedQuery + " " : ""}${sector} emploi "${requestedCity}" Suisse site:jobscout24.ch/fr/job/`,
          gl: "ch", hl: "fr", location: `${requestedCity}, Switzerland`, num: 10
        })
      });
      if (!searchResponse.ok) throw new Error(`Serper HTTP ${searchResponse.status}`);
      const data = await searchResponse.json();
      credits++;
      const offers = (data.organic ?? [])
        .filter((item: { link?: string; title?: string }) =>
          item.link && item.title && /^https:\/\/(www\.)?jobscout24\.ch\/fr\/job\/[0-9a-f-]+\/?(?:\?.*)?$/i.test(item.link))
        .map((item: { title: string; link: string; snippet?: string }) => {
          const identity = jobIdentity(item.title);
          const snippet = item.snippet ?? "";
          return {
          title: identity.title,
          company_name: identity.company,
          location: jobLocation(`${item.title} ${snippet}`, requestedCity),
          sector,
          source: "JobScout24",
          url: item.link,
          snippet,
          updated_at: new Date().toISOString(),
          active: true
        }});

      if (offers.length > 0) {
        found += offers.length;
        // Count only URLs that were not already stored, not all upserted search results.
        const uniqueUrls: string[] = [...new Set<string>(offers.map((offer: { url: string }) => offer.url))];
        const existingResponse = await fetch(
          `${url}/rest/v1/job_market_offers?select=url&url=in.(${uniqueUrls.map((value: string) => `"${encodeURIComponent(value)}"`).join(",")})`,
          { headers }
        );
        if (!existingResponse.ok) throw new Error(`Vérification des doublons HTTP ${existingResponse.status}`);
        const existingUrls = new Set((await existingResponse.json()).map((row: { url: string }) => row.url));
        const newOfferCount = uniqueUrls.filter((value: string) => !existingUrls.has(value)).length;
        const storeResponse = await fetch(`${url}/rest/v1/job_market_offers?on_conflict=url`, {
          method: "POST",
          headers: { ...headers, Prefer: "resolution=merge-duplicates" },
          body: JSON.stringify(offers)
        });
        if (!storeResponse.ok) throw new Error(`Enregistrement HTTP ${storeResponse.status}`);
        added += newOfferCount;
      }
    }

    if (found === 0) {
      const emptyResultResponse = await fetch(`${url}/rest/v1/job_market_refresh_runs?id=eq.${run.id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({
          status: "failed", completed_at: new Date().toISOString(), credits_used: credits,
          offers_added: 0, message: `Aucune annonce directe trouvée pour ${requestedCity} (${requestedRadius})`
        })
      });
      if (!emptyResultResponse.ok) throw new Error(`Enregistrement de l’échec HTTP ${emptyResultResponse.status}`);
      return json({
        status: "failed", credits, added: 0, monthCredits: used + credits,
        message: `Aucune annonce directe trouvée pour ${requestedCity}. La base existante n’a pas été remplacée.`
      }, 422);
    }
    if (found > 0) {
      await fetch(`${url}/rest/v1/job_market_offers?source=eq.Recherche%20web`, {
        method: "PATCH", headers,
        body: JSON.stringify({ active: false, updated_at: new Date().toISOString() })
      });
    }
    const completionResponse = await fetch(`${url}/rest/v1/job_market_refresh_runs?id=eq.${run.id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ status: "completed", completed_at: new Date().toISOString(), credits_used: credits, offers_added: added, message: "Actualisation terminée" })
    });
    if (!completionResponse.ok) throw new Error(`Enregistrement de fin d’actualisation HTTP ${completionResponse.status}`);
    const countResponse = await fetch(`${url}/rest/v1/job_market_offers?active=eq.true&select=id`, {
      method: "HEAD", headers: { ...headers, Prefer: "count=exact" }
    });
    const range = countResponse.headers.get("content-range") ?? "*/0";
    const totalOffers = Number(range.split("/")[1] ?? 0);
    return json({ status: "completed", credits, added, totalOffers, monthCredits: used + credits, message: "Actualisation terminée avec succès." });
  } catch (error) {
    await fetch(`${url}/rest/v1/job_market_refresh_runs?id=eq.${run.id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ status: "failed", completed_at: new Date().toISOString(), credits_used: credits, offers_added: added, message: String(error) })
    });
    return json({ status: "failed", credits, added, message: "L’actualisation a échoué. Aucun nouvel appel ne sera relancé automatiquement." }, 500);
  }
});
