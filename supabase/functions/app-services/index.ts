import "jsr:@supabase/functions-js/edge-runtime.d.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

const rejectHosts = [
  "linkedin.com", "facebook.com", "instagram.com", "x.com", "twitter.com",
  "youtube.com", "wikipedia.org", "local.ch", "search.ch", "indeed.",
  "glassdoor.", "jobs.ch", "jobup.", "yelp."
];

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return json({}, 200);

  try {
    const auth = req.headers.get("Authorization") ?? "";
    const authResult = await requireAuthenticatedUser(auth);

    if (!authResult.ok) return authResult.response;

    const locationKey = Deno.env.get("LOCATION_SEARCH_KEY") ?? "";
    const webKey = Deno.env.get("WEB_SEARCH_KEY") ?? "";

    const { action, payload } = await req.json();

    if (action === "company_search") {
      if (!locationKey) {
        return json({ message: "Service de recherche non configuré." }, 500);
      }

      // The monthly limit is enforced server-side. A modified browser or
      // desktop client cannot bypass it by calling this function directly.
      const quota = await consumeCompanySearchQuota(auth);
      if (!quota.allowed) {
        return json({
          message: quota.message || "Limite mensuelle de recherches atteinte.",
          quota
        }, 403);
      }

      const result = await companySearch(payload, locationKey, webKey, authResult.user.id);
      return json({ ...result, quota }, 200);
    }

    if (action === "job_search") {
      // La recherche de postes passe désormais par une navigation directe
      // gratuite dans l'application. Ne jamais appeler Serper pour cette action.
      return json({
        jobs: [],
        message: "Recherche directe gratuite disponible dans la dernière version de l’application."
      }, 200);
    }

    if (["official_website", "career_page", "identify_address", "discover_contact"].includes(action)) {
      if (!webKey) {
        return json({ message: "Service de recherche non configuré." }, 500);
      }

      return json(await webSearch(action, payload, webKey, authResult.user.id), 200);
    }

    return json({ message: "Action non prise en charge." }, 400);

  } catch (e) {
    console.error(e);
    const message = e instanceof Error && e.message.startsWith("job_search:")
      ? e.message.substring("job_search:".length)
      : "Service temporairement indisponible.";
    return json({ message }, 500);
  }
});

/* ============================================================
   NORMALISATION
   crèche = creche
   HÔTEL = hotel
   Intérim = interim
   ============================================================ */

function normalize(value: unknown): string {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .trim();
}

/* ============================================================
   PROFIL DE RECHERCHE
   ============================================================ */

