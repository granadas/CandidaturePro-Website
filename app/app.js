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
    premium: ["Premium", "Votre formule et les conditions Premium"],
    support: ["Support", "Assistance Candidature Pro"],
    admin: ["Administration", "Liste noire, historique et crédits"],
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
    document.querySelector("#admin-nav").hidden = !(signedIn && profile?.is_admin === true);
    const email = session?.user?.email;
    const firstName = profile?.candidate_first_name?.trim();
    document.querySelector("#account-label").textContent = email || "Version web en préparation";
    document.querySelector("#first-name").textContent = firstName || (email ? email.split("@")[0] : "👋");
    loginButton.textContent = email ? "Mon compte" : "Se connecter";
    signOutButton.hidden = !email;

    const plan = String(profile?.plan || "free").toLowerCase();
    const isPremium = plan === "premium" || plan === "pro";
    document.querySelector("#cv-targeting").hidden = !hasPremiumCv();
    document.querySelectorAll("#cv-form [name=template] option:not([value=classic])").forEach(option => { option.disabled = !hasPremiumCv(); });
    document.querySelector("#current-plan").textContent = isPremium ? "Premium" : "Free";
    document.querySelector("#settings-account").textContent = email
      ? email + (profile ? " · " + (isPremium ? "Premium" : "Free") : "")
      : "Connectez-vous pour accéder à votre compte.";
    document.querySelector("#premium-plan").textContent = "Formule actuelle · " + (isPremium ? "Premium" : "Free");
    document.querySelector("#plan-detail").textContent = isPremium ? "Candidatures illimitées" : "5 candidatures par mois";
  }

  function showView(name, syncReplies = true) {
    if (appShell.hidden || (name === "admin" && profile?.is_admin !== true)) return;
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
    document.querySelector("#premium-view").classList.toggle("active", name === "premium");
    document.querySelector("#support-view").classList.toggle("active", name === "support");
    document.querySelector("#admin-view").classList.toggle("active", name === "admin");
    if (name === "admin") loadAdmin();
    document.querySelector("#settings-view").classList.toggle("active", name === "settings");
    document.querySelectorAll(".nav-item[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));

    const [title, subtitle] = titles[name] || ["Candidature Pro", "Espace en ligne"];
    document.querySelector("#page-title").textContent = title;
    document.querySelector("#account-label").dataset.pageSubtitle = subtitle;
    if (!getSession()) document.querySelector("#account-label").textContent = subtitle;

    if (isDashboard) ensureSession().then(session => session && updateTrackingCounts(session)).catch(() => {});
    if (isProfile) renderProfile();
    if (isApplications) loadApplications();
    if (isCompanies) renderCompanies();
    if (isJobs) loadJobs();
    if (isTracking) {
      loadTracking();
      if (syncReplies) syncGmailRepliesAutomatically();
    }
    if (isDocuments) { loadDocuments(); loadCvVariants(); }
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
    if (!response.ok) throw new Error(result.message || result.error || "Le service est indisponible.");
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
    const filter = document.querySelector("#applications-filter").value;
    updateBatchSelection();
    const visible = applications.filter(row => !filter || (filter === "sent"
      ? Boolean(row.sent_at) || ["sent", "reply_received", "interview", "accepted", "rejected"].includes(row.status)
      : row.status === filter));
    if (!visible.length) {
      if (filter) {
        list.textContent = "Aucun dossier pour ce filtre.";
        return;
      }
      list.innerHTML = '<div class="empty-list"><strong>Aucune candidature enregistrée</strong><span>Ajoutez votre premier dossier avec le formulaire.</span></div>';
      return;
    }

    const statusOptions = Object.entries(statusLabels)
      .map(([value, label]) => '<option value="' + value + '">' + label + '</option>')
      .join("");

    const priority = row => row.status === "ready" && !row.hidden_at ? 0 : 1;
    visible.sort((first, second) => priority(first) - priority(second));
    list.innerHTML = visible.map(application => {
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
        sourceLink +
        (!hidden && hasPremiumCv() ? '<button type="button" class="secondary compact" data-action="adapt-cv">Adapter le CV</button>' : '') +
        '</div>' +
        (!hidden && application.status === "ready" && application.company_email && !application.sent_at
          ? '<div><label><input type="checkbox" data-batch-choice ' + (batchSelection.has(application.id) ? 'checked' : '') +
            '> Sélectionner</label><button class="secondary compact" data-action="send">Préparer l’envoi</button></div>' : '') +
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
  const replyEditor = document.querySelector("#reply-editor");
  const replyDraft = document.querySelector("#reply-draft");
  const replyEditorStatus = document.querySelector("#reply-editor-status");
  const replyGenerate = document.querySelector("#reply-generate");
  const replySend = document.querySelector("#reply-send");
  let replyContext = null;
  let replyRequest = 0;

  replyDialog.addEventListener("close", () => {
    ++replyRequest;
    replyContext = null;
    replyDraft.value = "";
    replyEditorStatus.textContent = "";
    replyContent.replaceChildren();
    replyGmail.removeAttribute("href");
  });

  replyGenerate.addEventListener("click", async () => {
    const context = replyContext;
    const before = replyDraft.value;
    if (!context || replyGenerate.disabled) return;
    replyGenerate.disabled = true;
    replyEditorStatus.textContent = "Génération en cours…";
    try {
      const result = await invokeEdgeFunction("smart-reply", {
        mode: "reply", companyName: context.companyName, jobTitle: context.jobTitle,
        originalSubject: "", replySubject: "", replyBody: context.body,
        classification: "Réponse reçue",
        candidateName: [profile?.candidate_first_name, profile?.candidate_last_name].filter(Boolean).join(" ") || "le candidat"
      });
      if (replyContext !== context || !replyDialog.open || getSession()?.user?.id !== context.userId) return;
      if (replyDraft.value !== before) {
        replyEditorStatus.textContent = "Vos modifications ont été conservées.";
        return;
      }
      if (typeof result.reply !== "string" || !result.reply.trim() || result.reply.length > 12000) {
        throw new Error("La proposition est vide ou dépasse la taille autorisée.");
      }
      replyDraft.value = result.reply.trim();
      replyEditorStatus.textContent = "Proposition prête à modifier.";
    } catch (error) {
      if (replyContext === context) replyEditorStatus.textContent = error.message;
    } finally {
      replyGenerate.disabled = false;
    }
  });

  replySend.addEventListener("click", async () => {
    const context = replyContext;
    const message = replyDraft.value.trim();
    if (!context?.replyTo || replySend.disabled) return;
    if (!message) { replyEditorStatus.textContent = "Rédigez votre réponse."; return; }
    if (!window.confirm("Envoyer cette réponse à " + context.replyTo.recipient + " ?")) return;
    replySend.disabled = true;
    context.requestId ||= crypto.randomUUID();
    try {
      const result = await invokeEdgeFunction("gmail-web", { action: "send_reply",
        applicationId: context.applicationId, replyId: context.replyTo.id, recipient: context.replyTo.recipient, requestId: context.requestId, message });
      if (replyContext !== context) return;
      if (result.sent !== true) throw new Error("Gmail n’a pas confirmé l’envoi.");
      replyDraft.value = "";
      context.requestId = null;
      replyEditorStatus.textContent = "Réponse envoyée dans le fil Gmail.";
    } catch (error) {
      if (replyContext === context) replyEditorStatus.textContent = error.message;
    } finally {
      replySend.disabled = false;
    }
  });

  document.querySelector("#reply-copy").addEventListener("click", async () => {
    if (!replyDraft.value.trim()) {
      replyEditorStatus.textContent = "Écrivez une réponse avant de la copier.";
      return;
    }
    try {
      await navigator.clipboard.writeText(replyDraft.value);
      replyEditorStatus.textContent = "Texte copié. Ouvrez le fil Gmail pour répondre.";
    } catch {
      replyDraft.select();
      replyEditorStatus.textContent = "Copiez le texte sélectionné, puis ouvrez le fil Gmail.";
    }
  });

  replyConsent.addEventListener("click", () => startGmailConnection(replyConsent, true));

  function gmailHtmlToText(html) {
    if (typeof html !== "string" || !html) return "";
    const template = document.createElement("template");
    template.innerHTML = html;
    template.content.querySelectorAll("script, style, noscript, svg, math, iframe, object, template, head, [hidden], [aria-hidden='true']")
      .forEach(element => element.remove());
    template.content.querySelectorAll("br").forEach(element => element.replaceWith("\n"));
    template.content.querySelectorAll("p, div, li, tr, blockquote, h1, h2, h3, h4, h5, h6")
      .forEach(element => element.append("\n"));
    return (template.content.textContent || "").replace(/\n[ \t]*\n(?:[ \t]*\n)*/g, "\n\n").trim();
  }

  document.querySelector("#tracking-list").addEventListener("click", async event => {
    const button = event.target.closest("[data-open-reply]");
    if (!button || button.disabled) return;
    const userId = getSession()?.user?.id;
    button.disabled = true;
    const request = ++replyRequest;
    replyContext = null;
    replyEditor.hidden = true;
    replySend.hidden = true;
    replyEditor.open = false;
    replyDraft.value = "";
    replyEditorStatus.textContent = "";
    replyGmail.hidden = true;
    replyConsent.hidden = true;
    replyContent.textContent = "Chargement…";
    replyDialog.showModal();
    try {
      const result = await invokeEdgeFunction("gmail-web", {
        action: "open_reply", applicationId: button.dataset.openReply, preview: true
      });
      if (request !== replyRequest || !replyDialog.open || !userId || getSession()?.user?.id !== userId) return;
      replyGmail.href = "https://mail.google.com/mail/u/0/#all/" + encodeURIComponent(result.threadId);
      replyGmail.hidden = false;
      replyConsent.hidden = !result.needsConsent;
      const previews = Array.isArray(result.previewMessages) ? result.previewMessages :
        (result.replies || []).map(text => ({ text }));
      const replies = previews.map(item => (item.text.trim() || gmailHtmlToText(item.html)).slice(0, 30000))
        .filter(Boolean);
      if (replies.length) {
        const application = button.closest(".application-row");
        replyContext = { userId, applicationId: button.dataset.openReply, replyTo: result.replyTo, body: replies.at(-1).slice(0, 8000),
          companyName: application.querySelector(".application-main strong").textContent,
          jobTitle: application.querySelector(".application-main span").textContent };
        replyEditor.hidden = false;
        replySend.hidden = !result.replyTo;
      }
      replyContent.textContent = result.needsConsent ? "Autorisez la lecture pour afficher le message ici." :
        replies.length ? "" : "Le contenu de ce message est disponible dans Gmail.";
      for (const reply of replies) {
        const content = reply.replace(/\r\n?/g, "\n").trim();
        const quoted = /\n(?:_{8,}|-{3,}\s*(?:Original Message|Message d’origine)\s*-{3,}|On .+ wrote:|Le .+ a écrit\s*:|From:.*\nSent:|De :.*\nEnvoyé :)/i.exec(content);
        const split = quoted && quoted.index > 0 ? quoted.index : content.length;
        const message = document.createElement("article");
        message.className = "reply-message";
        const body = document.createElement("p");
        body.textContent = content.slice(0, split).trim();
        message.append(body);
        if (split < content.length) {
          const history = document.createElement("details");
          const caption = document.createElement("summary");
          caption.textContent = "Afficher l’historique cité";
          const quote = document.createElement("p");
          quote.textContent = content.slice(split).trim();
          history.append(caption, quote);
          message.append(history);
        }
        replyContent.append(message);
      }
      if (replies.length && result.latestInboundAt) {
        const id = button.dataset.openReply;
        try {
          const date = encodeURIComponent(result.latestInboundAt);
          await supabaseWrite("user_applications?id=eq." + encodeURIComponent(id) +
            "&or=(last_reply_read_at.is.null,last_reply_read_at.lt." + date + ")", "PATCH",
            { last_reply_read_at: result.latestInboundAt });
          if (getSession()?.user?.id === userId) await loadTracking();
        } catch {
          if (request === replyRequest && replyDialog.open) {
            replyEditorStatus.textContent = "La lecture n’a pas pu être enregistrée.";
          }
        }
      }
    } catch (error) {
      if (request === replyRequest && getSession()?.user?.id === userId) replyContent.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const trackingDateFormat = new Intl.DateTimeFormat("fr-CH", { dateStyle: "medium" });

  let trackingRows = [];
  const followupDialog = document.querySelector("#followup-dialog");
  const followupForm = document.querySelector("#followup-form");
  const followupStatus = document.querySelector("#followup-status");
  const followupClose = document.querySelector("#followup-close");
  const followupConfirm = document.querySelector("#followup-confirm");
  const followupDrafts = document.querySelector("#followup-drafts");
  let followupRows = [];

  document.querySelector("#followup-batch").addEventListener("click", () => {
    const selection = new Set([...document.querySelectorAll("[data-followup-choice]:checked")].map(input => input.value));
    followupRows = trackingRows.filter(row => selection.has(row.id));
    if (!followupRows.length) {
      document.querySelector("#tracking-message").textContent = "Sélectionnez les dossiers à relancer.";
      return;
    }
    followupDrafts.replaceChildren();
    for (const row of followupRows) {
      const label = document.createElement("label");
      label.textContent = row.company_name + " · " + row.company_email;
      const message = document.createElement("textarea");
      message.value = "Bonjour,\n\nJe me permets de revenir vers vous au sujet de ma candidature" +
        (row.job_title ? " pour le poste de " + row.job_title : "") +
        ". Je reste à votre disposition pour tout complément.\n\nCordialement,";
      message.required = true;
      message.maxLength = 12000;
      message.rows = 5;
      label.append(message);
      followupDrafts.append(label);
    }
    followupStatus.textContent = "";
    followupConfirm.hidden = false;
    followupDialog.showModal();
  });

  followupClose.addEventListener("click", () => followupDialog.close());
  followupDialog.addEventListener("cancel", event => {
    if (followupConfirm.disabled) event.preventDefault();
  });
  followupForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (followupConfirm.disabled || followupConfirm.hidden) return;
    const userId = getSession()?.user?.id;
    if (!userId) return;
    const messages = [...followupDrafts.querySelectorAll("textarea")].map(input => input.value.trim());
    if (messages.some(message => !message)) {
      followupStatus.textContent = "Renseignez le texte de chaque relance.";
      return;
    }
    const rows = [...followupRows];
    followupConfirm.disabled = followupClose.disabled = true;
    followupDrafts.querySelectorAll("textarea").forEach(input => { input.readOnly = true; });
    const results = [];
    try {
      for (const [index, row] of rows.entries()) {
        if (getSession()?.user?.id !== userId) break;
        followupStatus.textContent = "Relance " + (index + 1) + " sur " + rows.length + "…";
        try {
          const response = await invokeEdgeFunction("gmail-web", { action: "send_followup",
            applicationId: row.id, recipient: row.company_email, requestId: crypto.randomUUID(), message: messages[index] });
          if (response.sent !== true) throw new Error("Gmail n’a pas confirmé l’envoi.");
          results.push(row.company_name + (response.tracked === false
            ? " · Relance envoyée, mise à jour du suivi indisponible" : " · Relance envoyée"));
        } catch (error) {
          results.push(row.company_name + " · " + error.message);
        }
      }
      followupStatus.textContent = results.join("\n");
      await loadTracking();
    } finally {
      followupConfirm.hidden = true;
      followupConfirm.disabled = followupClose.disabled = false;
    }
  });

  const trackingSearch = document.querySelector("#tracking-search");
  const trackingFilter = document.querySelector("#tracking-filter");
  const trackingHidden = document.querySelector("#tracking-hidden");
  const trackingList = document.querySelector("#tracking-list");
  const trackingMessage = document.querySelector("#tracking-message");
  const trackingText = value => (value || "").normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

  function canFollowUp(row) {
    return row.status === "sent" && row.company_email && !row.last_inbound_at && row.sent_at && !row.hidden_at;
  }

  function followUpDue(row) {
    if (!canFollowUp(row)) return false;
    const due = new Date(row.next_follow_up_at || row.last_follow_up_sent_at || row.sent_at);
    if (!row.next_follow_up_at) due.setDate(due.getDate() + row.follow_up_delay_days);
    const today = new Date();
    today.setHours(23, 59, 59, 999);
    return due <= today;
  }

  function hasUnreadReply(row) {
    return Boolean(row.last_inbound_at &&
      (!row.last_reply_read_at || Date.parse(row.last_inbound_at) > Date.parse(row.last_reply_read_at)));
  }

  function recommendedTrackingAction(row) {
    if (row.hidden_at) return "";
    if (hasUnreadReply(row)) return "Lire la nouvelle réponse";
    if (row.status === "interview") return "Préparer l’entretien";
    if (followUpDue(row)) return "Préparer une relance";
    if (row.status === "reply_received" && row.last_human_reply_at) return "Vérifier si une réponse est nécessaire";
    return "";
  }

  function applyTrackingFilters() {
    const query = trackingText(trackingSearch.value.trim());
    const filters = {
      unread: hasUnreadReply,
      action: recommendedTrackingAction,
      automatic: row => Boolean(row.last_automatic_reply_at),
      waiting: row => row.status === "sent" && !row.last_inbound_at,
      reply: row => Boolean(row.last_inbound_at) || row.status === "reply_received",
      interview: row => row.status === "interview",
      due: followUpDue
    };
    const matchesFilter = filters[trackingFilter.value] || (() => true);
    let visible = 0;
    trackingRows.forEach((row, index) => {
      const matchesSearch = trackingText(row.company_name + " " + (row.job_title || "")).includes(query);
      const item = trackingList.children[index];
      item.hidden = !(matchesSearch && matchesFilter(row));
      if (item.hidden) {
        const choice = item.querySelector("[data-followup-choice]");
        if (choice) choice.checked = false;
      } else visible++;
    });
    trackingMessage.textContent = visible ? "" : trackingRows.length ? "Aucun dossier ne correspond aux filtres." :
      trackingHidden.checked ? "Aucun dossier masqué." : "Les candidatures envoyées apparaîtront ici.";
  }

  trackingSearch.addEventListener("input", applyTrackingFilters);
  trackingFilter.addEventListener("change", applyTrackingFilters);
  trackingHidden.addEventListener("change", loadTracking);
  trackingList.addEventListener("click", async event => {
    const button = event.target.closest("[data-tracking-visibility]");
    if (!button || button.disabled) return;
    const row = trackingRows.find(item => item.id === button.dataset.trackingVisibility);
    if (!row) return;
    button.disabled = true;
    try {
      await supabaseWrite("user_applications?id=eq." + encodeURIComponent(row.id), "PATCH", {
        hidden_at: row.hidden_at ? null : new Date().toISOString()
      });
      await loadTracking();
    } catch (error) {
      trackingMessage.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  async function loadTracking() {
    const message = document.querySelector("#tracking-message");
    const list = document.querySelector("#tracking-list");
    const showHidden = trackingHidden.checked;
    const userId = getSession()?.user?.id;
    trackingRows = [];
    list.replaceChildren();
    if (!userId) {
      message.textContent = "Connectez-vous pour consulter le suivi.";
      return;
    }
    message.textContent = "Chargement…";
    try {
      const rows = await supabaseFetch(
        "user_applications?select=id,company_name,company_email,job_title,status,sent_at,next_follow_up_at,last_inbound_at,last_follow_up_sent_at,follow_up_delay_days,hidden_at,last_automatic_reply_at,last_human_reply_at,last_reply_read_at" +
        "&status=in.(sent,reply_received,interview,accepted,rejected)" +
        "&order=next_follow_up_at.asc.nullslast,last_activity_at.desc"
      );
      if (getSession()?.user?.id !== userId || trackingHidden.checked !== showHidden) return;
      const activeRows = rows.filter(row => !row.hidden_at);
      document.querySelector("#tracking-sent-count").textContent = activeRows.filter(row => row.sent_at).length;
      document.querySelector("#tracking-reply-count").textContent = activeRows.filter(row => row.last_human_reply_at).length;
      document.querySelector("#tracking-automatic-count").textContent = activeRows.filter(row => row.last_automatic_reply_at).length;
      document.querySelector("#tracking-interview-count").textContent = activeRows.filter(row => row.status === "interview").length;
      document.querySelector("#tracking-due-count").textContent = activeRows.filter(followUpDue).length;
      trackingRows = showHidden ? rows.filter(row => row.hidden_at) : activeRows;
      list.innerHTML = trackingRows.map(row => {
        const followUp = row.next_follow_up_at ? new Date(row.next_follow_up_at) : null;
        const localDate = followUp
          ? new Date(followUp.getTime() - followUp.getTimezoneOffset() * 60000).toISOString().slice(0, 10)
          : "";
        const action = recommendedTrackingAction(row);
        const overdue = followUp && followUp.getTime() < new Date().setHours(0, 0, 0, 0);
        return '<article class="application-row"><div class="application-main"><strong>' +
          escapeHtml(row.company_name) + '</strong><span>' +
          escapeHtml(row.job_title || "Candidature spontanée") + '</span><small>' +
          escapeHtml(statusLabels[row.status]) +
          (row.sent_at ? " · " + trackingDateFormat.format(new Date(row.sent_at)) : "") +
          (row.last_follow_up_sent_at ? " · Dernière relance le " + trackingDateFormat.format(new Date(row.last_follow_up_sent_at)) : "") +
          (overdue ? " · Relance en retard" : "") + '</small>' +
          (hasUnreadReply(row) ? '<strong class="badge">Non lue</strong>' : '') +
          (action ? '<p class="tracking-action">' + escapeHtml(action) + '</p>' : '') +
          (canFollowUp(row)
            ? '<label><input type="checkbox" data-followup-choice value="' + escapeHtml(row.id) + '"> Sélectionner pour relance</label>' : '') +
          (row.last_inbound_at ? '<button type="button" class="secondary compact" data-open-reply="' +
            escapeHtml(row.id) + '">Lire la réponse</button>' : '') +
          '<button type="button" class="secondary compact" data-tracking-visibility="' + escapeHtml(row.id) + '">' +
          (row.hidden_at ? "Réafficher" : "Masquer du suivi") + '</button></div>' +
          '<form class="application-form tracking-form" data-id="' + escapeHtml(row.id) + '">' +
          '<label>Date de relance<input name="follow-up" type="date" value="' + localDate + '"></label>' +
          '<label>Délai entre les relances (jours)<input name="follow-up-delay" type="number" required min="1" max="365" value="' + row.follow_up_delay_days + '"></label>' +
          '<button type="submit" class="secondary compact">Enregistrer</button></form></article>';
      }).join("");
      applyTrackingFilters();
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
        follow_up_delay_days: Number(form.elements.namedItem("follow-up-delay").value),
        next_follow_up_at: date ? new Date(date + "T12:00:00").toISOString() : null
      });
      await loadTracking();
    } catch (error) {
      document.querySelector("#tracking-message").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const adminMode = document.querySelector("#admin-mode");
  const adminStatus = document.querySelector("#admin-status");
  const adminResults = document.querySelector("#admin-results");
  const adminViews = {
    blacklist: ["admin_list_blacklisted_companies", {}],
    audit: ["admin_list_audit_log", { p_limit: 100 }],
    credits: ["admin_get_credit_usage_statistics", { p_month: null }],
    contacts: ["admin_list_company_email_change_requests", {}],
    invalid: ["admin_list_invalid_company_email_reports", {}],
    verification: ["admin_list_company_manual_verifications", {}],
    reports: ["admin_list_support_reports", {}],
    users: ["admin_list_users", { p_search: "" }]
  };
  let adminRequest = 0;

  function administrativeActions(mode, row, current) {
    const form = document.createElement("form");
    form.className = "profile-form";
    if (mode === "verification") {
      form.innerHTML = '<label>Adresse vérifiée<input name="email" type="email" maxlength="254"></label>' +
        '<label>Type de contact<select name="type"><option value="general">Général</option><option value="hr">RH</option></select></label>' +
        '<label class="wide">Note<input name="note" maxlength="2000"></label>' +
        '<div class="wide"><button type="submit" class="primary" value="email">Valider le contact</button> ' +
        '<button type="submit" class="secondary" value="inactive">Marquer fermée ou inexistante</button></div>';
    } else if (mode === "reports") {
      form.innerHTML = '<label>Statut<select name="status"><option value="new">Nouveau</option><option value="in_progress">En cours</option>' +
        '<option value="resolved">Résolu</option><option value="closed">Clôturé</option></select></label>' +
        '<div><button type="submit" class="primary">Enregistrer le statut</button></div>';
      form.elements.status.value = row.status;
    } else {
      form.innerHTML = '<label>Formule<select name="plan"><option value="free">Gratuite</option><option value="premium">Premium</option></select></label>' +
        '<label>Expiration Premium<input name="until" type="date"></label>' +
        '<div class="wide"><button type="submit" class="primary">Enregistrer la formule</button></div>';
      form.elements.plan.value = row.plan === "premium" ? "premium" : "free";
      form.elements.until.value = row.premium_until?.slice(0, 10) || "";
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!current() || profile?.is_admin !== true) return;
      const buttons = form.querySelectorAll("button");
      if ([...buttons].some(button => button.disabled)) return;
      const data = new FormData(form);
      const action = event.submitter?.value;
      const email = String(data.get("email") || "").trim();
      if (mode === "verification" && (!["email", "inactive"].includes(action) || (action === "email" && !email))) {
        adminStatus.textContent = "Indiquez une adresse vérifiée pour valider le contact.";
        return;
      }
      buttons.forEach(button => button.disabled = true);
      try {
        let done;
        if (mode === "verification") {
          done = await supabaseRpc("admin_resolve_company_manual_verification", {
            p_request_id: row.id, p_action: action, p_email: action === "email" ? email : "",
            p_contact_type: data.get("type"), p_admin_note: data.get("note")
          });
        } else if (mode === "reports") {
          done = await supabaseRpc("admin_update_support_report_status", { p_report_id: row.id, p_status: data.get("status") });
        } else {
          const premium = data.get("plan") === "premium";
          const until = data.get("until");
          await supabaseRpc("admin_set_user_premium", {
            p_user_id: row.user_id, p_premium: premium,
            p_premium_until: premium && until ? until + "T23:59:59Z" : null
          });
          done = true;
        }
        if (done !== true) throw new Error("La modification n’a pas été enregistrée.");
        if (current()) {
          await loadAdmin();
          if (getSession()?.user?.id && adminMode.value === mode && !adminStatus.textContent) {
            adminStatus.textContent = "Modification enregistrée.";
          }
        }
      } catch (error) {
        if (current()) adminStatus.textContent = error.message;
      } finally {
        buttons.forEach(button => button.disabled = false);
      }
    });
    return form;
  }

  async function loadAdmin() {
    if (profile?.is_admin !== true) return;
    const userId = getSession()?.user?.id;
    const request = ++adminRequest;
    const mode = adminMode.value;
    const [rpc, args] = adminViews[mode];
    adminResults.replaceChildren();
    adminStatus.textContent = "Chargement…";
    const current = () => request === adminRequest && getSession()?.user?.id === userId;
    try {
      const rows = await supabaseRpc(rpc, args);
      if (!current()) return;
      adminStatus.textContent = rows.length ? "" : "Aucun résultat.";
      for (const row of rows) {
        const card = document.createElement("article");
        card.className = "application-row";
        const title = document.createElement("strong");
        title.textContent = row.company_name || row.label || row.title || row.email || row.action || "";
        const details = document.createElement("p");
        details.textContent = mode === "blacklist" ? [row.city, row.inactive_reason].filter(Boolean).join(" · ") :
          mode === "audit" ? [row.summary, row.created_at].filter(Boolean).join(" · ") :
          mode === "credits" ? [row.category, row.credits + " crédits", row.estimated_cost_chf + " CHF", row.detail].filter(Boolean).join(" · ") :
          mode === "contacts" ? [row.city, row.current_email, row.proposed_email, row.reply_subject, row.reply_body].filter(Boolean).join(" · ") :
          mode === "invalid" ? [row.email, row.reason, row.reply_subject, row.reply_body].filter(Boolean).join(" · ") :
          mode === "verification" ? [row.city, row.address, row.website, row.status].filter(Boolean).join(" · ") :
          mode === "reports" ? [row.category, row.description, row.steps, row.status].filter(Boolean).join(" · ") :
          [row.plan, row.is_admin ? "Administrateur" : "", row.last_seen_at].filter(Boolean).join(" · ");
        card.append(title, details);
        if (mode === "blacklist") {
          const restore = document.createElement("form");
          restore.innerHTML = '<label>Contact vérifié<input required type="email" name="email" maxlength="254"></label>' +
            '<label>Type de contact<select name="type"><option value="general">Général</option><option value="hr">RH</option></select></label>' +
            '<label>Note<input name="note" maxlength="2000"></label>' +
            '<button class="secondary" type="submit">Retirer de la liste noire</button>';
          restore.addEventListener("submit", async event => {
            event.preventDefault();
            if (!current() || profile?.is_admin !== true) return;
            const data = new FormData(restore);
            const button = restore.querySelector("button");
            button.disabled = true;
            try {
              await supabaseRpc("admin_restore_blacklisted_company", {
                p_company_key: row.company_key, p_company_name: row.company_name, p_sector: row.sector || "",
                p_email: String(data.get("email")).trim(), p_contact_type: data.get("type"), p_admin_note: data.get("note")
              });
              if (current()) await loadAdmin();
            } catch (error) {
              if (current()) adminStatus.textContent = error.message;
            } finally {
              button.disabled = false;
            }
          });
          card.append(restore);
        }
        if (mode === "contacts" || mode === "invalid") {
          const review = document.createElement("form");
          review.innerHTML = '<label>Note administrateur<input name="note" maxlength="2000"></label>' +
            '<button type="submit" class="primary" value="approve">' +
            (mode === "contacts" ? "Approuver le changement" : "Confirmer l’adresse invalide") +
            '</button> <button type="submit" class="secondary" value="reject">Refuser</button>';
          review.addEventListener("submit", async event => {
            event.preventDefault();
            if (!event.submitter || !current() || profile?.is_admin !== true) return;
            const approved = event.submitter.value === "approve";
            const note = new FormData(review).get("note");
            const buttons = review.querySelectorAll("button");
            buttons.forEach(button => button.disabled = true);
            try {
              const done = mode === "contacts"
                ? await supabaseRpc("admin_review_company_email_change_request", { p_request_id: row.id, p_approve: approved, p_admin_note: note })
                : await supabaseRpc("admin_review_invalid_company_email_report", { p_report_id: row.id, p_confirm_invalid: approved, p_admin_note: note });
              if (done !== true) throw new Error("La décision n’a pas été enregistrée.");
              if (current()) await loadAdmin();
            } catch (error) {
              if (current()) adminStatus.textContent = error.message;
            } finally {
              buttons.forEach(button => button.disabled = false);
            }
          });
          card.append(review);
        }
        if (["verification", "reports", "users"].includes(mode)) {
          card.append(administrativeActions(mode, row, current));
        }
        adminResults.append(card);
      }
    } catch (error) {
      if (current()) adminStatus.textContent = error.message;
    }
  }

  adminMode.addEventListener("change", loadAdmin);
  document.querySelector("#admin-refresh").addEventListener("click", loadAdmin);

  const supportForm = document.querySelector("#support-report");
  supportForm.addEventListener("submit", async event => {
    event.preventDefault();
    const userId = getSession()?.user?.id;
    if (!userId) return;
    const button = supportForm.querySelector("button");
    if (button.disabled) return;
    const message = document.querySelector("#support-report-status");
    const data = new FormData(supportForm);
    const title = String(data.get("title")).trim();
    const description = String(data.get("description")).trim();
    if (!title || !description) {
      message.textContent = "Renseignez le titre et la description.";
      return;
    }
    button.disabled = true;
    message.textContent = "Enregistrement…";
    try {
      const receipt = await supabaseRpc("submit_support_report", {
        p_category: data.get("category"), p_title: title, p_description: description,
        p_steps: String(data.get("steps")).trim(), p_app_version: "Web", p_os_version: ""
      });
      if (getSession()?.user?.id !== userId) return;
      supportForm.reset();
      message.textContent = "Signalement reçu. Référence · " + receipt;
    } catch (error) {
      if (getSession()?.user?.id === userId) message.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const cvDialog = document.querySelector("#cv-dialog");
  const cvForm = document.querySelector("#cv-form");
  const cvVariants = document.querySelector("#cv-variants");
  const cvLabel = document.querySelector("#cv-label");
  const cvSaveStatus = document.querySelector("#cv-save-status");
  const cvFieldNames = ["name", "title", "contact", "summary", "experience", "education", "skills", "target", "offer", "template"];
  let savedCvVariants = [];
  let editingCvId = null;

  async function loadCvVariants() {
    const userId = getSession()?.user?.id;
    if (!userId) return;
    try {
      const rows = await supabaseFetch("web_cv_variants?select=id,label,fields&order=updated_at.desc&limit=200");
      if (getSession()?.user?.id !== userId) return;
      savedCvVariants = rows;
      cvVariants.length = 1;
      for (const row of rows) cvVariants.add(new Option(row.label, row.id));
      cvVariants.value = editingCvId || "";
    } catch (error) {
      if (getSession()?.user?.id === userId) cvSaveStatus.textContent = error.message;
    }
  }

  document.querySelector("#cv-load").addEventListener("click", () => {
    const variant = savedCvVariants.find(row => row.id === cvVariants.value);
    if (!variant) return;
    for (const name of cvFieldNames) cvForm.elements.namedItem(name).value = typeof variant.fields[name] === "string" ? variant.fields[name] : "";
    if (!cvForm.elements.template.value) cvForm.elements.template.value = "classic";
    cvLabel.value = variant.label;
    editingCvId = variant.id;
    document.querySelector("#cv-target-context").textContent = "";
    cvSaveStatus.textContent = "Variante ouverte.";
  });

  document.querySelector("#cv-new").addEventListener("click", () => {
    cvForm.reset();
    editingCvId = null;
    document.querySelector("#cv-target-context").textContent = "";
    document.querySelector("#cv-adapt-status").textContent = "";
    cvSaveStatus.textContent = "";
  });

  for (const [buttonId, copy] of [["cv-save", false], ["cv-save-copy", true]]) {
    document.querySelector("#" + buttonId).addEventListener("click", async () => {
      const userId = getSession()?.user?.id;
      if (!userId || cvForm.dataset.saving || !cvForm.reportValidity()) return;
      const fields = Object.fromEntries(cvFieldNames.map(name => [name, cvForm.elements.namedItem(name).value.trim()]));
      const label = cvLabel.value.trim() || fields.title;
      if (!label || !fields.name || !fields.title) {
        cvSaveStatus.textContent = "Renseignez le nom et le titre du CV.";
        return;
      }
      const id = copy ? null : editingCvId;
      cvForm.dataset.saving = "true";
      try {
        const rows = await supabaseWrite("web_cv_variants" + (id ? "?id=eq." + encodeURIComponent(id) : ""), id ? "PATCH" : "POST",
          { label, fields, updated_at: new Date().toISOString() });
        if (getSession()?.user?.id !== userId) return;
        if (!rows?.[0]?.id) throw new Error("La variante a été supprimée ou n’est plus accessible.");
        editingCvId = rows[0].id;
        cvSaveStatus.textContent = "Variante enregistrée.";
        await loadCvVariants();
      } catch (error) {
        if (getSession()?.user?.id === userId) cvSaveStatus.textContent = error.message;
      } finally {
        delete cvForm.dataset.saving;
      }
    });
  }

  function hasPremiumCv() {
    return String(profile?.plan || "").toLowerCase() === "premium" &&
      (!profile.premium_until || Date.parse(profile.premium_until) > Date.now());
  }

  document.querySelector("#cv-adapt").addEventListener("click", () => {
    if (!hasPremiumCv() || !getSession()?.user?.id) return;
    const status = document.querySelector("#cv-adapt-status");
    const { target, offer, skills, title } = cvForm.elements;
    const normalize = value => value.normalize("NFKD").replace(/\p{Diacritic}/gu, "")
      .toLocaleLowerCase("fr").replace(/[^\p{L}\p{N}+#.]+/gu, " ").trim();
    const offerText = " " + normalize(offer.value) + " ";
    const entries = skills.value.split(/\n+/).map(value => value.trim()).filter(Boolean);
    if (!offer.value.trim() || !entries.length) {
      status.textContent = "Collez l’offre et indiquez vos compétences, une par ligne.";
      return;
    }
    const matches = entries.filter(value => normalize(value) && offerText.includes(" " + normalize(value) + " "));
    const remainder = entries.filter(value => !matches.includes(value));
    skills.value = [...matches, ...remainder].join("\n");
    if (!title.value.trim() && target.value.trim()) title.value = target.value.trim();
    status.textContent = matches.length ? matches.length + " compétence(s) de votre CV placée(s) en premier." :
      "Aucune correspondance exacte. Vous pouvez ajuster votre CV avant l’aperçu.";
  });

  cvForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!getSession()?.user?.id) return;
    const data = new FormData(cvForm);
    const preview = document.querySelector("#cv-preview");
    preview.replaceChildren();
    preview.dataset.template = hasPremiumCv() ? String(data.get("template")) : "classic";
    const name = document.createElement("h1");
    name.textContent = String(data.get("name")).trim();
    const title = document.createElement("p");
    title.textContent = [data.get("title"), data.get("contact")].map(value => String(value).trim()).filter(Boolean).join(" · ");
    preview.append(name, title);
    for (const [key, label] of [["summary", "Profil"], ["experience", "Expériences"], ["education", "Formation"], ["skills", "Compétences et langues"]]) {
      const value = String(data.get(key)).trim();
      if (!value) continue;
      const heading = document.createElement("h2");
      heading.textContent = label;
      const paragraph = document.createElement("p");
      paragraph.textContent = value;
      preview.append(heading, paragraph);
    }
    cvDialog.showModal();
  });
  document.querySelector("#cv-print").addEventListener("click", () => window.print());

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

  async function listDocuments(session) {
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
    return groups.flat();
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
      const files = await listDocuments(session);
      if (request !== documentsRequest || getSession()?.user?.id !== session.user.id) return;
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

  async function updateTrackingCounts(session) {
    const queries = {
      replies: "last_inbound_at=not.is.null",
      followups: "next_follow_up_at=not.is.null&status=in.(sent,reply_received,interview)",
      interviews: "status=eq.interview"
    };
    await Promise.all(Object.entries(queries).map(async ([key, filter]) => {
      const node = document.querySelector("#stat-" + key);
      try {
        const response = await fetch(config.supabaseUrl + "/rest/v1/user_applications?select=id&limit=1&hidden_at=is.null&" + filter, {
          method: "HEAD",
          headers: {
            apikey: config.supabasePublishableKey,
            Authorization: "Bearer " + session.access_token,
            Prefer: "count=exact"
          }
        });
        const count = response.headers.get("content-range")?.split("/").at(-1);
        if (getSession()?.user?.id === session.user.id) node.textContent = response.ok && /^\d+$/.test(count || "") ? count : "—";
      } catch {
        if (getSession()?.user?.id === session.user.id) node.textContent = "—";
      }
    }));
  }

  async function loadDashboard() {
    const session = await ensureSession();
    if (!session?.user?.id) {
      profile = null;
      renderAccount();
      for (const node of document.querySelectorAll("[id^=stat-]")) node.textContent = "0";
      return;
    }

    const userId = encodeURIComponent(session.user.id);
    const month = currentMonthStart();
    const [profiles, usage] = await Promise.all([
      supabaseFetch("profiles?id=eq." + userId + "&select=candidate_first_name,candidate_last_name,candidate_email,plan,premium_until,is_admin"),
      supabaseFetch("candidature_usage?user_id=eq." + userId + "&month_start=eq." + month + "&select=application_key")
    ]);

    if (getSession()?.user?.id !== session.user.id) return;
    profile = Array.isArray(profiles) ? profiles[0] || null : null;
    document.querySelector("#stat-sent").textContent = String(Array.isArray(usage) ? usage.length : 0);
    const hasProfile = Boolean(profile?.candidate_first_name && profile?.candidate_last_name);
    document.querySelector("#setup-progress").textContent = hasProfile ? "2/4" : "1/4";
    renderAccount();
    renderProfile();
    await updateTrackingCounts(session);
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

  document.querySelector("#applications-filter").addEventListener("change", renderApplications);
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
    if (action === "adapt-cv") {
      const id = event.target.closest("[data-id]")?.dataset.id;
      const dossier = applications.find(row => row.id === id);
      if (!dossier || !hasPremiumCv()) return;
      showView("documents");
      cvForm.elements.target.value = dossier.job_title || "";
      cvForm.elements.offer.value = "";
      document.querySelector("#cv-adapt-status").textContent = "";
      document.querySelector("#cv-target-context").textContent = [dossier.company_name, dossier.job_title].filter(Boolean).join(" · ");
      document.querySelector("#cv-targeting").open = true;
      cvForm.elements.target.focus();
      return;
    }
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
    if (replyDialog.open) replyDialog.close();
    cancelBatch();
    batchSelection.clear();
    ++documentsRequest;
    ++adminRequest;
    adminResults.replaceChildren();
    cvForm.reset();
    savedCvVariants = [];
    editingCvId = null;
    cvVariants.length = 1;
    cvSaveStatus.textContent = "";
    document.querySelector("#cv-target-context").textContent = "";
    document.querySelector("#cv-adapt-status").textContent = "";
    supportForm.reset();
    document.querySelector("#support-report-status").textContent = "";
    document.querySelector("#cv-preview").replaceChildren();
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

  const batchSelection = new Set();
  let batchQueue = [];
  let batchSize = 0;
  let batchDrafts = [];
  const batchDialog = document.querySelector("#batch-dialog");
  const batchConfirm = document.querySelector("#batch-confirm");
  const batchStatus = document.querySelector("#batch-status");
  const batchStart = document.querySelector("#batch-start");
  const batchProgress = document.querySelector("#batch-progress");

  function readyForBatch(row) {
    return row && row.status === "ready" && row.company_email && !row.hidden_at && !row.sent_at;
  }

  function updateBatchSelection() {
    for (const id of batchSelection) {
      if (!readyForBatch(applications.find(row => row.id === id))) batchSelection.delete(id);
    }
    batchStart.disabled = !batchSelection.size;
    batchStart.textContent = batchSelection.size ? "Préparer la sélection (" + batchSelection.size + ")" : "Préparer la sélection";
  }

  document.querySelector("#applications-list").addEventListener("change", event => {
    if (!event.target.matches("[data-batch-choice]")) return;
    const id = event.target.closest("[data-id]").dataset.id;
    if (event.target.checked) batchSelection.add(id);
    else batchSelection.delete(id);
    updateBatchSelection();
  });

  document.querySelector("#batch-select").addEventListener("click", () => {
    document.querySelectorAll("#applications-list [data-batch-choice]").forEach(input => {
      batchSelection.add(input.closest("[data-id]").dataset.id);
    });
    renderApplications();
  });

  function nextBatchApplication() {
    while (batchQueue.length) {
      const id = batchQueue.shift();
      if (readyForBatch(applications.find(row => row.id === id))) {
        openSendDialog(id);
        return;
      }
    }
    batchSize = 0;
    if (!batchDrafts.length) return;
    const recipients = document.querySelector("#batch-recipients");
    recipients.replaceChildren();
    for (const draft of batchDrafts) {
      const item = document.createElement("li");
      item.textContent = draft.recipient + " · " + draft.subject;
      recipients.append(item);
    }
    batchStatus.textContent = "";
    batchConfirm.hidden = false;
    batchDialog.showModal();
  }

  document.querySelector("#batch-cancel").addEventListener("click", () => batchDialog.close());
  batchDialog.addEventListener("cancel", event => {
    if (batchConfirm.disabled) event.preventDefault();
  });
  batchDialog.addEventListener("close", cancelBatch);
  document.querySelector("#batch-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (batchConfirm.disabled || batchConfirm.hidden) return;
    const userId = getSession()?.user?.id;
    if (!userId) return;
    const close = document.querySelector("#batch-cancel");
    batchConfirm.disabled = close.disabled = true;
    const outcomes = [];
    const uniqueDrafts = [...batchDrafts];
    try {
      for (const draft of uniqueDrafts) {
        if (getSession()?.user?.id !== userId) break;
        batchStatus.textContent = "Envoi " + (outcomes.length + 1) + " sur " + uniqueDrafts.length + "…";
        try {
          const attachments = await encodeSendFiles(draft.files);
          if (getSession()?.user?.id !== userId) break;
          await invokeEdgeFunction("gmail-web", { action: "send", applicationId: draft.applicationId,
            recipient: draft.recipient, subject: draft.subject, message: draft.message, attachments });
          batchSelection.delete(draft.applicationId);
          outcomes.push(draft.recipient + " · Envoyée");
        } catch (error) {
          outcomes.push(draft.recipient + " · " + error.message);
        }
      }
      batchStatus.replaceChildren(...outcomes.map(line => {
        const result = document.createElement("div");
        result.textContent = line;
        return result;
      }));
      await Promise.allSettled([loadApplications(), loadDashboard()]);
    } finally {
      batchConfirm.hidden = true;
      batchConfirm.disabled = close.disabled = false;
    }
  });

  batchStart.addEventListener("click", () => {
    updateBatchSelection();
    batchDrafts = [];
    batchQueue = [...batchSelection];
    batchSize = batchQueue.length;
    nextBatchApplication();
  });

  const sendDialog = document.querySelector("#send-dialog");
  const sendForm = document.querySelector("#send-form");
  const sendSubmit = document.querySelector("#send-submit");
  const sendStatus = document.querySelector("#send-status");
  let sendApplication = null;
  let reviewed = null;
  const sendAi = document.querySelector("#send-ai");
  const sendAiButton = document.querySelector("#send-ai-generate");

  sendAiButton.addEventListener("click", async () => {
    const dossier = sendApplication;
    const userId = getSession()?.user?.id;
    const message = document.querySelector("#send-message");
    const initialMessage = message.value;
    const summary = document.querySelector("#send-ai-cv").value.trim();
    const jobOffer = document.querySelector("#send-ai-offer").value.trim();
    if (!dossier || !userId || !summary) {
      sendStatus.textContent = "Indiquez votre expérience et vos compétences pour préparer la lettre.";
      return;
    }
    sendAiButton.disabled = true;
    sendStatus.textContent = "Génération en cours…";
    try {
      const result = await invokeEdgeFunction("generate-motivation-letter", {
        company: dossier.company_name, jobTitle: dossier.job_title || "", city: dossier.company_city || "",
        jobOffer, cv: { summary }
      });
      if (!sendDialog.open || sendApplication !== dossier || getSession()?.user?.id !== userId || reviewed) return;
      if (message.value !== initialMessage) {
        sendStatus.textContent = "Le message a été modifié pendant la génération. Vos modifications sont conservées.";
        return;
      }
      if (typeof result.letter !== "string" || !result.letter.trim() || result.letter.length > 12000) {
        throw new Error("La lettre générée est vide ou dépasse la taille autorisée.");
      }
      message.value = result.letter.trim();
      sendStatus.textContent = "Lettre ajoutée. Tu peux la modifier avant le contrôle final.";
    } catch (error) {
      if (sendDialog.open && sendApplication === dossier && getSession()?.user?.id === userId) sendStatus.textContent = error.message;
    } finally {
      sendAiButton.disabled = false;
    }
  });

  const sendReview = document.querySelector("#send-review");
  const sendTitle = document.querySelector("#send-title");
  const sendInputs = ["subject", "message", "files"].map(name => document.querySelector("#send-" + name));

  const librarySelect = document.querySelector("#send-library");
  const libraryAdd = document.querySelector("#send-add-document");
  const librarySummary = document.querySelector("#send-selected-documents");
  let libraryFiles = [];
  let selectedDocuments = [];

  async function loadSendDocuments(dossier) {
    const session = await ensureSession();
    if (!session) return;
    const files = await listDocuments(session);
    if (!sendDialog.open || sendApplication !== dossier || getSession()?.user?.id !== session.user.id) return;
    libraryFiles = files;
    for (const [index, file] of files.entries()) {
      librarySelect.add(new Option(file.label + " · " + file.name.replace(/^[a-f0-9-]{36}_/, ""), index));
    }
  }

  librarySelect.addEventListener("change", () => { libraryAdd.disabled = !librarySelect.value; });
  libraryAdd.addEventListener("click", async () => {
    const option = librarySelect.selectedOptions[0];
    const documentFile = libraryFiles[option?.value];
    const dossier = sendApplication;
    if (!documentFile || selectedDocuments.length >= 2) return;
    libraryAdd.disabled = true;
    librarySelect.disabled = true;
    try {
      const session = await ensureSession();
      if (!session) return;
      const response = await documentRequest(session, "authenticated/" + documentsBucket + "/" +
        documentFile.prefix + "/" + encodeURIComponent(documentFile.name));
      const blob = await response.blob();
      if (!sendDialog.open || sendApplication !== dossier || reviewed || getSession()?.user?.id !== session.user.id) return;
      const name = documentFile.name.replace(/^[a-f0-9-]{36}_/, "");
      selectedDocuments.push(new File([blob], name, { type: "application/pdf" }));
      librarySummary.textContent = "Retirer les PDF ajoutés (" + selectedDocuments.map(file => file.name).join(", ") + ")";
      librarySummary.hidden = false;
      option.disabled = true;
      librarySelect.value = "";
    } catch (error) {
      if (sendDialog.open && sendApplication === dossier) sendStatus.textContent = error.message;
    } finally {
      if (sendApplication === dossier) {
        librarySelect.disabled = false;
        libraryAdd.disabled = !librarySelect.value || selectedDocuments.length >= 2;
      }
    }
  });

  librarySummary.addEventListener("click", () => {
    selectedDocuments = [];
    librarySummary.textContent = "";
    librarySummary.hidden = true;
    for (const option of librarySelect.options) option.disabled = false;
    libraryAdd.disabled = !librarySelect.value;
  });

  function editSendDraft() {
    reviewed = null;
    sendReview.hidden = true;
    sendAi.hidden = false;
    librarySelect.closest("label").hidden = false;
    libraryAdd.hidden = false;
    librarySummary.hidden = selectedDocuments.length === 0;
    for (const input of sendInputs) {
      input.disabled = false;
      input.closest("label").hidden = false;
    }
    sendTitle.textContent = "Préparer l’envoi";
    sendSubmit.textContent = "Contrôle final";
    sendStatus.textContent = "";
  }

  document.querySelector("#send-edit").addEventListener("click", () => {
    editSendDraft();
    sendInputs[0].focus();
  });

  function openSendDialog(id) {
    const dossier = applications.find(application => application.id === id);
    if (!dossier?.company_email || !getSession()?.user?.id) return;
    sendApplication = dossier;
    batchProgress.hidden = !batchSize;
    batchProgress.textContent = batchSize ? "Dossier " + (batchSize - batchQueue.length) + " sur " + batchSize : "";
    sendForm.reset();
    libraryFiles = [];
    selectedDocuments = [];
    librarySelect.length = 1;
    librarySelect.disabled = false;
    libraryAdd.disabled = true;
    librarySummary.textContent = "";
    librarySummary.hidden = true;
    sendAi.open = false;
    editSendDraft();
    sendSubmit.disabled = false;
    sendStatus.textContent = "";
    document.querySelector("#send-recipient").textContent = "Destinataire · " + dossier.company_email;
    document.querySelector("#send-subject").value =
      (dossier.job_title ? "Candidature – " + dossier.job_title : "Candidature spontanée").slice(0, 120);
    sendDialog.showModal();
    loadSendDocuments(dossier).catch(() => {
      if (sendDialog.open && sendApplication === dossier && !reviewed) {
        sendStatus.textContent = "Documents indisponibles. Vous pouvez joindre un PDF depuis votre appareil.";
      }
    });
  }

  function cancelBatch() {
    batchQueue = [];
    batchDrafts = [];
    batchSize = 0;
  }

  document.querySelector("#send-cancel").addEventListener("click", () => {
    cancelBatch();
    sendDialog.close();
  });
  sendDialog.addEventListener("cancel", event => {
    if (sendSubmit.disabled) event.preventDefault();
    else cancelBatch();
  });
  sendForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (sendSubmit.disabled || !sendApplication) return;
    const userId = getSession()?.user?.id;
    if (!reviewed) {
      const [subject, message, fileInput] = sendInputs;
      const draft = { subject: subject.value.trim(), message: message.value.trim(), files: [...fileInput.files, ...selectedDocuments] };
      if (!draft.subject || !draft.message) {
        sendStatus.textContent = "Renseignez l’objet et le message.";
        return;
      }
      if (draft.files.length > 2 || draft.files.some(file => !/\.pdf$/i.test(file.name)) ||
          draft.files.reduce((total, file) => total + file.size, 0) > 5 * 1024 * 1024) {
        sendStatus.textContent = "Choisissez au maximum deux PDF de 5 Mo au total.";
        return;
      }
      reviewed = draft;
      for (const input of sendInputs) {
        input.disabled = true;
        input.closest("label").hidden = true;
      }
      document.querySelector("#send-preview-subject").textContent = draft.subject;
      document.querySelector("#send-preview-message").textContent = draft.message;
      document.querySelector("#send-preview-files").textContent = draft.files.length
        ? "Pièces jointes · " + draft.files.map(file => file.name).join(", ")
        : "Aucune pièce jointe";
      sendStatus.textContent = "";
      sendTitle.textContent = "Contrôle final";
      sendSubmit.textContent = batchSize ? "Valider ce dossier pour le lot" : "Confirmer l’envoi via Gmail";
      sendAi.hidden = true;
      librarySelect.closest("label").hidden = true;
      libraryAdd.hidden = true;
      librarySummary.hidden = true;
      sendReview.hidden = false;
      sendReview.focus();
      return;
    }
    const draft = reviewed;
    const application = sendApplication;
    if (batchSize) {
      batchDrafts.push({ ...draft, applicationId: application.id, recipient: application.company_email });
      sendDialog.close();
      nextBatchApplication();
      return;
    }
    const editButton = document.querySelector("#send-edit");
    editButton.disabled = true;
    sendSubmit.disabled = true;
    document.querySelector("#send-cancel").disabled = true;
    sendStatus.textContent = "Envoi en cours…";
    try {
      const attachments = await encodeSendFiles(draft.files);
      if (!userId || getSession()?.user?.id !== userId) return;
      await invokeEdgeFunction("gmail-web", {
        action: "send", attachments, applicationId: application.id, recipient: application.company_email,
        subject: draft.subject, message: draft.message
      });
      if (getSession()?.user?.id !== userId) return;
      batchSelection.delete(application.id);
      sendDialog.close();
      await Promise.all([loadApplications(), loadDashboard().catch(() => {})]);
      if (getSession()?.user?.id !== userId) return;
      document.querySelector("#applications-message").textContent = "Candidature envoyée via Gmail.";
      nextBatchApplication();
    } catch (error) {
      if (getSession()?.user?.id === userId) sendStatus.textContent = error.message;
    } finally {
      sendSubmit.disabled = false;
      editButton.disabled = false;
      document.querySelector("#send-cancel").disabled = false;
    }
  });

  async function encodeSendFiles(files) {
    return Promise.all(files.map(async file => {
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
  }

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

  const gmailSyncInterval = 5 * 60 * 1000;
  let lastGmailSync = 0;
  let lastGmailSyncUser = null;
  let gmailSyncRunning = false;

  const trackingVisible = () => !appShell.hidden && !document.hidden &&
    document.querySelector("#tracking-view").classList.contains("active");

  function syncGmailRepliesAutomatically() {
    const userId = getSession()?.user?.id;
    if (userId && trackingVisible() &&
        (lastGmailSyncUser !== userId || Date.now() - lastGmailSync >= gmailSyncInterval)) {
      syncGmailReplies(false);
    }
  }

  async function syncGmailReplies(manual) {
    const userId = getSession()?.user?.id;
    if (!userId || gmailSyncRunning) return;
    gmailSyncRunning = true;
    lastGmailSync = Date.now();
    lastGmailSyncUser = userId;
    refreshReplies.disabled = true;
    if (manual) repliesStatus.textContent = "Recherche des réponses Gmail…";
    let updated = 0;
    let checked = 0;
    let after = null;
    try {
      do {
        const result = await invokeEdgeFunction("gmail-web", { action: "refresh_replies", after });
        if (getSession()?.user?.id !== userId) return;
        updated += result.updated || 0;
        checked += result.checked || 0;
        authorizeReplies.hidden = !result.needsConsent;
        if (result.needsConsent) {
          repliesStatus.textContent = "Autorisez Gmail pour vérifier les réponses à vos candidatures.";
          return;
        }
        after = result.next || null;
        if (after && manual) repliesStatus.textContent = checked + " dossiers vérifiés…";
        if (after && !manual && !trackingVisible()) {
          lastGmailSync = 0;
          return;
        }
      } while (after);
      repliesStatus.textContent = updated ? updated + " candidature(s) mise(s) à jour." :
        checked ? "Aucune nouvelle réponse." : "Aucun envoi Gmail à vérifier.";
    } catch (error) {
      if (getSession()?.user?.id === userId) repliesStatus.textContent = error.message;
    } finally {
      refreshReplies.disabled = false;
      gmailSyncRunning = false;
      if (updated && getSession()?.user?.id === userId && trackingVisible()) await loadTracking();
    }
  }

  refreshReplies.addEventListener("click", () => syncGmailReplies(true));
  document.addEventListener("visibilitychange", syncGmailRepliesAutomatically);
  setInterval(syncGmailRepliesAutomatically, gmailSyncInterval);

  gmailConnect.addEventListener("click", () => startGmailConnection(gmailConnect, true));
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
      sessionStorage.setItem(gmailFlowKey, JSON.stringify({ verifier, state, userId, readReplies, fromTracking: button !== gmailConnect, startedAt: Date.now() }));
      location.assign(url.href);
    } catch (error) {
      (button === gmailConnect ? gmailStatus : repliesStatus).textContent = error.message;
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
    showView(flow?.readReplies && flow?.fromTracking ? "tracking" : "settings", false);
    try {
      if (!flow || flow.state !== url.searchParams.get("state") || Date.now() - flow.startedAt > 10 * 60 * 1000 ||
          !flow.userId || flow.userId !== getSession()?.user?.id) throw new Error("La demande de connexion Gmail a expiré. Réessayez.");
      if (url.searchParams.has("error")) throw new Error("Connexion Gmail annulée.");
      await invokeEdgeFunction("gmail-web", { action: "exchange", code: url.searchParams.get("code"), verifier: flow.verifier, readReplies: flow.readReplies === true });
      if (flow.readReplies && flow.fromTracking) await syncGmailReplies(true);
      else await loadGmail();
    } catch (error) {
      await loadGmail();
      (flow?.fromTracking ? repliesStatus : gmailStatus).textContent = error.message;
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
