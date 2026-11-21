const sectors = [
  "Hôtellerie", "Restauration", "Logistique / Transport", "Industrie / Production",
  "Construction / Bâtiment", "Nettoyage / Entretien", "Commerce / Vente",
  "Administration / Bureau", "Santé", "Sécurité", "Informatique / Technologie",
  "Automobile", "Banque / Assurance", "Immobilier", "Coiffure / Beauté",
  "Éducation / Formation", "Crèches / Petite enfance", "Agences d’intérim / Recrutement"
];

function jobLocation(title: string, snippet: string) {
  const cities = ["Genève", "Lausanne", "Nyon", "Morges", "Montreux", "Vevey", "Fribourg", "Neuchâtel", "Sion", "Martigny", "Delémont", "Berne", "Bâle", "Zurich", "Lugano"];
  const findCity = (text: string) => {
    const normalized = text.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
    return cities.find(city => {
      const name = city.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
      return new RegExp(`(^|[^a-z])${name}($|[^a-z])`).test(normalized);
    });
  };
  // A JobScout24 "chez ... - lieu sur JobScout24" caption states the actual workplace.
  // Do not infer a city from an unrelated mention elsewhere in the snippet.
  const captionPlace = snippet.match(/\bchez\s+.+?\s+-\s+([^–.]+?)\s+sur\s+JobScout24\b/i)?.[1];
  if (captionPlace) return findCity(captionPlace) ?? "À vérifier";
  const inTitle = findCity(title);
  if (inTitle) return inTitle;
  if (/Postes et offres d'emploi en Suisse|Emplois similaires|Sur JobScout24, vous trouverez de nombreuses offres/i.test(snippet)) return "À vérifier";
  return findCity(snippet) ?? "À vérifier";
}

function jobIdentity(title: string, snippet: string) {
  const marker = " poste chez ";
  const index = title.toLowerCase().indexOf(marker);
  const jobTitle = index < 0 ? title : title.slice(0, index).trim();
  const company = index < 0 ? "" : title.slice(index + marker.length).replace(/\s+-\s+[^-]+$/, "").trim();
  const captionCompany = snippet.match(/\bchez\s+(.+?)\s+-\s+.+?\s+sur\s+JobScout24\b/i)?.[1]?.trim() ?? "";
  return { title: jobTitle, company: company || captionCompany.slice(0, 120) };
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
  let requestedQuery = "";
  try {
    const payload = await req.json();
    requestedCity = String(payload?.city ?? "Genève").trim() || "Genève";
    requestedQuery = String(payload?.query ?? "").trim();
  } catch { /* Le cron hebdomadaire utilise les valeurs par défaut. */ }

  // Validate server-side: direct API callers bypass the browser's input limits.
  // Reject invalid requests before creating a run or spending Serper credits.
  if (requestedCity.length > 120 || requestedQuery.length > 120 ||
      /[\\r\\n\\x00-\\x1f\\x7f]/.test(requestedCity + requestedQuery) ||
      !/^[\\p{L}\\p{M}0-9 .,'’()/-]+$/u.test(requestedCity)) {
    return json({ message: "Ville ou recherche invalide (120 caractères maximum)." }, 400);
  }

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
  // A terminated Edge invocation can leave a running row behind. After two
  // hours it is no longer an active refresh; preserve its credit checkpoints.
  const staleBefore = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString();
  const staleResponse = await fetch(
    `${url}/rest/v1/job_market_refresh_runs?status=eq.running&started_at=lt.${encodeURIComponent(staleBefore)}`,
    {
      method: "PATCH", headers,
      body: JSON.stringify({
        status: "failed", completed_at: new Date().toISOString(),
        message: "Actualisation interrompue (délai de sécurité dépassé)"
      })
    }
  );
  if (!staleResponse.ok)
    return json({ message: "Impossible de vérifier les actualisations interrompues." }, 500);

  const month = new Date();
  month.setUTCDate(1);
  month.setUTCHours(0, 0, 0, 0);
  const usageResponse = await fetch(
    `${url}/rest/v1/job_market_refresh_runs?started_at=gte.${encodeURIComponent(month.toISOString())}&select=credits_used`,
    { headers }
  );
  if (!usageResponse.ok) return json({ message: "Impossible de vérifier le plafond mensuel." }, 500);
  let usageRows: unknown;
  try {
    usageRows = await usageResponse.json();
  } catch {
    return json({ message: "Réponse invalide du suivi des crédits. Actualisation bloquée." }, 500);
  }
  if (!Array.isArray(usageRows) || usageRows.some((row: { credits_used?: unknown } | null) =>
    !row || !Number.isSafeInteger(row.credits_used) || Number(row.credits_used) < 0))
    return json({ message: "Comptabilité des crédits invalide. Actualisation bloquée." }, 500);
  const used = usageRows.reduce((sum: number, row: { credits_used: number }) => sum + row.credits_used, 0);
  if (!Number.isSafeInteger(used))
    return json({ message: "Total des crédits invalide. Actualisation bloquée." }, 500);
  const allowed = Math.max(0, 100 - used);
  if (allowed === 0)
    return json({ status: "blocked", credits: 0, added: 0, monthCredits: used, message: "Plafond mensuel de 100 crédits atteint." });

  const runResponse = await fetch(`${url}/rest/v1/job_market_refresh_runs`, {
    method: "POST",
    headers: { ...headers, Prefer: "return=representation" },
    body: JSON.stringify({
      status: "running", credits_used: 0,
      message: `${caller === "admin" ? "Actualisation manuelle Admin" : "Actualisation hebdomadaire"} • ${requestedCity}`
    })
  });
  if (runResponse.status === 409) return json({ status: "busy", credits: 0, added: 0, monthCredits: used, message: "Une actualisation est déjà en cours. Réessayez après sa fin." }, 409);
  if (!runResponse.ok) return json({ message: "Impossible de démarrer l’actualisation." }, 500);
  let createdRuns: unknown;
  try {
    createdRuns = await runResponse.json();
  } catch {
    return json({ message: "Réponse invalide du suivi d’actualisation. Aucun crédit consommé." }, 500);
  }
  if (!Array.isArray(createdRuns) || createdRuns.length !== 1 ||
      typeof createdRuns[0]?.id !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f-]{27,}$/i.test(createdRuns[0].id)) {
    return json({ message: "Identifiant d’actualisation invalide. Aucun appel Serper effectué." }, 500);
  }
  const run = createdRuns[0];

  let credits = 0;
  let added = 0;
  let found = 0;
  try {
    for (const sector of sectors) {
      if (credits >= allowed) break;
      // Reserve and persist a credit before each provider request. If the Edge
      // process stops after dispatch, the monthly cap still counts that attempt.
      credits++;
      const creditCheckpoint = await fetch(`${url}/rest/v1/job_market_refresh_runs?id=eq.${run.id}`, {
        method: "PATCH", headers,
        body: JSON.stringify({ credits_used: credits })
      });
      if (!creditCheckpoint.ok) throw new Error(`Enregistrement du crédit HTTP ${creditCheckpoint.status}`);
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
      const offers = (data.organic ?? [])
        .filter((item: { link?: string; title?: string; snippet?: string }) =>
          item.link && item.title && /^https:\/\/(www\.)?jobscout24\.ch\/fr\/job\/[0-9a-f-]+\/?(?:\?.*)?$/i.test(item.link) &&
          !/Postes et offres d'emploi en Suisse|Sur JobScout24, vous trouverez de nombreuses offres|Emplois similaires/i.test(item.snippet ?? ""))
        .map((item: { title: string; link: string; snippet?: string }) => {
          const identity = jobIdentity(item.title, item.snippet ?? "");
          const snippet = item.snippet ?? "";
          return {
          title: identity.title,
          company_name: identity.company,
          location: jobLocation(item.title, snippet),
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
          offers_added: 0, message: `Aucune annonce directe trouvée pour ${requestedCity}`
        })
      });
      if (!emptyResultResponse.ok) throw new Error(`Enregistrement de l’échec HTTP ${emptyResultResponse.status}`);
      return json({
        status: "failed", credits, added: 0, monthCredits: used + credits,
        message: `Aucune annonce directe trouvée pour ${requestedCity}. La base existante n’a pas été remplacée.`
      }, 422);
    }
    if (found > 0) {
      const legacyDeactivationResponse = await fetch(`${url}/rest/v1/job_market_offers?source=eq.Recherche%20web`, {
        method: "PATCH", headers,
        body: JSON.stringify({ active: false, updated_at: new Date().toISOString() })
      });
      if (!legacyDeactivationResponse.ok)
        throw new Error(`Désactivation des anciennes annonces HTTP ${legacyDeactivationResponse.status}`);
    }
    const completionResponse = await fetch(`${url}/rest/v1/job_market_refresh_runs?id=eq.${run.id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ status: "completed", completed_at: new Date().toISOString(), credits_used: credits, offers_added: added, message: "Actualisation terminée" })
    });
    if (!completionResponse.ok) throw new Error(`Enregistrement de fin d’actualisation HTTP ${completionResponse.status}`);
    // Counting is informational: a failed HEAD must not turn a completed
    // refresh into a failed one or incorrectly report zero available offers.
    let totalOffers: number | null = null;
    try {
      const countResponse = await fetch(`${url}/rest/v1/job_market_offers?active=eq.true&select=id`, {
        method: "HEAD", headers: { ...headers, Prefer: "count=exact" }
      });
      const range = countResponse.ok ? countResponse.headers.get("content-range") : null;
      const count = range?.split("/")[1];
      if (count && /^\\d+$/.test(count) && Number.isSafeInteger(Number(count)))
        totalOffers = Number(count);
    } catch {
      // The refresh was already recorded as completed; count is unavailable.
    }
    return json({ status: "completed", credits, added, totalOffers, monthCredits: used + credits, message: "Actualisation terminée avec succès." });
  } catch (error) {
    await fetch(`${url}/rest/v1/job_market_refresh_runs?id=eq.${run.id}`, {
      method: "PATCH", headers,
      body: JSON.stringify({ status: "failed", completed_at: new Date().toISOString(), credits_used: credits, offers_added: added, message: String(error) })
    });
    return json({ status: "failed", credits, added, message: "L’actualisation a échoué. Aucun nouvel appel ne sera relancé automatiquement." }, 500);
  }
});