function getSearchProfile(sectorRaw: string) {
  const s = normalize(sectorRaw);

  /*
    Une recherche « Tous les secteurs » envoie une valeur vide.
    Elle doit accepter tous les établissements nommés, au lieu de
    tomber dans le profil générique qui exige des mots-clés.
  */
  if (!s || /\b(tous les secteurs|all sectors)\b/.test(s)) {
    return {
      type: "all",
      categories: "commercial,catering,accommodation,office,healthcare,education,service",
      label: "Tous les secteurs",
      requiredCategories: [],
      keywords: []
    };
  }

  if (/\b(creche|creches|garderie|garderies|petite enfance|nursery|kindergarten|childcare)\b/.test(s)) {
    return {
      type: "childcare",
      categories: "childcare,childcare.kindergarten,building.kindergarten",
      label: "Crèche / Petite enfance",
      requiredCategories: ["childcare", "kindergarten"],
      keywords: [
        "creche", "garderie", "petite enfance",
        "nursery", "kindergarten", "childcare"
      ]
    };
  }

  if (/\b(interim|agence interim|temporaire|placement|recrutement|employment agency)\b/.test(s)) {
    return {
      type: "employment",
      categories: "office.employment_agency",
      label: "Agence d’intérim / Recrutement",
      requiredCategories: ["employment_agency"],
      keywords: [
        "interim", "recrutement", "placement",
        "emploi", "employment", "staffing", "temporaire"
      ]
    };
  }

  /*
    Transport et logistique doivent utiliser la catégorie Geoapify dédiée.
    office.company seul était trop générique et le filtre supprimait presque tout.
  */
  if (/\b(logistique|transport|transports|fret|freight|cargo|livraison|messagerie|demenagement|entrepot)\b/.test(s)) {
    return {
      type: "logistics",
      categories: "office.logistics",
      label: "Logistique / Transport",
      requiredCategories: ["office.logistics"],
      keywords: [
        "logistique", "logistics", "transport", "transports",
        "fret", "freight", "cargo", "livraison", "messagerie",
        "demenagement", "entrepot", "express"
      ]
    };
  }

  if (/\b(hotel|hotels|hotellerie|hostel|hebergement)\b/.test(s)) {
    return {
      type: "hotel",
      categories: "accommodation.hotel,accommodation.hostel",
      label: "Hôtellerie",
      requiredCategories: ["accommodation.hotel", "accommodation.hostel"],
      keywords: ["hotel", "hostel", "hebergement"]
    };
  }

  if (/\b(restaurant|restaurants|restauration|cafe|traiteur)\b/.test(s)) {
    return {
      type: "restaurant",
      categories: "catering.restaurant,catering.cafe",
      label: "Restauration",
      requiredCategories: ["catering.restaurant", "catering.cafe"],
      keywords: ["restaurant", "cafe", "traiteur"]
    };
  }

  if (/\b(garage|garages|automobile|carrosserie|concessionnaire)\b/.test(s)) {
    return {
      type: "vehicle",
      categories: "service.vehicle",
      label: "Automobile",
      requiredCategories: ["service.vehicle"],
      keywords: [
        "garage", "automobile", "auto",
        "carrosserie", "concession"
      ]
    };
  }

  if (/\b(pharmacie|pharmacies)\b/.test(s)) {
    return {
      type: "pharmacy",
      categories: "healthcare.pharmacy",
      label: "Pharmacie",
      requiredCategories: ["healthcare.pharmacy"],
      keywords: ["pharmacie", "pharmacy", "apotheke"]
    };
  }

  if (/\b(clinique|cliniques|medical|sante|soins|hopital|hospitals)\b/.test(s)) {
    return {
      type: "health",
      categories: "healthcare.hospital,healthcare.clinic_or_praxis",
      label: "Santé",
      requiredCategories: [
        "healthcare.hospital",
        "healthcare.clinic_or_praxis"
      ],
      keywords: [
        "clinique", "clinic", "hopital",
        "hospital", "medical", "sante"
      ]
    };
  }

  if (/\b(coiffure|coiffeur|coiffeuse|salon de coiffure)\b/.test(s)) {
    return {
      type: "hairdresser",
      categories: "commercial.health_and_beauty.hairdresser",
      label: "Coiffure",
      requiredCategories: ["hairdresser"],
      keywords: ["coiffure", "coiffeur", "hair", "salon"]
    };
  }

  if (/\b(ecole|ecoles|education|formation)\b/.test(s)) {
    return {
      type: "education",
      categories: "education.school",
      label: "Éducation / Formation",
      requiredCategories: ["education.school"],
      keywords: ["ecole", "school", "education", "formation"]
    };
  }

  if (/\b(immobilier|regie|agence immobiliere)\b/.test(s)) {
    return {
      type: "estate",
      categories: "office.estate_agent",
      label: "Immobilier",
      requiredCategories: ["estate_agent"],
      keywords: ["immobilier", "regie", "estate", "immobiliere"]
    };
  }

  if (/\b(assurance|assurances)\b/.test(s)) {
    return {
      type: "insurance",
      categories: "office.insurance",
      label: "Assurance",
      requiredCategories: ["insurance"],
      keywords: ["assurance", "insurance"]
    };
  }

  if (/\b(banque|banques|finance)\b/.test(s)) {
    return {
      type: "finance",
      categories: "office.financial",
      label: "Banque / Finance",
      requiredCategories: ["financial"],
      keywords: ["banque", "bank", "finance"]
    };
  }

  if (/\b(securite|surveillance|gardiennage)\b/.test(s)) {
    return {
      type: "security",
      categories: "office.security",
      label: "Sécurité",
      requiredCategories: ["security"],
      keywords: ["securite", "security", "surveillance", "gardiennage"]
    };
  }

  if (/\b(informatique|software|technologie)\b/.test(s)) {
    return {
      type: "it",
      categories: "office.it",
      label: "Informatique",
      requiredCategories: ["office.it"],
      keywords: ["informatique", "software", "technology"]
    };
  }

  /*
    Recherche non reconnue :
    on reste volontairement plus large.
  */
  return {
    type: "generic",
    categories: "office.company",
    label: sectorRaw || "Entreprise",
    requiredCategories: [],
    keywords: s
      .split(/\s+/)
      .filter((x) => x.length >= 3)
  };
}

/* ============================================================
   CONTRÔLE DE PERTINENCE
   ============================================================ */

