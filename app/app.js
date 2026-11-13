(() => {
  "use strict";

  const config = window.CANDIDATURE_PRO_CONFIG || {};
  const storageKey = "candidature-pro-web-session";
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

  function renderAccount() {
    const session = getSession();
    const email = session?.user?.email;
    document.querySelector("#account-label").textContent = email || "Version web en préparation";
    document.querySelector("#first-name").textContent = email ? email.split("@")[0] : "👋";
    loginButton.textContent = email ? "Mon compte" : "Se connecter";
    signOutButton.hidden = !email;
  }

  function showView(name) {
    const isDashboard = name === "dashboard";
    document.querySelector("#dashboard").classList.toggle("active", isDashboard);
    document.querySelector("#generic-view").classList.toggle("active", !isDashboard);
    document.querySelectorAll(".nav-item[data-view]").forEach(item => item.classList.toggle("active", item.dataset.view === name));

    const [title, subtitle] = titles[name] || ["Candidature Pro", "Espace en ligne"];
    document.querySelector("#page-title").textContent = title;
    document.querySelector("#account-label").dataset.pageSubtitle = subtitle;
    if (!getSession()) document.querySelector("#account-label").textContent = subtitle;

    if (!isDashboard) {
      document.querySelector("#generic-title").textContent = title;
      document.querySelector("#generic-description").textContent = subtitle + ". Cette fonction sera reliée aux données existantes lors de la prochaine étape.";
    }
    sidebar.classList.remove("open");
  }

  async function signIn(email, password) {
    if (!config.supabaseUrl || !config.supabasePublishableKey) {
      throw new Error("La connexion réelle n’est pas encore activée sur cette version de test.");
    }
    const response = await fetch(config.supabaseUrl + "/auth/v1/token?grant_type=password", {
      method: "POST",
      headers: {
        "apikey": config.supabasePublishableKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({ email, password })
    });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error_description || result.msg || "Connexion impossible.");
    return {
      access_token: result.access_token,
      refresh_token: result.refresh_token,
      expires_at: Math.floor(Date.now() / 1000) + Number(result.expires_in || 3600),
      user: result.user
    };
  }

  document.querySelectorAll("[data-view], [data-view-link]").forEach(el => {
    el.addEventListener("click", () => showView(el.dataset.view || el.dataset.viewLink));
  });
  document.querySelector("#menu-toggle").addEventListener("click", () => sidebar.classList.toggle("open"));
  document.querySelector("#close-login").addEventListener("click", () => dialog.close());
  loginButton.addEventListener("click", () => {
    if (getSession()) showView("settings");
    else dialog.showModal();
  });
  signOutButton.addEventListener("click", () => { setSession(null); showView("dashboard"); });

  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = document.querySelector("#login-submit");
    loginMessage.textContent = "";
    submit.disabled = true;
    submit.textContent = "Connexion…";
    try {
      const session = await signIn(document.querySelector("#email").value.trim(), document.querySelector("#password").value);
      setSession(session);
      dialog.close();
      loginForm.reset();
    } catch (error) {
      loginMessage.textContent = error.message;
    } finally {
      submit.disabled = false;
      submit.textContent = "Se connecter";
    }
  });

  renderAccount();
  showView("dashboard");
})();
