(() => {
  "use strict";

  const config = window.CANDIDATURE_PRO_CONFIG || {};
  const storageKey = "candidature-pro-web-session";
  let profile = null;
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

  const dialog = document.querySelector("#login-dialog");
  const loginForm = document.querySelector("#login-form");
  const loginMessage = document.querySelector("#login-message");
  const loginButton = document.querySelector("#open-login");
  const signOutButton = document.querySelector("#sign-out");
  const sidebar = document.querySelector(".sidebar");

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
    const email = session?.user?.email;
    const firstName = profile?.candidate_first_name?.trim();
    document.querySelector("#account-label").textContent = email || "Version web en préparation";
    document.querySelector("#first-name").textContent = firstName || (email ? email.split("@")[0] : "👋");
    loginButton.textContent = email ? "Mon compte" : "Se connecter";
    signOutButton.hidden = !email;

    const plan = String(profile?.plan || "free").toLowerCase();
    const isPremium = plan === "premium" || plan === "pro";
    document.querySelector("#current-plan").textContent = isPremium ? "Premium" : "Free";
    document.querySelector("#plan-detail").textContent = isPremium ? "Candidatures illimitées" : "5 candidatures par mois";
  }

  function showView(name) {
    const isDashboard = name === "dashboard";
    const isProfile = name === "profile";
    document.querySelector("#dashboard").classList.toggle("active", isDashboard);
    document.querySelector("#profile-view").classList.toggle("active", isProfile);
    document.querySelector("#generic-view").classList.toggle("active", !isDashboard && !isProfile);
    document.querySelectorAll(".nav-item[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));

    const [title, subtitle] = titles[name] || ["Candidature Pro", "Espace en ligne"];
    document.querySelector("#page-title").textContent = title;
    document.querySelector("#account-label").dataset.pageSubtitle = subtitle;
    if (!getSession()) document.querySelector("#account-label").textContent = subtitle;

    if (!isDashboard && !isProfile) {
      document.querySelector("#generic-title").textContent = title;
      document.querySelector("#generic-description").textContent = subtitle + ". Cette fonction sera reliée aux données existantes lors de la prochaine étape.";
    }
    if (isProfile) renderProfile();
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
    if (!response.ok) throw new Error(result.message || "Impossible d’enregistrer le profil.");
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

  document.querySelectorAll("[data-view], [data-view-link]").forEach(el => {
    el.addEventListener("click", () => showView(el.dataset.view || el.dataset.viewLink));
  });
  document.querySelector("#menu-toggle").addEventListener("click", () => sidebar.classList.toggle("open"));
  document.querySelector("#close-login").addEventListener("click", () => dialog.close());
  loginButton.addEventListener("click", () => {
    if (getSession()) showView("settings");
    else dialog.showModal();
  });
  signOutButton.addEventListener("click", () => {
    profile = null;
    setSession(null);
    showView("dashboard");
    loadDashboard();
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
      await loadDashboard();
      dialog.close();
      loginForm.reset();
    } catch (error) {
      loginMessage.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Se connecter";
    }
  });

  async function bootstrap() {
    renderAccount();
    showView("dashboard");
    try { await loadDashboard(); }
    catch (error) {
      document.querySelector("#account-label").textContent = error.message;
    }
  }

  bootstrap();
})();