function isRelevantPlace(
  properties: any,
  profile: ReturnType<typeof getSearchProfile>
): boolean {

  const categories: string[] = Array.isArray(properties?.categories)
    ? properties.categories.map((x: unknown) => normalize(x))
    : [];

  const categoryText = categories.join(" ");

  const name = normalize(properties?.name);
  const address = normalize(properties?.formatted);

  const text = `${name} ${address}`;

  /*
    Pour tous les secteurs connus, la catégorie Geoapify
    constitue le contrôle principal.

    Exemple :
    recherche "creches"
    Otis -> catégories sans childcare -> REJETÉ.
  */
  /*
    Pour « Tous les secteurs », les catégories ont déjà limité la
    réponse Geoapify : on conserve donc tout établissement nommé.
  */
  if (profile.type === "all") {
    return name.length > 0;
  }

  if (profile.type !== "generic") {

    const categoryMatch = profile.requiredCategories.some(
      (required) => categoryText.includes(normalize(required))
    );

    if (categoryMatch) {
      return true;
    }

    /*
      Secours uniquement lorsque le nom de l'établissement
      contient explicitement un mot très caractéristique.

      Exemple :
      "Les Petites Crèches de Genève".
    */
    const explicitNameMatch = profile.keywords.some((keyword) => {
      const k = normalize(keyword);

      if (k.length < 4) return false;

      return name.includes(k);
    });

    return explicitNameMatch;
  }

  /*
    Recherche libre :
    on demande au minimum une correspondance textuelle.
  */
  if (!profile.keywords.length) return false;

  return profile.keywords.some((keyword) => {
    const k = normalize(keyword);

    if (k.length < 3) return false;

    return text.includes(k) || categoryText.includes(k);
  });
}

/* ============================================================
   RECHERCHE ENTREPRISES
   ============================================================ */

