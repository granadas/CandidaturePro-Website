(() => {
  "use strict";

  const config = window.CANDIDATURE_PRO_CONFIG || {};
  const storageKey = "candidature-pro-web-session";
  let profile = null;
  let applications = [];
  let companyResults = [];
  let jobResults = [];
  let refreshPromise = null;

  const titles = {
    dashboard: ["Tableau de bord", "Votre recherche en un coup d’œil"],
    companies: ["Entreprises", "Recherchez et sélectionnez des entreprises"],
    jobs: ["Postes ouverts", "Découvrez les offres correspondant à votre profil"],
    applications: ["Candidatures", "Préparez et contrôlez vos dossiers"],
    tracking: ["Suivi", "Réponses, relances et entretiens"],
    profile: ["Mon profil", "Vos informations de candidature"],
    documents: ["Documents", "CV et lettres de motivation"],
    settings: ["Paramètres", "Compte, e-mail et préférences"]
  };

  const statusLabels = {
    draft: "Brouillon",
    ready: "Prête à envoyer",
    sent: "Envoyée",
    reply_received: "Réponse reçue",
    interview: "Entretien",
    accepted: "Acceptée",
    rejected: "Refusée",
    archived: "Archivée"
  };

  const dialog = document.querySelector("#login-dialog");
  const loginForm = document.querySelector("#login-form");
  const loginMessage = document.querySelector("#login-message");
  const loginButton = document.querySelector("#open-login");
  const signOutButton = document.querySelector("#sign-out");
  const sidebar = document.querySelector(".sidebar");
  const appShell = document.querySelector(".app-shell");
  const guestHome = document.querySelector("#guest-home");
  const guestLogin = document.querySelector("#guest-login");

  function getSession() {
    try { return JSON.parse(localStorage.getItem(storageKey) || "null"); }
    catch { return null; }
  }

  function setSession(session) {
    if (session) localStorage.setItem(storageKey, JSON.stringify(session));
    else localStorage.removeItem(storageKey);
    renderAccount();
  }

  function normalizeSession(result) {
    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(result.expires_in || 3600),
      user: result.user
    };
  }

  function renderAccount() {
    const session = getSession();
    const signedIn = Boolean(session?.user?.id && session?.access_token);
    guestHome.hidden = signedIn;
    appShell.hidden = !signedIn;
    const email = session?.user?.email;
    const firstName = profile?.candidate_first_name?.trim();
    document.querySelector("#account-label").textContent = email || "Version web en préparation";
    document.querySelector("#first-name").textContent = firstName || (email ? email.split("@")[0] : "👋");
    loginButton.textContent = email ? "Mon compte" : "Se connecter";
    signOutButton.hidden = !email;

    const plan = String(profile?.plan || "free").toLowerCase();
    const isPremium = plan === "premium" || plan === "pro";
    document.querySelector("#current-plan").textContent = isPremium ? "Premium" : "Free";
    document.querySelector("#settings-account").textContent = email
      ? email + (profile ? " · " + (isPremium ? "Premium" : "Free") : "")
      : "Connectez-vous pour accéder à votre compte.";
    document.querySelector("#plan-detail").textContent = isPremium ? "Candidatures illimitées" : "5 candidatures par mois";
  }

  function showView(name) {
    if (appShell.hidden) return;
    const isDashboard = name === "dashboard";
    const isProfile = name === "profile";
    const isApplications = name === "applications";
    const isCompanies = name === "companies";
    const isJobs = name === "jobs";
    const isTracking = name === "tracking";
    const isDocuments = name === "documents";
    document.querySelector("#dashboard").classList.toggle("active", isDashboard);
    document.querySelector("#profile-view").classList.toggle("active", isProfile);
    document.querySelector("#applications-view").classList.toggle("active", isApplications);
    document.querySelector("#companies-view").classList.toggle("active", isCompanies);
    document.querySelector("#jobs-view").classList.toggle("active", isJobs);
    document.querySelector("#tracking-view").classList.toggle("active", isTracking);
    document.querySelector("#documents-view").classList.toggle("active", isDocuments);
    document.querySelector("#settings-view").classList.toggle("active", name === "settings");
    document.querySelectorAll(".nav-item[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));

    const [title, subtitle] = titles[name] || ["Candidature Pro", "Espace en ligne"];
    document.querySelector("#page-title").textContent = title;
    document.querySelector("#account-label").dataset.pageSubtitle = subtitle;
    if (!getSession()) document.querySelector("#account-label").textContent = subtitle;

    if (isProfile) renderProfile();
    if (isApplications) loadApplications();
    if (isCompanies) renderCompanies();
    if (isJobs) loadJobs();
    if (isTracking) loadTracking();
    if (isDocuments) loadDocuments();
    if (name === "settings") loadGmail();
    sidebar.classList.remove("open");
  }

  async function authRequest(grantType, body) {
    const response = await fetch(config.supabaseUrl + "/auth/v1/token?grant_type=" + grantType, {
      method: "POST",
      headers: {
        "apikey": config.supabasePublishableKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error_description || result.msg || "Connexion impossible.");
    return normalizeSession(result);
  }

  async function signIn(email, password) {
    if (!config.supabaseUrl || !config.supabasePublishableKey) {
      throw new Error("La connexion réelle n’est pas encore activée sur cette version de test.");
    }
    return authRequest("password", { email, password });
  }

  async function refreshSession() {
    if (refreshPromise) return refreshPromise;
    refreshPromise = (async () => {
      const session = getSession();
      if (!session?.refresh_token) throw new Error("Session expirée.");
      const refreshed = await authRequest("refresh_token", { refresh_token: session.refresh_token });
      setSession(refreshed);
      return refreshed;
    })();
    try { return await refreshPromise; }
    finally { refreshPromise = null; }
  }

  async function ensureSession() {
    const session = getSession();
    if (!session) return null;
    if (Number(session.expires_at || 0) > Math.floor(Date.now() / 1000) + 60) return session;
    try { return await refreshSession(); }
    catch {
      profile = null;
      setSession(null);
      return null;
    }
  }

  async function supabaseFetch(path, retry = true) {
    const session = await ensureSession();
    if (!session) throw new Error("Connectez-vous pour afficher vos données.");
    const response = await fetch(config.supabaseUrl + "/rest/v1/" + path, {
      headers: {
        "apikey": config.supabasePublishableKey,
        "Authorization": "Bearer " + session.access_token,
        "Accept": "application/json"
      }
    });
    if (response.status === 401 && retry) {
      await refreshSession();
      return supabaseFetch(path, false);
    }
    const result = await response.json().catch(() => []);
    if (!response.ok) throw new Error(result.message || "Impossible de charger les données.");
    return result;
  }

  async function supabaseWrite(path, method, body, retry = true) {
    const session = await ensureSession();
    if (!session) throw new Error("Connectez-vous pour modifier vos données.");
    const response = await fetch(config.supabaseUrl + "/rest/v1/" + path, {
      method,
      headers: {
        "apikey": config.supabasePublishableKey,
        "Authorization": "Bearer " + session.access_token,
        "Content-Type": "application/json",
        "Accept": "application/json",
        "Prefer": "return=representation"
      },
      body: JSON.stringify(body)
    });
    if (response.status === 401 && retry) {
      await refreshSession();
      return supabaseWrite(path, method, body, false);
    }
    const result = await response.json().catch(() => []);
    if (!response.ok) throw new Error(result.message || "Impossible d’enregistrer les données.");
    return result;
  }

  async function supabaseRpc(name, body, retry = true) {
    const session = await ensureSession();
    if (!session) throw new Error("Connectez-vous pour enregistrer votre profil.");
    const response = await fetch(config.supabaseUrl + "/rest/v1/rpc/" + name, {
      method: "POST",
      headers: {
        "apikey": config.supabasePublishableKey,
        "Authorization": "Bearer " + session.access_token,
        "Content-Type": "application/json",
        "Accept": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (response.status === 401 && retry) {
      await refreshSession();
      return supabaseRpc(name, body, false);
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Impossible d’exécuter l’opération.");
    return result;
  }

  async function invokeEdgeFunction(name, body, retry = true) {
    const session = await ensureSession();
    if (!session) throw new Error("Connectez-vous pour continuer.");
    const response = await fetch(config.supabaseUrl + "/functions/v1/" + name, {
      method: "POST",
      headers: {
        "apikey": config.supabasePublishableKey,
        "Authorization": "Bearer " + session.access_token,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(body)
    });
    if (response.status === 401 && retry) {
      await refreshSession();
      return invokeEdgeFunction(name, body, false);
    }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.message || "Le service est indisponible.");
    return result;
  }

  function renderProfile() {
    const session = getSession();
    const form = document.querySelector("#profile-form");
    const message = document.querySelector("#profile-message");
    const enabled = Boolean(session?.user?.id);
    form.querySelectorAll("input, button").forEach(element => { element.disabled = !enabled; });
    document.querySelector("#profile-first-name").value = profile?.candidate_first_name || "";
    document.querySelector("#profile-last-name").value = profile?.candidate_last_name || "";
    document.querySelector("#profile-email").value = profile?.candidate_email || session?.user?.email || "";
    message.textContent = enabled ? "" : "Connectez-vous pour compléter votre profil.";
  }

  function escapeHtml(value) {
    return String(value ?? "").replace(/[&<>"']/g, character => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
    })[character]);
  }

  function safeExternalUrl(value) {
    try {
      const url = new URL(String(value || ""));
      return url.protocol === "http:" || url.protocol === "https:" ? url.href : "";
    } catch {
      return "";
    }
  }

  function normalizeCompany(company) {
    return {
      id: company.company_id ?? company.id ?? "",
      name: company.company_name ?? company.name ?? "",
      city: company.city ?? "",
      sector: company.sector ?? "",
      email: company.email ?? "",
      website: company.website ?? "",
      address: company.address ?? "",
      phone: company.phone ?? "",
      isFresh: Boolean(company.is_fresh)
    };
  }

  function renderCompanies() {
    const container = document.querySelector("#company-results");
    document.querySelector("#company-results-count").textContent =
      companyResults.length + " résultat" + (companyResults.length > 1 ? "s" : "");

    if (!companyResults.length) {
      container.innerHTML = '<div class="empty-list"><strong>Aucune entreprise affichée</strong><span>Choisissez un secteur, une ville et un rayon.</span></div>';
      return;
    }

    container.innerHTML = companyResults.map((company, index) => {
      const safeWebsite = safeExternalUrl(company.website);
      const website = safeWebsite
        ? '<a href="' + escapeHtml(safeWebsite) + '" target="_blank" rel="noopener noreferrer">Voir le site</a>'
        : "";
      return '<article class="company-card" data-company-index="' + index + '">' +
        '<div class="company-card-main"><strong>' + escapeHtml(company.name) + '</strong>' +
        '<span>' + escapeHtml(company.address || company.city) + '</span>' +
        '<small>' + escapeHtml([company.sector, company.email, company.phone].filter(Boolean).join(" • ")) + '</small></div>' +
        '<div class="company-card-actions">' + website +
        '<button class="primary compact" data-action="add-company">Ajouter aux candidatures</button></div></article>';
    }).join("");
  }

  async function searchCompanies() {
    const message = document.querySelector("#company-search-message");
    const source = document.querySelector("#company-search-source");
    const sector = document.querySelector("#company-sector").value.trim();
    const city = document.querySelector("#company-city").value.trim();
    const radius = document.querySelector("#company-radius").value;
    message.textContent = "Recherche dans les résultats récents…";
    source.textContent = "";

    const cached = await supabaseRpc("get_cached_company_search", {
      p_sector: sector,
      p_city: city,
      p_radius: radius
    });
    const cachedCompanies = Array.isArray(cached) ? cached.map(normalizeCompany) : [];
    if (cachedCompanies.length && cachedCompanies.some(company => company.isFresh)) {
      companyResults = cachedCompanies;
      renderCompanies();
      source.textContent = "Résultats récents";
      message.textContent = companyResults.length + " entreprise" + (companyResults.length > 1 ? "s trouvées." : " trouvée.");
      await supabaseRpc("record_company_search_event", { p_sector: sector || "Tous les secteurs", p_city: city });
      return;
    }

    message.textContent = "Recherche Internet en cours…";
    const result = await invokeEdgeFunction("app-services", {
      action: "company_search",
      payload: { sector, city, radius }
    });
    const quota = result.quota || {};
    const rawCompanies = Array.isArray(result.companies) ? result.companies : [];
    companyResults = rawCompanies.map(normalizeCompany);
    renderCompanies();
    source.textContent = quota.premium ? "Recherche Internet • Premium" : "Recherche Internet • " + (quota.used ?? "—") + "/" + (quota.limit ?? 5);
    message.textContent = companyResults.length
      ? companyResults.length + " entreprise" + (companyResults.length > 1 ? "s trouvées." : " trouvée.")
      : "Aucune entreprise trouvée pour ces critères.";

    if (rawCompanies.length) {
      await supabaseRpc("remember_company_search", {
        p_sector: sector,
        p_city: city,
        p_radius: radius,
        p_companies: rawCompanies
      });
      if (rawCompanies.some(company => company.email)) {
        await supabaseRpc("review_discovered_company_emails", { p_companies: rawCompanies });
      }
    }
    await supabaseRpc("record_company_search_event", { p_sector: sector || "Tous les secteurs", p_city: city });
  }

  function renderJobs() {
    const container = document.querySelector("#jobs-results");
    document.querySelector("#jobs-results-count").textContent =
      jobResults.length + " offre" + (jobResults.length > 1 ? "s" : "");

    if (!jobResults.length) {
      container.innerHTML = '<div class="empty-list"><strong>Aucune offre trouvée</strong><span>Modifiez le métier, la ville ou le secteur.</span></div>';
      return;
    }

    container.innerHTML = jobResults.map((job, index) => {
      const safeUrl = safeExternalUrl(job.url);
      const sourceLink = safeUrl
        ? '<a class="secondary compact" href="' + escapeHtml(safeUrl) + '" target="_blank" rel="noopener noreferrer">Voir l’annonce</a>'
        : "";
      return '<article class="job-card" data-job-index="' + index + '">' +
        '<div class="job-card-main"><strong>' + escapeHtml(job.title) + '</strong>' +
        '<span>' + escapeHtml(job.company_name) + ' • ' + escapeHtml(job.location) + '</span>' +
        '<small>' + escapeHtml(job.sector) + ' • ' + escapeHtml(job.source) + '</small>' +
        '<p>' + escapeHtml(job.snippet) + '</p></div>' +
        '<div class="job-card-actions">' + sourceLink +
        '<button class="primary compact" data-action="add-job">Ajouter aux candidatures</button></div></article>';
    }).join("");
  }

  function cleanSearchTerm(value) {
    return String(value || "").trim().replace(/[%(),]/g, " ").replace(/\s+/g, " ");
  }

  async function loadJobs() {
    const message = document.querySelector("#jobs-message");
    if (!getSession()) {
      jobResults = [];
      renderJobs();
      message.textContent = "Connectez-vous pour consulter les postes ouverts.";
      return;
    }

    const query = cleanSearchTerm(document.querySelector("#jobs-query").value);
    const city = cleanSearchTerm(document.querySelector("#jobs-city").value);
    const sector = document.querySelector("#jobs-sector").value;
    const filters = ["active=eq.true"];
    if (query) {
      const pattern = encodeURIComponent("*" + query + "*");
      filters.push("or=(title.ilike." + pattern + ",company_name.ilike." + pattern + ",snippet.ilike." + pattern + ")");
    }
    if (city) filters.push("location=ilike." + encodeURIComponent("*" + city + "*"));
    if (sector) filters.push("sector=eq." + encodeURIComponent(sector));

    message.textContent = "Chargement…";
    try {
      jobResults = await supabaseFetch(
        "job_market_offers?select=id,title,company_name,location,sector,source,url,snippet,discovered_at&" +
        filters.join("&") + "&order=discovered_at.desc&limit=60"
      );
      renderJobs();
      message.textContent = jobResults.length
        ? "Offres actives correspondant à vos critères."
        : "Aucune offre active ne correspond à ces critères.";
    } catch (error) {
      jobResults = [];
      renderJobs();
      message.textContent = error.message;
    }
  }

  function renderApplications() {
    const list = document.querySelector("#applications-list");
    if (!applications.length) {
      list.innerHTML = '<div class="empty-list"><strong>Aucune candidature enregistrée</strong><span>Ajoutez votre premier dossier avec le formulaire.</span></div>';
      return;
    }

    const statusOptions = Object.entries(statusLabels)
      .map(([value, label]) => '<option value="' + value + '">' + label + '</option>')
      .join("");

    list.innerHTML = applications.map(application => {
      const hidden = Boolean(application.hidden_at);
      const options = statusOptions.replace(
        'value="' + escapeHtml(application.status) + '"',
        'value="' + escapeHtml(application.status) + '" selected'
      );
      const safeSourceUrl = safeExternalUrl(application.source_url);
      const sourceLink = safeSourceUrl
        ? '<a href="' + escapeHtml(safeSourceUrl) + '" target="_blank" rel="noopener noreferrer">Annonce originale</a>'
        : "";
      return '<article class="application-row' + (hidden ? ' is-hidden' : '') + '" data-id="' + escapeHtml(application.id) + '">' +
        '<div class="application-main"><strong>' + escapeHtml(application.company_name) + '</strong>' +
        '<span>' + escapeHtml(application.job_title || "Candidature spontanée") + '</span>' +
        '<small>' + escapeHtml([application.company_city, application.company_email].filter(Boolean).join(" • ")) + '</small>' +
        sourceLink + '</div>' +
        (!hidden && application.status === "ready" && application.company_email && !application.sent_at
          ? '<button class="secondary compact" data-action="send">Préparer l’envoi</button>' : '') +
        '<label class="status-field"><span>Statut</span><select data-action="status">' + options + '</select></label>' +
        '<button class="secondary compact" data-action="' + (hidden ? "restore" : "hide") + '">' +
        (hidden ? "Réafficher" : "Masquer") + '</button></article>';
    }).join("");
  }

  async function loadApplications() {
    const message = document.querySelector("#applications-message");
    if (!getSession()) {
      applications = [];
      renderApplications();
      message.textContent = "Connectez-vous pour afficher vos candidatures.";
      return;
    }
    message.textContent = "Chargement…";
    try {
      const includeHidden = document.querySelector("#show-hidden-applications").checked;
      const filter = includeHidden ? "" : "&hidden_at=is.null";
      applications = await supabaseFetch(
        "user_applications?select=id,company_name,company_city,company_email,job_title,status,source_url,hidden_at,last_activity_at,sent_at" +
        filter + "&order=last_activity_at.desc"
      );
      renderApplications();
      message.textContent = applications.length + " candidature" + (applications.length > 1 ? "s" : "") + ".";
    } catch (error) {
      applications = [];
      renderApplications();
      message.textContent = error.message;
    }
  }

  const replyDialog = document.querySelector("#reply-dialog");
  const replyContent = document.querySelector("#reply-content");
  const replyGmail = document.querySelector("#reply-gmail");
  const replyConsent = document.querySelector("#reply-consent");
  replyConsent.addEventListener("click", () => startGmailConnection(replyConsent, true));

  document.querySelector("#tracking-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-open-reply]");
    if (!button || button.disabled) return;
    const userId = getSession()?.user?.id;
    button.disabled = true;
    replyGmail.hidden = true;
    replyConsent.hidden = true;
    replyContent.textContent = "Chargement…";
    replyDialog.showModal();
    try {
      const result = await invokeEdgeFunction("gmail-web", {
        action: "open_reply", applicationId: button.dataset.openReply, preview: true
      });
      if (!userId || getSession()?.user?.id !== userId) return;
      replyGmail.href = "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(result.threadId);
      replyGmail.hidden = false;
      replyConsent.hidden = !result.needsConsent;
      replyContent.textContent = result.needsConsent ? "Autorisez la lecture pour afficher le message ici." :
        result.replies?.filter(Boolean).join("\n\n────────\n\n") || "Le contenu de ce message est disponible dans Gmail.";
    } catch (error) {
      if (getSession()?.user?.id === userId) replyContent.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const trackingDateFormat = new Intl.DateTimeFormat("fr-CH", { dateStyle: "medium" });

  async function loadTracking() {
    const message = document.querySelector("#tracking-message");
    const list = document.querySelector("#tracking-list");
    const userId = getSession()?.user?.id;
    list.replaceChildren();
    if (!userId) {
      message.textContent = "Connectez-vous pour consulter le suivi.";
      return;
    }
    message.textContent = "Chargement…";
    try {
      const rows = await supabaseFetch(
        "user_applications?select=id,company_name,job_title,status,sent_at,next_follow_up_at,last_inbound_at" +
        "&hidden_at=is.null&status=in.(sent,reply_received,interview,accepted,rejected)" +
        "&order=next_follow_up_at.asc.nullslast,last_activity_at.desc"
      );
      if (getSession()?.user?.id !== userId) return;
      message.textContent = rows.length ? "" : "Les candidatures envoyées apparaîtront ici.";
      list.innerHTML = rows.map(row => {
        const followUp = row.next_follow_up_at ? new Date(row.next_follow_up_at) : null;
        const localDate = followUp
          ? new Date(followUp.getTime() - followUp.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
          : "";
        const overdue = followUp && followUp.getTime() < new Date().setHours(0, 0, 0, 0);
        return '<article class="application-row"><div class="application-main"><strong>' +
          escapeHtml(row.company_name) + '</strong><span>' +
          escapeHtml(row.job_title || "Candidature spontanée") + '</span><small>' +
          escapeHtml(statusLabels[row.status]) +
          (row.sent_at ? " · " + trackingDateFormat.format(new Date(row.sent_at)) : "") +
          (overdue ? " · Relance en retard" : "") + '</small>' +
          (row.last_inbound_at ? '<button type="button" class="secondary compact" data-open-reply="' +
            escapeHtml(row.id) + '">Lire la réponse</button>' : '') + '</div>' +
          '<form class="application-form tracking-form" data-id="' + escapeHtml(row.id) + '">' +
          '<label>Date de relance<input name="follow-up" type="date" value="' + localDate + '"></label>' +
          '<button type="submit" class="secondary compact">Enregistrer</button></form></article>';
      }).join("");
    } catch (error) {
      if (getSession()?.user?.id === userId) message.textContent = error.message;
    }
  }

  document.querySelector("#tracking-list").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const date = form.elements.namedItem("follow-up").value;
    const button = form.querySelector("button");
    button.disabled = true;
    try {
      await supabaseWrite("user_applications?id=eq." + encodeURIComponent(form.dataset.id), "PATCH", {
        next_follow_up_at: date ? new Date(date + "T12:00:00").toISOString() : null
      });
      await loadTracking();
    } catch (error) {
      document.querySelector("#tracking-message").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const documentsBucket = "candidature-documents";
  const documentKinds = { cv: "CV", lettre: "Lettre de motivation" };
  const documentForm = document.querySelector("#document-form");
  const documentsList = document.querySelector("#documents-list");
  const documentsMessage = document.querySelector("#documents-message");
  let documentsRequest = 0;

  async function documentRequest(session, path, options = {}) {
    const response = await fetch(config.supabaseUrl + "/storage/v1/object/" + path, {
      ...options,
      headers: {
        apikey: config.supabasePublishableKey,
        Authorization: "Bearer " + session.access_token,
        ...options.headers
      }
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.message || "Le service de documents est indisponible.");
    }
    return response;
  }

  async function loadDocuments() {
    const request = ++documentsRequest;
    documentForm.hidden = true;
    documentsList.replaceChildren();
    documentsMessage.textContent = "Chargement des documents…";
    try {
      const session = await ensureSession();
      if (request !== documentsRequest) return;
      if (!session?.user?.id) {
        documentsMessage.textContent = "Connectez-vous pour accéder à vos documents.";
        return;
      }
      const groups = await Promise.all(Object.entries(documentKinds).map(async ([kind, label]) => {
        const prefix = session.user.id + "/" + kind;
        const files = [];
        const limit = 100;
        for (let offset = 0; ; offset += limit) {
          const response = await documentRequest(session, "list/" + documentsBucket, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ prefix, limit, offset, sortBy: { column: "name", order: "asc" } })
          });
          const page = await response.json();
          files.push(...page.filter(file => file.id).map(file => ({ prefix, label, name: file.name })));
          if (page.length < limit) return files;
        }
      }));
      if (request !== documentsRequest || getSession()?.user?.id !== session.user.id) return;
      const files = groups.flat();
      for (const file of files) {
        const row = document.createElement("div");
        row.className = "application-row";
        const title = document.createElement("p");
        const name = file.name.replace(/^[a-f0-9-]{36}_/, "");
        title.textContent = file.label + " · " + name;
        const button = document.createElement("button");
        button.className = "secondary";
        button.textContent = "Télécharger";
        button.addEventListener("click", async () => {
          button.disabled = true;
          try {
            const active = await ensureSession();
            if (active?.user?.id !== session.user.id) throw new Error("Reconnectez-vous pour télécharger ce document.");
            const response = await documentRequest(active, "authenticated/" + documentsBucket + "/" + file.prefix + "/" + encodeURIComponent(file.name));
            const blob = await response.blob();
            if (getSession()?.user?.id !== session.user.id) return;
            const url = URL.createObjectURL(blob);
            const link = document.createElement("a");
            link.href = url;
            link.download = name;
            link.click();
            setTimeout(() => URL.revokeObjectURL(url), 1000);
          } catch (error) {
            if (getSession()?.user?.id === session.user.id) documentsMessage.textContent = error.message;
          } finally {
            button.disabled = false;
          }
        });
        row.append(title, button);
        documentsList.append(row);
      }
      documentForm.hidden = false;
      documentsMessage.textContent = files.length ? "" : "Aucun document ajouté.";
    } catch (error) {
      if (request === documentsRequest) documentsMessage.textContent = error.message;
    }
  }

  documentForm.addEventListener("submit", async event => {
    event.preventDefault();
    const button = documentForm.querySelector("button");
    const file = document.querySelector("#document-file").files[0];
    const kind = document.querySelector("#document-kind").value;
    if (!file || !Object.hasOwn(documentKinds, kind)) return;
    if (file.size > 10 * 1024 * 1024 || !/\.pdf$/i.test(file.name)) {
      documentsMessage.textContent = "Choisissez un PDF de 10 Mo maximum.";
      return;
    }
    button.disabled = true;
    documentsMessage.textContent = "Envoi du document…";
    const userId = getSession()?.user?.id;
    try {
      const session = await ensureSession();
      if (!userId || session?.user?.id !== userId) throw new Error("Reconnectez-vous pour ajouter un document.");
      const header = await file.slice(0, 5).text();
      if (header !== "%PDF-") throw new Error("Ce fichier ne semble pas être un PDF valide.");
      const name = file.name.slice(0, -4).normalize("NFKD").replace(/[^a-zA-Z0-9._ -]/g, "").trim().slice(0, 120) || "document";
      const path = userId + "/" + kind + "/" + crypto.randomUUID() + "_" + name + ".pdf";
      await documentRequest(session, documentsBucket + "/" + path.split("/").map(encodeURIComponent).join("/"), {
        method: "POST",
        headers: { "Content-Type": "application/pdf" },
        body: file
      });
      if (getSession()?.user?.id !== userId) return;
      documentForm.reset();
      await loadDocuments();
    } catch (error) {
      if (getSession()?.user?.id === userId) documentsMessage.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  function currentMonthStart() {
    const now = new Date();
    const year = now.getUTCFullYear();
    const month = String(now.getUTCMonth() + 1).padStart(2, "0");
    return year + "-" + month + "-01";
  }

  async function loadDashboard() {
    const session = await ensureSession();
    if (!session?.user?.id) {
      profile = null;
      renderAccount();
      document.querySelector("#stat-sent").textContent = "0";
      return;
    }

    const userId = encodeURIComponent(session.user.id);
    const month = currentMonthStart();
    const [profiles, usage] = await Promise.all([
      supabaseFetch("profiles?id=eq." + userId + "&select=candidate_first_name,candidate_last_name,candidate_email,plan,premium_until,is_admin"),
      supabaseFetch("candidature_usage?user_id=eq." + userId + "&month_start=eq." + month + "&select=application_key")
    ]);

    profile = Array.isArray(profiles) ? profiles[0] || null : null;
    document.querySelector("#stat-sent").textContent = String(Array.isArray(usage) ? usage.length : 0);
    const hasProfile = Boolean(profile?.candidate_first_name && profile?.candidate_last_name);
    document.querySelector("#setup-progress").textContent = hasProfile ? "2/4" : "1/4";
    renderAccount();
    renderProfile();
  }

  document.querySelector("#profile-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.querySelector("#profile-submit");
    const message = document.querySelector("#profile-message");
    button.disabled = true;
    button.textContent = "Enregistrement…";
    message.textContent = "";
    try {
      profile = await supabaseRpc("update_own_candidate_profile", {
        p_first_name: document.querySelector("#profile-first-name").value,
        p_last_name: document.querySelector("#profile-last-name").value,
        p_email: document.querySelector("#profile-email").value
      });
      renderAccount();
      renderProfile();
      document.querySelector("#setup-progress").textContent =
        profile?.candidate_first_name && profile?.candidate_last_name ? "2/4" : "1/4";
      message.textContent = "Profil enregistré.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Enregistrer";
    }
  });

  document.querySelector("#jobs-search-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.querySelector("#jobs-search-submit");
    button.disabled = true;
    button.textContent = "Recherche…";
    try {
      await loadJobs();
    } finally {
      button.disabled = false;
      button.textContent = "Rechercher";
    }
  });

  document.querySelector("#jobs-results").addEventListener("click", async event => {
    if (event.target.dataset.action !== "add-job") return;
    const card = event.target.closest("[data-job-index]");
    const job = jobResults[Number(card.dataset.jobIndex)];
    if (!job) return;
    const button = event.target;
    button.disabled = true;
    button.textContent = "Ajout…";
    try {
      await supabaseWrite("user_applications", "POST", {
        company_name: job.company_name,
        company_city: job.location || null,
        job_title: job.title,
        source_url: safeExternalUrl(job.url) || null,
        status: "draft",
        source: "web"
      });
      button.textContent = "Ajoutée ✓";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Réessayer";
      document.querySelector("#jobs-message").textContent = error.message;
    }
  });

  document.querySelector("#company-search-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.querySelector("#company-search-submit");
    const message = document.querySelector("#company-search-message");
    button.disabled = true;
    button.textContent = "Recherche…";
    try {
      await searchCompanies();
    } catch (error) {
      companyResults = [];
      renderCompanies();
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Rechercher";
    }
  });

  document.querySelector("#company-results").addEventListener("click", async event => {
    if (event.target.dataset.action !== "add-company") return;
    const card = event.target.closest("[data-company-index]");
    const company = companyResults[Number(card.dataset.companyIndex)];
    if (!company) return;
    const button = event.target;
    button.disabled = true;
    button.textContent = "Ajout…";
    try {
      await supabaseWrite("user_applications", "POST", {
        company_name: company.name,
        company_city: company.city || null,
        company_email: company.email || null,
        status: "draft",
        source: "web"
      });
      button.textContent = "Ajoutée ✓";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Réessayer";
      document.querySelector("#company-search-message").textContent = error.message;
    }
  });

  document.querySelector("#application-form").addEventListener("submit", async event => {
    const form = event.currentTarget;
    event.preventDefault();
    const button = document.querySelector("#application-submit");
    const message = document.querySelector("#application-message");
    const status = document.querySelector("#application-status").value;
    button.disabled = true;
    button.textContent = "Ajout…";
    message.textContent = "";
    try {
      await supabaseWrite("user_applications", "POST", {
        company_name: document.querySelector("#application-company").value.trim(),
        job_title: document.querySelector("#application-job").value.trim() || null,
        company_city: document.querySelector("#application-city").value.trim() || null,
        company_email: document.querySelector("#application-email").value.trim() || null,
        status,
        sent_at: status === "sent" ? new Date().toISOString() : null
      });
      form.reset();
      message.textContent = "Candidature ajoutée.";
      await loadApplications();
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      button.textContent = "Ajouter la candidature";
    }
  });

  document.querySelector("#show-hidden-applications").addEventListener("change", loadApplications);

  document.querySelector("#applications-list").addEventListener("change", async event => {
    if (event.target.dataset.action !== "status") return;
    const row = event.target.closest("[data-id]");
    const status = event.target.value;
    try {
      await supabaseWrite("user_applications?id=eq." + encodeURIComponent(row.dataset.id), "PATCH", {
        status,
        sent_at: status === "sent" ? new Date().toISOString() : undefined,
        last_activity_at: new Date().toISOString()
      });
      await loadApplications();
    } catch (error) {
      document.querySelector("#applications-message").textContent = error.message;
    }
  });

  document.querySelector("#applications-list").addEventListener("click", async event => {
    const action = event.target.dataset.action;
    if (action === "send") {
      openSendDialog(event.target.closest("[data-id]")?.dataset.id);
      return;
    }
    if (action !== "hide" && action !== "restore") return;
    const row = event.target.closest("[data-id]");
    try {
      await supabaseWrite("user_applications?id=eq." + encodeURIComponent(row.dataset.id), "PATCH", {
        hidden_at: action === "hide" ? new Date().toISOString() : null,
        last_activity_at: new Date().toISOString()
      });
      await loadApplications();
    } catch (error) {
      document.querySelector("#applications-message").textContent = error.message;
    }
  });

  document.querySelectorAll("[data-view], [data-view-link]").forEach(el => {
    el.addEventListener("click", () => showView(el.dataset.view || el.dataset.viewLink));
  });
  document.querySelector("#menu-toggle").addEventListener("click", () => sidebar.classList.toggle("open"));
  guestLogin.addEventListener("click", () => dialog.showModal());
  document.querySelector("#close-login").addEventListener("click", () => dialog.close());
  loginButton.addEventListener("click", () => {
    if (getSession()) showView("settings");
    else dialog.showModal();
  });
  signOutButton.addEventListener("click", () => {
    profile = null;
    ++documentsRequest;
    sessionStorage.removeItem(gmailFlowKey);
    documentForm.reset();
    documentForm.hidden = true;
    documentsList.replaceChildren();
    documentsMessage.textContent = "";
    document.querySelector("#tracking-list").replaceChildren();
    document.querySelector("#tracking-message").textContent = "";
    setSession(null);
    location.replace("../");
  });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = document.querySelector("#login-submit");
    loginMessage.textContent = "";
    submit.disabled = true;
    submit.textContent = "Connexion…";
    try {
      const session = await signIn(document.querySelector("#email").value.trim(), document.querySelector("#password").value);
      setSession(session);
      showView("dashboard");
      dialog.close();
      loginForm.reset();
      await loadDashboard().catch(error => {
        document.querySelector("#account-label").textContent = error.message;
      });
    } catch (error) {
      loginMessage.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Se connecter";
    }
  });

  const sendDialog = document.querySelector("#send-dialog");
  const sendForm = document.querySelector("#send-form");
  const sendSubmit = document.querySelector("#send-submit");
  const sendStatus = document.querySelector("#send-status");
  let sendApplication = null;

  function openSendDialog(id) {
    const dossier = applications.find(application => application.id === id);
    if (!dossier?.company_email || !getSession()?.user?.id) return;
    sendApplication = dossier;
    sendForm.reset();
    sendSubmit.disabled = false;
    sendStatus.textContent = "";
    document.querySelector("#send-recipient").textContent = "Destinataire · " + dossier.company_email;
    document.querySelector("#send-subject").value =
      (dossier.job_title ? "Candidature – " + dossier.job_title : "Candidature spontanée").slice(0, 120);
    sendDialog.showModal();
  }

  document.querySelector("#send-cancel").addEventListener("click", () => sendDialog.close());
  sendDialog.addEventListener("cancel", event => {
    if (sendSubmit.disabled) event.preventDefault();
  });
  sendForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (sendSubmit.disabled || !sendApplication) return;
    const userId = getSession()?.user?.id;
    sendSubmit.disabled = true;
    document.querySelector("#send-cancel").disabled = true;
    sendStatus.textContent = "Envoi en cours…";
    try {
      const files = Array.from(document.querySelector("#send-files").files);
      if (files.length > 2 || files.reduce((total, file) => total + file.size, 0) > 5 * 1024 * 1024) {
        throw new Error("Choisissez au maximum deux PDF de 5 Mo au total.");
      }
      const attachments = await Promise.all(files.map(async file => {
        if (!/\.pdf$/i.test(file.name) || await file.slice(0, 5).text() !== "%PDF-") {
          throw new Error("Les pièces jointes doivent être des PDF.");
        }
        const bytes = new Uint8Array(await file.arrayBuffer());
        let binary = "";
        for (let offset = 0; offset < bytes.length; offset += 8192) {
          binary += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
        }
        return { name: file.name, data: btoa(binary) };
      }));
      if (!userId || getSession()?.user?.id !== userId) return;
      await invokeEdgeFunction("gmail-web", {
        action: "send", attachments, applicationId: sendApplication.id, recipient: sendApplication.company_email,
        subject: document.querySelector("#send-subject").value.trim(),
        message: document.querySelector("#send-message").value
      });
      if (getSession()?.user?.id !== userId) return;
      sendDialog.close();
      await Promise.all([loadApplications(), loadDashboard().catch(() => {})]);
      document.querySelector("#applications-message").textContent = "Candidature envoyée via Gmail.";
    } catch (error) {
      if (getSession()?.user?.id === userId) sendStatus.textContent = error.message;
    } finally {
      sendSubmit.disabled = false;
      document.querySelector("#send-cancel").disabled = false;
    }
  });

  const gmailStatus = document.querySelector("#gmail-status");
  const gmailConnect = document.querySelector("#gmail-connect");
  const gmailDisconnect = document.querySelector("#gmail-disconnect");
  const gmailFlowKey = "candidature-pro-gmail-flow";

  function gmailEncode(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  async function loadGmail() {
    const userId = getSession()?.user?.id;
    gmailConnect.hidden = true;
    gmailDisconnect.hidden = true;
    gmailStatus.textContent = userId ? "Vérification de la connexion Gmail…" : "Connectez-vous à Candidature Pro pour lier Gmail.";
    if (!userId) return;
    try {
      const result = await invokeEdgeFunction("gmail-web", { action: "status" });
      if (getSession()?.user?.id !== userId) return;
      gmailConnect.hidden = !result.configured || result.connected;
      gmailDisconnect.hidden = !result.connected;
      gmailStatus.textContent = result.connected ? "Compte Gmail connecté." :
        result.configured ? "Aucun compte Gmail connecté." : "La connexion Gmail web attend la configuration Google.";
    } catch {
      if (getSession()?.user?.id === userId) gmailStatus.textContent = "Le service Gmail est indisponible.";
    }
  }

  const refreshReplies = document.querySelector("#refresh-replies");
  const authorizeReplies = document.querySelector("#authorize-replies");
  const repliesStatus = document.querySelector("#replies-status");

  refreshReplies.addEventListener("click", async () => {
    refreshReplies.disabled = true;
    authorizeReplies.hidden = true;
    repliesStatus.textContent = "Recherche des réponses Gmail…";
    try {
      const result = await invokeEdgeFunction("gmail-web", { action: "refresh_replies" });
      authorizeReplies.hidden = !result.needsConsent;
      repliesStatus.textContent = result.needsConsent ? "Autorisez Gmail pour vérifier les réponses à vos candidatures." :
        result.updated ? result.updated + " candidature(s) mise(s) à jour." : "Aucune nouvelle réponse dans les 20 derniers envois web.";
      await loadTracking();
    } catch (error) {
      repliesStatus.textContent = error.message;
    } finally {
      refreshReplies.disabled = false;
    }
  });

  gmailConnect.addEventListener("click", () => startGmailConnection(gmailConnect, false));
  authorizeReplies.addEventListener("click", () => startGmailConnection(authorizeReplies, true));

  async function startGmailConnection(button, readReplies) {
    button.disabled = true;
    const userId = getSession()?.user?.id;
    try {
      const verifier = gmailEncode(crypto.getRandomValues(new Uint8Array(32)));
      const state = gmailEncode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = gmailEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      const result = await invokeEdgeFunction("gmail-web", { action: "start", challenge, state, readReplies });
      if (getSession()?.user?.id !== userId) return;
      const url = new URL(result.url);
      if (url.origin !== "https://accounts.google.com" || url.pathname !== "/o/oauth2/v2/auth") throw new Error("Adresse Google inattendue.");
      sessionStorage.setItem(gmailFlowKey, JSON.stringify({ verifier, state, userId, readReplies, startedAt: Date.now() }));
      location.assign(url.href);
    } catch (error) {
      (readReplies ? repliesStatus : gmailStatus).textContent = error.message;
    } finally {
      button.disabled = false;
    }
  }

  gmailDisconnect.addEventListener("click", async () => {
    gmailDisconnect.disabled = true;
    try {
      await invokeEdgeFunction("gmail-web", { action: "disconnect" });
      await loadGmail();
    } catch (error) {
      gmailStatus.textContent = error.message;
    } finally {
      gmailDisconnect.disabled = false;
    }
  });

  async function finishGmailConnection() {
    const url = new URL(location.href);
    if (!url.searchParams.has("state") || !(url.searchParams.has("code") || url.searchParams.has("error"))) return;
    let flow;
    try { flow = JSON.parse(sessionStorage.getItem(gmailFlowKey) || "null"); }
    catch { flow = null; }
    sessionStorage.removeItem(gmailFlowKey);
    history.replaceState(null, "", url.pathname);
    showView(flow?.readReplies ? "tracking" : "settings");
    try {
      if (!flow || flow.state !== url.searchParams.get("state") || Date.now() - flow.startedAt > 10 * 60 * 1000 ||
          !flow.userId || flow.userId !== getSession()?.user?.id) throw new Error("La demande de connexion Gmail a expiré. Réessayez.");
      if (url.searchParams.has("error")) throw new Error("Connexion Gmail annulée.");
      await invokeEdgeFunction("gmail-web", { action: "exchange", code: url.searchParams.get("code"), verifier: flow.verifier, readReplies: flow.readReplies === true });
      if (flow.readReplies) refreshReplies.click();
      else await loadGmail();
    } catch (error) {
      await loadGmail();
      (flow?.readReplies ? repliesStatus : gmailStatus).textContent = error.message;
    }
  }

  async function bootstrap() {
    await ensureSession();
    renderAccount();
    showView("dashboard");
    await finishGmailConnection();
    const url = new URL(location.href);
    if (url.searchParams.has("connexion")) {
      url.searchParams.delete("connexion");
      history.replaceState(null, "", url);
      if (appShell.hidden) dialog.showModal();
    }
    try { await loadDashboard(); }
    catch (error) {
      document.querySelector("#account-label").textContent = error.message;
    }
  }

  bootstrap();
})();