async function companySearch(p: any, key: string, webKey: string, userId: string) {

  const city = String(p?.city || "").trim();
  const sector = String(p?.sector || "").trim();

  const radiusKm = Math.max(
    1,
    Math.min(100, parseInt(String(p?.radius || "30")) || 30)
  );

  if (!city) {
    return { companies: [] };
  }

  const profile = getSearchProfile(sector);

  const geo = await fetch(
    `https://api.geoapify.com/v1/geocode/search?text=${encodeURIComponent(city)}` +
    `&format=json&type=city&limit=1&lang=fr` +
    `&apiKey=${encodeURIComponent(key)}`
  );

  if (!geo.ok) throw new Error("geocode");

  // Geoapify bills this successful geocoding request. The ledger is written
  // server-side with the authenticated user id, never supplied by the app.
  await recordProviderCreditUsage(userId, "geoapify", "geocoding");

  const gd = await geo.json();

  if (!gd?.results?.length) {
    return { companies: [] };
  }

  const { lat, lon } = gd.results[0];

  const url =
    `https://api.geoapify.com/v2/places` +
    `?categories=${encodeURIComponent(profile.categories)}` +
    `&filter=${encodeURIComponent(
      `circle:${lon},${lat},${radiusKm * 1000}`
    )}` +
    `&bias=${encodeURIComponent(`proximity:${lon},${lat}`)}` +
    `&limit=100&lang=fr` +
    `&apiKey=${encodeURIComponent(key)}`;

  const r = await fetch(url);

  if (!r.ok) {
    console.error("Geoapify places error", r.status, await r.text());
    throw new Error("places");
  }

  // One Places API request is also a provider credit.
  await recordProviderCreditUsage(userId, "geoapify", "places_search");

  const data = await r.json();

  let id = 200000;

  const seen = new Set<string>();
  const companies: any[] = [];

  for (const f of data?.features || []) {

    const x = f?.properties || {};

    /*
      NOUVEAU :
      contrôle individuel AVANT ajout à la liste.
    */
    if (!isRelevantPlace(x, profile)) {
      continue;
    }

    const name = String(
      x.name ||
      x.address_line1 ||
      ""
    ).trim();

    const address = String(x.formatted || "");

    if (!name) continue;

    const uniqueKey =
      `${normalize(name)}|${normalize(address)}`;

    if (seen.has(uniqueKey)) continue;

    seen.add(uniqueKey);

    companies.push({
      id: id++,
      name,
      city: String(
        x.city ||
        x.municipality ||
        city
      ),
      sector: profile.label,
      website: String(x.website || ""),
      phone: String(
        x["contact:phone"] ||
        x.phone ||
        ""
      ),
      address,
      countryCode: String(x.country_code || x.country || "").toUpperCase()
    });
  }

  /*
    Geoapify/OpenStreetMap ne référence pas toujours toutes les entreprises
    logistiques. Compléter d'abord avec la recherche locale Serper Places,
    conçue pour les établissements autour d'une ville, puis avec les résultats
    Web officiels. Chaque résultat est dédupliqué avant retour au client.
  */
  if (profile.type === "logistics" && webKey) {
    const blockedHosts = [
      "google.", "linkedin.", "facebook.", "instagram.",
      "local.ch", "search.ch", "jobs.ch", "jobup.ch",
      "indeed.", "yellowpages.", "wikipedia."
    ];

    const addCompany = (candidate: any) => {
      const name = String(candidate?.name || "").trim();
      const website = String(candidate?.website || "").trim();
      const address = String(candidate?.address || "").trim();
      if (!name) return;

      let host = "";
      try { host = website ? new URL(website).hostname.toLowerCase().replace(/^www\./, "") : ""; } catch {}
      if (host && blockedHosts.some((blocked) => host.includes(blocked))) return;

      const duplicate = companies.some((company) => {
        let existingHost = "";
        try {
          existingHost = new URL(String(company.website || "")).hostname
            .toLowerCase().replace(/^www\./, "");
        } catch {}
        return (host && existingHost && existingHost === host) ||
          normalize(company.name) === normalize(name);
      });
      if (duplicate) return;

      companies.push({
        id: id++,
        name,
        city: String(candidate?.city || city),
        sector: profile.label,
        website,
        phone: String(candidate?.phone || ""),
        address,
        countryCode: "CH"
      });
    };

    const localQueries = [
      `transport logistique ${city}`,
      "transport logistique Meyrin",
      "transport logistique Vernier",
      "transport logistique Satigny",
      "transport logistique Plan-les-Ouates",
      "transitaire fret cargo aéroport Genève",
      "livraison messagerie Genève",
      "déménagement garde-meubles Genève",
      "transporteur marchandises Genève",
      "transport international Genève",
      "stockage entreposage Genève",
      "courrier express Genève",
      "transport logistique Carouge",
      "transport logistique Lancy",
      "transport logistique Onex",
      "transport logistique Grand-Saconnex"
    ];

    const localResponses = await Promise.all(
      localQueries.map(async (query) => {
        try {
          const response = await fetch("https://google.serper.dev/places", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-API-KEY": webKey
            },
            body: JSON.stringify({
              q: query,
              location: `${city}, Switzerland`,
              gl: "ch",
              hl: "fr"
            })
          });

          if (!response.ok) {
            console.error("Serper places error", query, response.status, await response.text());
            return [];
          }

          await recordProviderCreditUsage(userId, "serper", "company_search");
          const data = await response.json();
          return Array.isArray(data?.places) ? data.places : [];
        } catch (error) {
          console.error("Serper places failed", query, error);
          return [];
        }
      })
    );

    for (const place of localResponses.flat()) {
      const address = String(place?.address || "");
      if (/\bFrance\b/i.test(address)) continue;

      // When coordinates are supplied, enforce the radius selected in the app.
      const placeLat = Number(place?.latitude);
      const placeLon = Number(place?.longitude);
      if (Number.isFinite(placeLat) && Number.isFinite(placeLon)) {
        const toRad = (value: number) => value * Math.PI / 180;
        const dLat = toRad(placeLat - Number(lat));
        const dLon = toRad(placeLon - Number(lon));
        const a =
          Math.sin(dLat / 2) ** 2 +
          Math.cos(toRad(Number(lat))) * Math.cos(toRad(placeLat)) *
          Math.sin(dLon / 2) ** 2;
        const distanceKm = 6371 * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        if (distanceKm > radiusKm) continue;
      }

      addCompany({
        name: place?.title,
        website: place?.website,
        address,
        city,
        phone: place?.phoneNumber || place?.phone
      });
    }

    try {
      const webResponse = await fetch("https://google.serper.dev/search", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-API-KEY": webKey
        },
        body: JSON.stringify({
          q: `transport logistique déménagement ${city} Suisse -site:wikipedia.org -site:local.ch -site:search.ch -emploi -jobs`,
          gl: "ch",
          hl: "fr",
          num: 20
        })
      });

      if (webResponse.ok) {
        await recordProviderCreditUsage(userId, "serper", "company_search");
        const webData = await webResponse.json();
        for (const item of webData?.organic || []) {
          const title = String(item?.title || "").trim();
          const website = String(item?.link || "").trim();
          if (!title || !website) continue;
          addCompany({
            name: title.split(/\s+[|–—-]\s+/)[0].replace(/\s*(accueil|home)$/i, "").trim(),
            website,
            address: "",
            city,
            phone: ""
          });
        }
      } else {
        console.error("Serper web company search error", webResponse.status, await webResponse.text());
      }
    } catch (error) {
      console.error("Serper web company search failed", error);
    }
  }

  console.log(
    `Recherche="${sector}", profil="${profile.type}", ` +
    `reçus=${data?.features?.length || 0}, ` +
    `retenus=${companies.length}`
  );

  return { companies: companies.slice(0, 120) };
}

/* ============================================================
   RECHERCHE WEB
   ============================================================ */

async function webSearch(
  action: string,
  p: any,
  key: string,
  userId: string
) {

  const name = String(p?.name || "");
  const city = String(p?.city || "");
  const sector = String(p?.sector || "");
  const address = String(p?.address || "");

  let q = "";

  if (action === "official_website") {
    q = `"${name}" ${address} ${city} ${sector} site officiel`;
  }

  if (action === "career_page") {
    q = `"${name}" ${address} ${city} ${sector} careers jobs emploi recrutement contact`;
  }

  if (action === "identify_address") {
    q = `"${address || `${name} ${city}`}" entreprise société commerce`;
  }

  if (action === "discover_contact") {
    q = `"${name}" ${address} ${city} email contact recrutement RH`;
  }

  const r = await fetch(
    "https://google.serper.dev/search",
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-API-KEY": key
      },
      body: JSON.stringify({
        q,
        gl: "ch",
        hl: "fr",
        num: 10
      })
    }
  );

  if (!r.ok) throw new Error("websearch");

  // Serper charges per successful web-search request.
  await recordProviderCreditUsage(userId, "serper", action);

  const d = await r.json();

  if (action === "discover_contact") {
    const suppliedWebsite = String(p?.website || "");
    let suppliedHost = "";
    try { suppliedHost = new URL(suppliedWebsite).hostname.toLowerCase().replace(/^www\./, ""); } catch {}

    const emailPattern = /[a-z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)+/gi;
    const rejectedMailboxes = /^(?:noreply|no-reply|donotreply|do-not-reply|example|test)@/i;

    for (const item of d?.organic || []) {
      const link = String(item?.link || "");
      let u: URL;
      try { u = new URL(link); } catch { continue; }

      const sourceHost = u.hostname.toLowerCase().replace(/^www\./, "");
      if (rejectHosts.some((x) => sourceHost.includes(x))) continue;
      if (!isLikelySameEntity(item, { name, city, sector, address, website: suppliedWebsite })) continue;

      const companyDomainTokens = normalize(name)
        .split(/[^a-z0-9]+/)
        .filter((token) => token.length >= 4)
        .filter((token) => !["transport", "logistique", "service", "services", "societe", "groupe", "geneve", "suisse"].includes(token));
      const hostLooksOfficial =
        !!suppliedHost ||
        companyDomainTokens.some((token) => sourceHost.includes(token));
      if (!hostLooksOfficial) continue;

      const visibleText = `${item?.title || ""} ${item?.snippet || ""}`;
      const candidates = Array.from(new Set(visibleText.match(emailPattern) || []));
      const acceptedHost = suppliedHost || sourceHost;

      for (const rawEmail of candidates) {
        const email = String(rawEmail).replace(/[),.;:]+$/, "").toLowerCase();
        if (rejectedMailboxes.test(email)) continue;
        const mailDomain = email.split("@")[1] || "";
        const domainMatches =
          mailDomain === acceptedHost ||
          mailDomain.endsWith(`.${acceptedHost}`) ||
          acceptedHost.endsWith(`.${mailDomain}`);
        if (!domainMatches) continue;

        return {
          found: true,
          email,
          website: suppliedWebsite || `${u.protocol}//${u.host}`,
          sourceUrl: link,
          confidence: "Adresse visible dans un résultat public et domaine officiel correspondant.",
          message: "Contact public vérifié trouvé."
        };
      }
    }

    return {
      found: false,
      email: "",
      website: suppliedWebsite,
      sourceUrl: "",
      confidence: "",
      message: "Aucun e-mail public suffisamment fiable trouvé."
    };
  }

  for (const item of d?.organic || []) {

    const link = String(item?.link || "");

    let u: URL;

    try {
      u = new URL(link);
    } catch {
      continue;
    }

    const host = u.hostname.toLowerCase();

    if (rejectHosts.some((x) => host.includes(x))) {
      continue;
    }

    const sameEntity = isLikelySameEntity(item, {
      name,
      city,
      sector,
      address,
      website: String(p?.website || "")
    });

    if (action === "identify_address") {

      if (!sameEntity) continue;

      const title = String(item?.title || "")
        .split(/\s[|–—:-]\s/)[0]
        .trim();

      if (!title) continue;

      return {
        found: true,
        companyName: title,
        website: `${u.protocol}//${u.host}`,
        message: "Entreprise probable identifiée."
      };
    }

    if (action === "career_page") {

      if (!sameEntity) continue;

      const text = normalize(
        `${item?.title || ""} ${item?.snippet || ""} ${link}`
      );

      if (
        [
          "career", "jobs", "emploi",
          "recrut", "contact",
          "karriere", "stellen"
        ].some((x) => text.includes(x))
      ) {
        return {
          found: true,
          website: link,
          message: "Page pertinente trouvée."
        };
      }

      continue;
    }

    if (!sameEntity) continue;

    return {
      found: true,
      website: `${u.protocol}//${u.host}`,
      message: "Site public probable trouvé."
    };
  }

  return action === "identify_address"
    ? {
        found: false,
        companyName: "",
        website: "",
        message:
          "Aucune entreprise suffisamment fiable trouvée."
      }
    : {
        found: false,
        website: "",
        message:
          "Aucun site suffisamment fiable trouvé."
      };
}

// ---------------------------------------------------------------------------
// Company-search quota
// ---------------------------------------------------------------------------
async function consumeCompanySearchQuota(auth: string) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !anonKey) {
    throw new Error("Configuration du quota indisponible.");
  }

  const response = await fetch(
    `${supabaseUrl}/rest/v1/rpc/consume_my_company_search`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        apikey: anonKey,
        Authorization: auth
      },
      body: "{}"
    }
  );

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    console.error("company search quota failed", response.status, result);
    throw new Error("Vérification du quota impossible.");
  }

  return result;
}

// ---------------------------------------------------------------------------
// Cost ledger
// ---------------------------------------------------------------------------
// The service-role key remains inside the Edge Function. The Windows client
// cannot add, alter or attribute provider costs to another user.
async function recordProviderCreditUsage(
  userId: string,
  provider: string,
  operation: string
) {
  const supabaseUrl = Deno.env.get("SUPABASE_URL") ?? "";
  const serviceRoleKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";

  if (!supabaseUrl || !serviceRoleKey) {
    console.warn("provider credit ledger unavailable: missing service configuration");
    return;
  }

  try {
    const response = await fetch(
      `${supabaseUrl}/rest/v1/rpc/record_provider_credit_usage`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          apikey: serviceRoleKey,
          Authorization: `Bearer ${serviceRoleKey}`
        },
        body: JSON.stringify({
          p_user_id: userId,
          p_provider: provider,
          p_operation: operation,
          p_credits: 1
        })
      }
    );

    if (!response.ok) {
      console.error("provider credit ledger failed", response.status, await response.text());
    }
  } catch (error) {
    // Accounting must not make a legitimate company search fail.
    console.error("provider credit ledger error", error);
  }
}

function isLikelySameEntity(item: any, company: any): boolean {
  const title = String(item?.title || "");
  const snippet = String(item?.snippet || "");
  const link = String(item?.link || "");
  const text = normalize(`${title} ${snippet} ${link}`);
  const name = normalize(company?.name);
  const city = normalize(company?.city);
  const sector = normalize(company?.sector);
  const address = normalize(company?.address);

  let candidateHost = "";
  let knownHost = "";
  try { candidateHost = new URL(link).hostname.replace(/^www\./, ""); } catch {}
  try { knownHost = new URL(String(company?.website || "")).hostname.replace(/^www\./, ""); } catch {}
  if (knownHost && candidateHost &&
      (candidateHost === knownHost || candidateHost.endsWith(`.${knownHost}`)))
    return true;

  const stopWords = new Set([
    "pour", "avec", "dans", "fondation", "association", "societe",
    "espace", "groupe", "service", "centre", "geneve", "suisse"
  ]);
  const nameTokens = name
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 4 && !stopWords.has(token));
  const matchedNameTokens = nameTokens.filter((token) => text.includes(token)).length;

  const addressTokens = address
    .split(/[^a-z0-9]+/)
    .filter((token) => /^\d{4}$/.test(token) || token.length >= 6);
  const matchedAddressTokens = addressTokens.filter((token) => text.includes(token)).length;
  const cityMatches = !!city && text.includes(city);

  const childcareRequested = /(creche|garderie|petite enfance|enfantine|childcare)/.test(`${sector} ${name}`);
  const childcareEvidence = /(creche|garderie|petite enfance|enfantine|childcare|eve)/.test(text);
  const restaurantEvidence = /(restaurant|restauration|cuisine|menu|traiteur)/.test(text);

  // Same name but incompatible activity: Crescendo crèche must never become
  // Crescendo restaurant merely because both share the word Crescendo.
  if (childcareRequested && restaurantEvidence && !childcareEvidence)
    return false;

  if (name.length >= 8 && text.includes(name)) return true;
  if (matchedNameTokens >= 1 && matchedAddressTokens >= 2) return true;
  if (matchedNameTokens >= 2) return true;
  if (matchedNameTokens >= 1 && childcareRequested && childcareEvidence && cityMatches)
    return true;

  return false;
}

/* ============================================================
   POSTES OUVERTS DU MARCHÉ SUISSE
   ============================================================ */

async function jobSearch(p: any, key: string) {
  const query = String(p?.query || "").trim();
  const city = String(p?.city || "Genève").trim();
  const limit = Math.max(1, Math.min(50, parseInt(String(p?.limit || "30")) || 30));
  const detailSources =
    "(site:jobup.ch/fr/emplois/detail/ OR " +
    "site:jobs.ch/fr/offres-emplois/detail/ OR " +
    "site:jobscout24.ch/fr/job/ OR " +
    "site:ch.indeed.com/viewjob)";
  const q =
    `${query ? query + " " : ""}"${city}" Suisse emploi ${detailSources}`;

  const requestJobs = (page: number) => fetch("https://google.serper.dev/search", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-API-KEY": key
    },
    body: JSON.stringify({ q, gl: "ch", hl: "fr", num: 10, page })
  });

  // Serper renvoie généralement dix résultats organiques par page, même si un
  // nombre supérieur est demandé. Charger plusieurs pages évite donc qu'après
  // les contrôles de qualité il ne reste que six à huit annonces.
  const organic: any[] = [];
  const maxPages = Math.min(6, Math.max(1, Math.ceil(limit / 10) + 2));
  for (let page = 1; page <= maxPages && organic.length < limit + 20; page++) {
    const r = await requestJobs(page);
    if (!r.ok) {
      if (page > 1) {
        console.warn("Serper job search stopped at page", page, r.status);
        break;
      }
      const status = r.status;
      const detail = (await r.text()).slice(0, 500);
      console.error("Serper job search error", status, detail);
      const message = status === 401 || status === 403 || status === 429
        ? "La limite du service de recherche des postes est atteinte. Vérifiez les crédits ou la clé Serper dans Supabase."
        : "Le moteur de recherche des postes est momentanément indisponible. Réessayez dans quelques minutes.";
      throw new Error(`job_search:${message}`);
    }
    const pageData = await r.json();
    const pageItems = Array.isArray(pageData?.organic) ? pageData.organic : [];
    if (!pageItems.length) break;
    organic.push(...pageItems);
  }
  const allowed = ["jobup.ch", "jobs.ch", "jobscout24.ch", "ch.indeed.com"];
  const rejectedFrenchLocations = [
    "france", "annemasse", "saint-julien", "saint julien",
    "ferney", "gex", "haute-savoie", "ain"
  ];
  const seen = new Set<string>();
  const jobs: any[] = [];

  for (const item of organic) {
    const link = String(item?.link || "");
    let u: URL;
    try { u = new URL(link); } catch { continue; }

    const host = u.hostname.toLowerCase().replace(/^www\./, "");
    if (!allowed.some((x) => host === x || host.endsWith("." + x))) continue;
    if (!isIndividualJobUrl(u, host)) continue;
    if (seen.has(link)) continue;

    const title = String(item?.title || "Poste ouvert").trim();
    const snippet = String(item?.snippet || "").trim();
    const haystack = normalize(`${title} ${snippet} ${link}`);
    if (isJobListingPage(title, snippet)) continue;
    if (rejectedFrenchLocations.some((x) => haystack.includes(x))) continue;
    if (!isFrenchJob(title, snippet)) continue;

    seen.add(link);
    const parts = title
      .split(/\s[-–—|]\s/)
      .map((x: string) => x.trim())
      .filter(Boolean);
    const companyName = extractJobCompany(parts, snippet);

    jobs.push({
      title: parts[0] || title,
      companyName,
      location: city || "Suisse",
      source: host.includes("jobup")
        ? "Jobup"
        : host.includes("jobscout24")
          ? "JobScout24"
          : host.includes("jobs.ch")
            ? "jobs.ch"
            : "Indeed Suisse",
      url: link,
      snippet
    });

    if (jobs.length >= limit) break;
  }

  return {
    jobs,
    message: jobs.length
      ? "Offres suisses en français trouvées sur des plateformes d’emploi."
      : "Aucune offre suisse en français correspondante trouvée."
  };
}

function isIndividualJobUrl(url: URL, host: string): boolean {
  const path = url.pathname.toLowerCase();
  if (host === "ch.indeed.com" || host.endsWith(".indeed.com"))
    return path === "/viewjob" && !!url.searchParams.get("jk");
  if (host === "jobscout24.ch" || host.endsWith(".jobscout24.ch"))
    return path.startsWith("/fr/job/") &&
      path.split("/").filter(Boolean).length === 3;
  if (host === "jobup.ch" || host.endsWith(".jobup.ch"))
    return path.includes("/fr/emplois/detail/") || path.includes("/fr/job/detail/");
  if (host === "jobs.ch" || host.endsWith(".jobs.ch"))
    return path.includes("/fr/offres-emplois/detail/") || path.includes("/fr/job/detail/");
  return false;
}

function isJobListingPage(title: string, snippet: string): boolean {
  const text = normalize(`${title} ${snippet}`);
  const normalizedTitle = normalize(title).trim();
  const genericTitles = new Set([
    "equipe", "emploi", "emplois", "job", "jobs", "offre d'emploi",
    "offres d'emploi", "postes ouverts", "jobup", "jobs ch"
  ]);
  return /^[\d\s'’.,]+$/.test(title.trim()) ||
    genericTitles.has(normalizedTitle) ||
    /^\d+\s+(offres|emplois|postes)\b/.test(text) ||
    /\b(emplois|offres d'emploi|jobs)\s+(a|in)\s+[a-z]/.test(text) ||
    /\b(canton de .* trouvees|offres de travail disponibles|resultats de recherche)\b/.test(text);
}

function extractJobCompany(parts: string[], snippet: string): string {
  const snippetMatch = snippet.match(
    /offre d['’]emploi\s+chez\s+([^•|]+?)(?:\s*[•|]|$)/i
  );
  if (snippetMatch?.[1]?.trim())
    return snippetMatch[1].trim();

  const candidate = parts.length > 1 ? parts[1].trim() : "";
  const normalized = normalize(candidate);
  if (candidate &&
      !["jobup", "jobup ch", "jobs ch", "jobscout24", "indeed", "annonce sur jobup ch"]
        .some((platform) => normalized.includes(platform)))
    return candidate;

  return "Entreprise indiquée dans l’annonce";
}

function isFrenchJob(title: string, snippet: string): boolean {
  const original = `${title} ${snippet}`.toLowerCase();
  const text = ` ${normalize(original).replace(/[^a-z0-9]+/g, " ")} `;
  const french = countJobLanguageSignals(text, [
    "poste", "emploi", "mission", "profil", "nous", "vous", "votre",
    "pour", "avec", "formation", "candidature", "contrat", "travail",
    "infirmier", "educateur", "assistant", "agent", "responsable",
    "employe", "vendeur", "comptable", "receptionniste", "cuisinier",
    "serveur", "technicien", "chauffeur", "logistique", "gestionnaire",
    "secretaire", "stagiaire", "directeur"
  ]) + (/[éèêàçùôî]/.test(original) ? 2 : 0);
  const german = countJobLanguageSignals(text, [
    "stelle", "stellen", "aufgaben", "anforderungen", "bewerbung", "ihre",
    "mitarbeiter", "arbeitsort", "ausbildung"
  ]);
  const english = countJobLanguageSignals(text, [
    "job", "role", "responsibilities", "requirements", "apply", "candidate",
    "skills", "team", "position", "sales", "manager", "engineer",
    "developer", "administrative"
  ]);
  const italian = countJobLanguageSignals(text, [
    "posizione", "mansioni", "requisiti", "candidato", "esperienza",
    "lavoro", "formazione", "siamo"
  ]);

  const hasFrenchAccent = /[éèêàçùôî]/.test(original);
  return french >= 1 &&
    (hasFrenchAccent || french > Math.max(german, english, italian));
}

function countJobLanguageSignals(text: string, signals: string[]): number {
  return signals.filter((signal) => text.includes(` ${signal} `)).length;
}

/* ============================================================
   UTILITAIRES
   ============================================================ */

function json(body: unknown, status: number) {
  return new Response(
    JSON.stringify(body),
    {
      status,
      headers: {
        ...corsHeaders,
        "Content-Type": "application/json"
      }
    }
  );
}

async function requireAuthenticatedUser(auth: string) {

  const supabaseUrl =
    Deno.env.get("SUPABASE_URL") ?? "";

  const anonKey =
    Deno.env.get("SUPABASE_ANON_KEY") ?? "";

  if (!supabaseUrl || !anonKey) {
    return {
      ok: false,
      response: json(
        {
          message:
            "Configuration d’authentification indisponible."
        },
        503
      )
    };
  }

  if (!auth.startsWith("Bearer ")) {
    return {
      ok: false,
      response: json(
        { message: "Authentification requise." },
        401
      )
    };
  }

  try {

    const r = await fetch(
      `${supabaseUrl}/auth/v1/user`,
      {
        headers: {
          apikey: anonKey,
          Authorization: auth
        }
      }
    );

    if (!r.ok) {
      return {
        ok: false,
        response: json(
          {
            message:
              "Session utilisateur invalide ou expirée."
          },
          401
        )
      };
    }

    const user = await r.json();

    if (!user?.id) {
      return {
        ok: false,
        response: json(
          {
            message:
              "Session utilisateur invalide."
          },
          401
        )
      };
    }

    return {
      ok: true,
      user
    };

  } catch (e) {

    console.error(
      "auth validation",
      e
    );

    return {
      ok: false,
      response: json(
        {
          message:
            "Service d’authentification temporairement indisponible."
        },
        503
      )
    };
  }
}
