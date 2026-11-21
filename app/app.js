(() => {
  "use strict";

  if (location.hostname === "www.candidaturepro.ch") {
    const canonical = new URL(location.href);
    canonical.hostname = "candidaturepro.ch";
    location.replace(canonical.href);
    return;
  }

  const config = window.CANDIDATURE_PRO_CONFIG || {};
  const storageKey = "candidature-pro-web-session";
  const microsoftFlowKey = "candidature-pro-microsoft-oauth";
  let profile = null;
  let accountLastRefreshed = 0;
  let accountRefreshPromise = null;
  let applications = [];
  let companyResults = [];
  let companySearchRunning = false;
  let jobResults = [];
  let pendingJobCompany = null;
  let jobsLoadRequest = 0;
  let sessionGeneration = 0;
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
    admin: ["Administration", "Statistiques, utilisateurs et gestion du service"],
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

  const authModeSignin = document.querySelector("#auth-mode-signin"), authModeSignup = document.querySelector("#auth-mode-signup");
  const signupConfirm = document.querySelector("#signup-confirm"), signupResend = document.querySelector("#signup-resend");
  const microsoftSignin = document.querySelector("#microsoft-signin");
  let authMode = "signin", authBusy = false, pendingConfirmationEmail = null, signupResendAfter = 0;
  function setAuthMode(mode) {
    if (authBusy || document.querySelector("#login-submit").disabled) return;
    authMode = mode === "signup" ? "signup" : "signin";
    const signup = authMode === "signup", password = document.querySelector("#password");
    document.querySelector("#auth-title").textContent = signup ? "Créer un compte gratuit" : "Connexion";
    document.querySelector("#auth-description").textContent = signup ? "Commencez dans votre navigateur. L’application Windows est facultative." : "Retrouvez votre compte Candidature Pro, sur le site comme dans Windows.";
    document.querySelector("#signup-confirm-wrapper").hidden = document.querySelector("#signup-notice").hidden = !signup;
    signupConfirm.disabled = !signup; signupConfirm.required = signup;
    password.value = signupConfirm.value = "";
    password.minLength = signup ? 8 : 0; password.maxLength = signup ? 128 : 4096;
    password.autocomplete = signup ? "new-password" : "current-password";
    document.querySelector("#password-forgot").hidden = signup;
    signupResend.hidden = true; pendingConfirmationEmail = null;
    authModeSignin.setAttribute("aria-pressed", String(!signup)); authModeSignup.setAttribute("aria-pressed", String(signup));
    document.querySelector("#login-submit").textContent = signup ? "Créer mon compte gratuit" : "Se connecter";
    microsoftSignin.hidden = signup;
    loginMessage.textContent = "";
  }
  authModeSignin.addEventListener("click", () => setAuthMode("signin"));
  authModeSignup.addEventListener("click", () => setAuthMode("signup"));
  dialog.addEventListener("cancel", event => { if (authBusy || document.querySelector("#login-submit").disabled) event.preventDefault(); });
  dialog.addEventListener("close", () => { document.querySelector("#password").value = signupConfirm.value = ""; });

  function oauthBase64(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  microsoftSignin.addEventListener("click", async () => {
    if (authBusy || !config.supabaseUrl || !config.supabasePublishableKey) return;
    setAuthBusy(true);
    loginMessage.textContent = "Ouverture de Microsoft…";
    try {
      const verifier = oauthBase64(crypto.getRandomValues(new Uint8Array(32)));
      const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
      const challenge = oauthBase64(new Uint8Array(digest));
      sessionStorage.setItem(microsoftFlowKey, JSON.stringify({ verifier, startedAt: Date.now() }));
      const authorize = new URL(config.supabaseUrl + "/auth/v1/authorize");
      authorize.searchParams.set("provider", "azure");
      authorize.searchParams.set("redirect_to", location.origin + location.pathname);
      authorize.searchParams.set("scopes", "email");
      authorize.searchParams.set("code_challenge", challenge);
      authorize.searchParams.set("code_challenge_method", "s256");
      location.assign(authorize.href);
    } catch (error) {
      sessionStorage.removeItem(microsoftFlowKey);
      loginMessage.textContent = "Impossible d’ouvrir la connexion Microsoft. Réessayez.";
      setAuthBusy(false);
    }
  });

  async function finishMicrosoftConnection() {
    const raw = sessionStorage.getItem(microsoftFlowKey);
    if (!raw) return false;
    const url = new URL(location.href);
    if (!url.searchParams.has("code") && !url.searchParams.has("error")) return false;
    sessionStorage.removeItem(microsoftFlowKey);
    const code = url.searchParams.get("code");
    const oauthError = url.searchParams.get("error");
    url.searchParams.delete("code"); url.searchParams.delete("error"); url.searchParams.delete("error_code"); url.searchParams.delete("error_description");
    history.replaceState(null, "", url.pathname + url.search + url.hash);
    try {
      const flow = JSON.parse(raw);
      if (!flow?.verifier || Date.now() - flow.startedAt > 10 * 60 * 1000 || !code || oauthError) {
        throw new Error(oauthError ? "La connexion Microsoft a été annulée ou refusée." : "La connexion Microsoft a expiré. Réessayez.");
      }
      const response = await fetch(config.supabaseUrl + "/auth/v1/token?grant_type=pkce", {
        method: "POST",
        headers: { "apikey": config.supabasePublishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ auth_code: code, code_verifier: flow.verifier })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok || !result.access_token || !result.refresh_token || !result.user?.id) {
        throw new Error(authErrorMessage(result, "Microsoft n’a pas pu terminer la connexion."));
      }
      profile = null; setSession(normalizeSession(result));
      return true;
    } catch (error) {
      setAuthMode("signin");
      loginMessage.textContent = error.message;
      if (!dialog.open) dialog.showModal();
      return true;
    }
  }

  function getSession() {
    try { return JSON.parse(localStorage.getItem(storageKey) || "null"); }
    catch { return null; }
  }

  function setSession(session) {
    const previousUserId = getSession()?.user?.id;
    if (!session || session.user?.id !== previousUserId) sessionGeneration++;
    if (session) localStorage.setItem(storageKey, JSON.stringify(session));
    else localStorage.removeItem(storageKey);
    renderAccount();
  }

  window.addEventListener("storage", event => {
    if (event.key !== storageKey) return;
    let previousUserId = null;
    try { previousUserId = JSON.parse(event.oldValue || "null")?.user?.id || null; }
    catch { /* An invalid previous session still requires a fresh account view. */ }
    const currentUserId = getSession()?.user?.id || null;
    if (previousUserId !== currentUserId) {
      sessionGeneration++;
      location.reload();
    }
  });

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

    const isPremium = hasPremiumCv();
    const planLabel = profile ? (isPremium ? "Premium" : "Free") : "Vérification…";
    document.querySelector("#cv-targeting").hidden = !isPremium;
    const cvTemplateSelect = document.querySelector("#cv-form [name=template]");
    cvTemplateSelect.querySelectorAll("option:not([value=classic])").forEach(option => { option.disabled = !isPremium; });
    syncCvStudio();
    document.querySelector("#cv-premium-access-status").textContent = !profile ? "Vérification des droits du compte…" : isPremium ? "Premium actif : les trois modèles de CV sont disponibles." : "Formule Free : seul le modèle Classique est disponible. Vérifiez votre formule dans Premium.";
    if (!isPremium && cvTemplateSelect.value !== "classic") {
      cvTemplateSelect.value = "classic";
      document.querySelector("#cv-save-status").textContent = "Votre formule actuelle donne accès au modèle Classique. Les modèles Contemporain et Compact nécessitent Premium.";
    }
    document.querySelector("#current-plan").textContent = planLabel;
    document.querySelector("#settings-account").textContent = email
      ? email + (profile ? " · " + (isPremium ? "Premium" : "Free") : "")
      : "Connectez-vous pour accéder à votre compte.";
    document.querySelector("#premium-plan").textContent = "Formule actuelle · " + planLabel;
    document.querySelector("#plan-detail").textContent = !profile ? "Vérification des droits du compte" : isPremium ? "Candidatures illimitées" : "5 candidatures par mois";
  }

  function showView(name, syncReplies = true) {
    if (appShell.hidden || (name === "admin" && profile?.is_admin !== true)) return;
    if (profile) refreshAccountRights();
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

    if (isDashboard) {
      ensureSession().then(session => {
        if (session) return Promise.all([updateTrackingCounts(session), refreshAccountSetup(session)]);
      }).catch(() => {});
      if (syncReplies) syncGmailRepliesAutomatically();
    }
    if (isProfile) loadCandidateProfile();
    if (isApplications) loadApplications();
    if (isCompanies) renderCompanies();
    if (isJobs) loadJobs();
    if (isTracking) {
      loadTracking();
      if (syncReplies) syncGmailRepliesAutomatically();
    }
    if (isDocuments) { loadDocuments(); loadCvVariants(); loadCvAnalysisHistory(); }
    if (name === "settings") { loadGmail(); loadOutlook(); }
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
    if (!response.ok) { const error = new Error(authErrorMessage(result, "Connexion impossible.")); error.code = result.error_code || result.code; error.status = response.status; throw error; }
    return normalizeSession(result);
  }

  function authErrorMessage(result, fallback) {
    const code = result.error_code || result.code || "";
    const raw = result.error_description || result.msg || result.message || "";
    if (code === "invalid_credentials" || /invalid login credentials/i.test(raw)) return "L’e-mail ou le mot de passe n’est pas reconnu.";
    if (code === "email_not_confirmed") return "Confirmez votre adresse e-mail avec le message reçu avant de vous connecter.";
    if (["over_email_send_rate_limit", "over_request_rate_limit"].includes(code)) return "Trop de demandes rapprochées. Patientez avant de réessayer.";
    if (["otp_expired", "flow_state_expired", "flow_state_not_found"].includes(code)) return "Le lien a expiré. Demandez un nouveau lien de récupération.";
    if (code === "same_password") return "Choisissez un mot de passe différent du précédent.";
    if (["reauthentication_needed", "reauthentication_not_valid"].includes(code)) return "Reconnectez-vous à votre compte avant de modifier le mot de passe.";
    return raw || fallback;
  }

  const passwordDialog = document.querySelector("#password-dialog");
  const passwordForm = document.querySelector("#password-form");
  const passwordStatus = document.querySelector("#password-status");
  const passwordSave = document.querySelector("#password-save");
  const passwordClose = document.querySelector("#password-close");
  const passwordForgot = document.querySelector("#password-forgot");
  const recoveryFlowKey = "candidature-pro-password-recovery";
  let passwordContext = null;

  function openPasswordDialog(session, recovery) {
    passwordContext = { session, recovery };
    passwordForm.reset(); passwordStatus.textContent = "";
    document.querySelector("#password-dialog-title").textContent = recovery ? "Choisir un nouveau mot de passe" : "Modifier mon mot de passe";
    document.querySelector("#password-account").textContent = "Compte Candidature Pro · " + session.user.email;
    passwordSave.hidden = false;
    passwordDialog.showModal();
  }

  const passwordRecoverySend = document.querySelector("#password-recovery-send");
  const passwordRecoveryStatus = document.querySelector("#password-recovery-status");
  let passwordRecoveryBusy = false;
  async function requestPasswordRecovery(email, status) {
    const submit = document.querySelector("#login-submit");
    if (passwordRecoveryBusy || submit.disabled || !email) return;
    passwordRecoveryBusy = true;
    passwordRecoverySend.disabled = passwordForgot.disabled = submit.disabled = true;
    status.textContent = "Préparation du lien de récupération…";
    let storedFlow = null, previousFlow = null;
    try {
      const verifier = gmailEncode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = gmailEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      previousFlow = localStorage.getItem(recoveryFlowKey);
      storedFlow = JSON.stringify({ verifier, email, startedAt: Date.now() });
      localStorage.setItem(recoveryFlowKey, storedFlow);
      const redirect = new URL(location.pathname, location.origin); redirect.searchParams.set("recuperation", "1");
      const response = await fetch(config.supabaseUrl + "/auth/v1/recover?redirect_to=" + encodeURIComponent(redirect.href), {
        method: "POST", headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ email, code_challenge: challenge, code_challenge_method: "s256" }), signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) {
        if (localStorage.getItem(recoveryFlowKey) === storedFlow) {
          if (previousFlow) localStorage.setItem(recoveryFlowKey, previousFlow); else localStorage.removeItem(recoveryFlowKey);
        }
        throw new Error(authErrorMessage(result, "Impossible d’envoyer le lien de récupération."));
      }
      status.textContent = "Si cette adresse correspond à un compte, un lien de récupération a été envoyé. Ouvrez-le dans ce même navigateur. Vérifiez aussi les courriers indésirables.";
    } catch (error) {
      status.textContent = ["TimeoutError", "AbortError", "TypeError"].includes(error.name)
        ? "La demande a peut-être abouti. Vérifiez votre boîte e-mail et ouvrez le lien dans ce navigateur avant une nouvelle demande." : error.message;
    } finally { passwordRecoveryBusy = false; passwordRecoverySend.disabled = passwordForgot.disabled = submit.disabled = false; }
  }
  passwordForgot.addEventListener("click", async () => {
    const emailField = document.querySelector("#email");
    if (passwordForgot.disabled || !emailField.reportValidity()) return;
    await requestPasswordRecovery(emailField.value.trim().toLowerCase(), loginMessage);
  });
  passwordRecoverySend.addEventListener("click", async () => {
    const userId = getSession()?.user?.id;
    if (!userId || passwordRecoverySend.disabled) return;
    const session = await ensureSession();
    if (session?.user?.id !== userId || !session.user.email) return;
    await requestPasswordRecovery(session.user.email.trim().toLowerCase(), passwordRecoveryStatus);
  });

  document.querySelector("#password-change-open").addEventListener("click", async () => {
    const session = await ensureSession();
    if (session?.user?.id && !passwordDialog.open) openPasswordDialog(session, false);
  });
  passwordClose.addEventListener("click", () => passwordDialog.close());
  passwordDialog.addEventListener("cancel", event => { if (passwordSave.disabled) event.preventDefault(); });
  passwordDialog.addEventListener("close", () => {
    const recovery = passwordContext?.recovery;
    passwordContext = null; passwordForm.reset();
    if (recovery) location.replace(location.pathname);
  });
  passwordForm.addEventListener("submit", async event => {
    event.preventDefault();
    const context = passwordContext;
    if (!context || passwordSave.disabled || passwordSave.hidden || !passwordForm.reportValidity()) return;
    const password = document.querySelector("#password-new").value;
    if (password !== document.querySelector("#password-confirm").value) { passwordStatus.textContent = "Les deux mots de passe sont différents."; return; }
    if (password.length < 8) { passwordStatus.textContent = "Choisissez un mot de passe d’au moins 8 caractères."; return; }
    if (!context.recovery && getSession()?.user?.id !== context.session.user.id) { passwordStatus.textContent = "Le compte connecté a changé. Rouvrez ce formulaire."; return; }
    passwordSave.disabled = passwordClose.disabled = true;
    passwordStatus.textContent = "Modification en cours…";
    try {
      const session = context.recovery ? context.session : await ensureSession();
      if (!session?.access_token || session.user.id !== context.session.user.id || session.expires_at <= Date.now() / 1000) throw new Error("Votre session a expiré. Reconnectez-vous ou demandez un nouveau lien.");
      const response = await fetch(config.supabaseUrl + "/auth/v1/user", {
        method: "PUT", headers: { apikey: config.supabasePublishableKey, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ password }), signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(authErrorMessage(result, "Le mot de passe n’a pas pu être modifié."));
      if (passwordContext !== context) return;
      if (context.recovery) setSession(session);
      passwordForm.reset(); passwordSave.hidden = true;
      passwordStatus.textContent = "Votre mot de passe a été modifié. Vous pouvez fermer cette fenêtre.";
    } catch (error) {
      if (passwordContext === context) passwordStatus.textContent = ["TimeoutError", "AbortError", "TypeError"].includes(error.name)
        ? "Connexion interrompue. La modification a peut-être abouti. Vérifiez la connexion avec le nouveau mot de passe avant de réessayer." : error.message;
    } finally { passwordSave.disabled = passwordClose.disabled = false; }
  });

  async function finishPasswordRecovery() {
    const url = new URL(location.href);
    if (url.searchParams.get("recuperation") !== "1") return false;
    const code = url.searchParams.get("code");
    const failed = url.searchParams.has("error");
    url.searchParams.delete("code"); url.searchParams.delete("recuperation");
    url.searchParams.delete("error"); url.searchParams.delete("error_description");
    history.replaceState(null, "", url.pathname + url.search);
    let flow;
    try { flow = JSON.parse(localStorage.getItem(recoveryFlowKey) || "null"); } catch { flow = null; }
    try {
      if (failed || !code || code.length > 4096 || !flow || !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier || "") || !Number.isFinite(flow.startedAt) || flow.startedAt > Date.now() || Date.now() - flow.startedAt > 60 * 60 * 1000) throw new Error("Le lien a expiré ou a été ouvert dans un autre navigateur. Demandez un nouveau lien et ouvrez-le dans le navigateur utilisé pour la demande.");
      const response = await fetch(config.supabaseUrl + "/auth/v1/token?grant_type=pkce", {
        method: "POST", headers: { apikey: config.supabasePublishableKey, "Content-Type": "application/json" },
        body: JSON.stringify({ auth_code: code, code_verifier: flow.verifier }), signal: AbortSignal.timeout(15000)
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(authErrorMessage(result, "Le lien de récupération n’est plus valide."));
      if (!result.access_token || !result.refresh_token || !result.user?.id || result.user.email?.toLowerCase() !== flow.email) throw new Error("Le lien ne correspond pas au compte demandé. Recommencez la récupération.");
      localStorage.removeItem(recoveryFlowKey);
      openPasswordDialog(normalizeSession(result), true);
    } catch (error) {
      loginMessage.textContent = error.message;
      dialog.showModal();
    }
    return true;
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
      let refreshed;
      try {
        refreshed = await authRequest("refresh_token", { refresh_token: session.refresh_token });
      } catch (error) {
        const latest = getSession();
        if (latest?.user?.id === session.user?.id && latest.refresh_token !== session.refresh_token &&
            Number(latest.expires_at || 0) > Math.floor(Date.now() / 1000) + 60) return latest;
        throw error;
      }
      // Never store a refresh response that identifies a different account.
      if (!refreshed?.user?.id || refreshed.user.id !== session.user?.id ||
          !refreshed.access_token || !refreshed.refresh_token)
        throw new Error("Le renouvellement a renvoyé une session invalide.");
      const latest = getSession();
      if (latest?.refresh_token !== session.refresh_token) {
        if (latest?.user?.id === session.user?.id &&
            Number(latest.expires_at || 0) > Math.floor(Date.now() / 1000) + 60) return latest;
        throw new Error("La session a changé pendant son renouvellement.");
      }
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
    try {
      const refreshed = await refreshSession();
      // A refresh already running for a previous account must never be reused.
      const current = getSession();
      if (refreshed?.user?.id !== session.user?.id ||
          current?.user?.id !== session.user?.id ||
          current?.refresh_token !== refreshed.refresh_token)
        return null;
      return refreshed;
    }
    catch (error) {
      // Keep the saved login when the network, rate limit or Auth server fails.
      // Only a definitive invalid/expired refresh token should sign the user out.
      const invalidToken = (error?.status === 400 || error?.status === 401) &&
        ["refresh_token_not_found", "refresh_token_already_used", "invalid_grant"].includes(error?.code);
      if (invalidToken && getSession()?.refresh_token === session.refresh_token) {
        profile = null;
        setSession(null);
      }
      return null;
    }
  }

  async function supabaseFetch(path, retry = true) {
    const generation = sessionGeneration;
    const session = await ensureSession();
    if (!session || generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id)
      throw new Error("La session a changé. Reconnectez-vous avant de relancer la recherche.");
    const response = await fetch(config.supabaseUrl + "/rest/v1/" + path, {
      headers: {
        "apikey": config.supabasePublishableKey,
        "Authorization": "Bearer " + session.access_token,
        "Accept": "application/json"
      }
    });
    if (response.status === 401 && retry) {
      const userId = session.user?.id;
      // Reuse the generation captured before the original request, not a newer one.
      await refreshSession();
      if (!userId || generation !== sessionGeneration || getSession()?.user?.id !== userId) {
        throw new Error("La session a changé. Reconnectez-vous avant de relancer la recherche.");
      }
      return supabaseFetch(path, false);
    }
    const result = await response.json().catch(() => []);
    if (generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id)
      throw new Error("La session a changé pendant le chargement des données.");
    if (!response.ok) throw new Error(result.message || "Impossible de charger les données.");
    return result;
  }

  async function supabaseWrite(path, method, body, retry = true) {
    const generation = sessionGeneration;
    const session = await ensureSession();
    if (!session || generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id)
      throw new Error("La session a changé. Reconnectez-vous avant de modifier vos données.");
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
      if (generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id) {
        throw new Error("La session a changé. Vérifiez votre connexion avant de réessayer.");
      }
      return supabaseWrite(path, method, body, false);
    }
    const result = await response.json().catch(() => []);
    if (generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id)
      throw new Error("La session a changé pendant l’enregistrement des données.");
    if (!response.ok) throw new Error(result.message || "Impossible d’enregistrer les données.");
    return result;
  }

  async function supabaseRpc(name, body, retry = true) {
    const generation = sessionGeneration;
    const session = await ensureSession();
    if (!session || generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id) throw new Error("Connectez-vous pour enregistrer votre profil.");
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
      if (generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id)
        throw new Error("La session a changé. Reconnectez-vous avant de réessayer.");
      return supabaseRpc(name, body, false);
    }
    const result = await response.json().catch(() => ({}));
    if (generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id)
      throw new Error("La session a changé pendant l’opération.");
    if (!response.ok) throw new Error(result.message || "Impossible d’exécuter l’opération.");
    return result;
  }

  async function invokeEdgeFunction(name, body, retry = true) {
    const generation = sessionGeneration;
    const session = await ensureSession();
    if (!session || generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id) throw new Error("Connectez-vous pour continuer.");
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
      if (generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id)
        throw new Error("La session a changé. Reconnectez-vous avant de réessayer.");
      return invokeEdgeFunction(name, body, false);
    }
    const result = await response.json().catch(() => ({}));
    if (generation !== sessionGeneration || getSession()?.user?.id !== session.user?.id)
      throw new Error("La session a changé pendant l’opération.");
    if (!response.ok) {
      const error = new Error(result.message || result.error || "Le service est indisponible.");
      error.uncertain = result.uncertain === true;
      error.status = response.status;
      throw error;
    }
    return result;
  }

  const profileDetailFields = ["phone", "city", "desired_jobs", "skills", "languages"];
  let profileDetailsUser = null;
  let profileDetailsRequest = 0;

  async function fetchProfileDetails(userId) {
    const rows = await supabaseFetch("web_candidate_profile_details?user_id=eq." +
      encodeURIComponent(userId) + "&select=" + profileDetailFields.join(","));
    return rows[0] || {};
  }

  async function loadCandidateProfile() {
    const userId = getSession()?.user?.id;
    const form = document.querySelector("#profile-form");
    const status = document.querySelector("#profile-message");
    renderProfile();
    loadIdentityChangeStatus();
    if (!userId || profileDetailsUser === userId) return;
    form.querySelectorAll("input, textarea, button").forEach(element => { element.disabled = true; });
    status.textContent = "Chargement du profil…";
    const request = ++profileDetailsRequest;
    try {
      const details = await fetchProfileDetails(userId);
      if (getSession()?.user?.id !== userId || request !== profileDetailsRequest) return;
      for (const field of profileDetailFields) form.elements.namedItem(field).value = details[field] || "";
      profileDetailsUser = userId;
      renderProfile();
    } catch (error) {
      if (getSession()?.user?.id === userId && request === profileDetailsRequest) status.textContent = error.message + " Rouvrez Mon profil pour réessayer.";
    }
  }

  function renderProfile() {
    const session = getSession();
    const form = document.querySelector("#profile-form");
    const message = document.querySelector("#profile-message");
    const enabled = Boolean(session?.user?.id && profile);
    form.querySelectorAll("input, textarea, button").forEach(element => { element.disabled = !enabled || profileDetailsUser !== session?.user?.id; });
    document.querySelector("#profile-first-name").value = profile?.candidate_first_name || "";
    document.querySelector("#profile-last-name").value = profile?.candidate_last_name || "";
    document.querySelector("#profile-email").value = profile?.candidate_email || session?.user?.email || "";
    message.textContent = enabled ? "" : session?.user?.id ? "Chargement du compte…" : "Connectez-vous pour compléter votre profil.";
    renderIdentityState();
  }

  function candidateIdentityLocked() {
    return [profile?.candidate_first_name, profile?.candidate_last_name, profile?.candidate_email]
      .every(value => typeof value === "string" && Boolean(value.trim()));
  }

  function renderIdentityState() {
    const locked = candidateIdentityLocked();
    for (const id of ["profile-first-name", "profile-last-name", "profile-email"]) document.querySelector("#" + id).readOnly = locked;
    document.querySelector("#profile-identity-status").textContent = !profile ? "Vérification de l’identité…" : locked
      ? "Identité enregistrée et verrouillée. Les informations complémentaires restent modifiables."
      : "Le prénom, le nom et l’e-mail seront verrouillés après confirmation, comme dans l’application Windows.";
    document.querySelector("#profile-submit").textContent = locked ? "Enregistrer les informations complémentaires" : "Enregistrer et verrouiller mon identité";
    document.querySelector("#identity-change-panel").hidden = !locked;
  }

  const identityChangePanel = document.querySelector("#identity-change-panel");
  const identityChangeForm = document.querySelector("#identity-change-form");
  const identityChangeStatus = document.querySelector("#identity-change-status");
  const identityChangeSubmit = identityChangeForm.querySelector("button");
  let identityChangeRequest = 0;

  identityChangePanel.addEventListener("toggle", () => {
    if (!identityChangePanel.open) return;
    for (const [name, value] of [["first", profile?.candidate_first_name], ["last", profile?.candidate_last_name], ["email", profile?.candidate_email]]) {
      if (!identityChangeForm.elements.namedItem(name).value) identityChangeForm.elements.namedItem(name).value = value || "";
    }
    loadIdentityChangeStatus();
  });

  async function loadIdentityChangeStatus() {
    const userId = getSession()?.user?.id;
    const request = ++identityChangeRequest;
    if (!userId || !candidateIdentityLocked()) return;
    identityChangeSubmit.disabled = true;
    identityChangeStatus.textContent = "Vérification des demandes…";
    try {
      const rows = await supabaseFetch("candidate_identity_change_requests?user_id=eq." + encodeURIComponent(userId) +
        "&select=id,status,requested_first_name,requested_last_name,requested_email,admin_note&order=created_at.desc,id.desc&limit=50");
      if (request !== identityChangeRequest || getSession()?.user?.id !== userId) return;
      const pending = rows.find(row => row.status === "pending");
      identityChangeSubmit.disabled = Boolean(pending);
      const latest = rows[0];
      identityChangeStatus.textContent = pending
        ? "Demande en attente : " + [pending.requested_first_name, pending.requested_last_name, pending.requested_email].filter(Boolean).join(" · ")
        : latest ? (latest.status === "approved" ? "Dernière correction approuvée." : "Dernière demande refusée.") + (latest.admin_note ? " " + latest.admin_note : "")
        : "Aucune demande en attente.";
    } catch (error) {
      if (request === identityChangeRequest && getSession()?.user?.id === userId) identityChangeStatus.textContent = error.message;
    }
  }

  identityChangeForm.addEventListener("submit", async event => {
    event.preventDefault();
    const userId = getSession()?.user?.id;
    if (!userId || !candidateIdentityLocked() || identityChangeSubmit.disabled || !identityChangeForm.reportValidity()) return;
    identityChangeSubmit.disabled = true;
    const data = new FormData(identityChangeForm);
    try {
      const result = await supabaseRpc("submit_web_identity_change", {
        p_first_name: String(data.get("first")).trim(), p_last_name: String(data.get("last")).trim(),
        p_email: String(data.get("email")).trim(), p_reason: String(data.get("reason")).trim()
      });
      if (getSession()?.user?.id !== userId) return;
      if (!result?.id) throw new Error("La demande n’a pas pu être confirmée.");
      await loadIdentityChangeStatus();
    } catch (error) {
      if (getSession()?.user?.id === userId) { identityChangeStatus.textContent = error.message; identityChangeSubmit.disabled = false; }
    }
  });

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
        (!company.email && company.name ? '<button type="button" class="secondary compact" data-action="verify-company">Faire vérifier le contact</button>' : "") +
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
      const checkedAt = Date.parse(job.updated_at || "");
      const daysSinceCheck = Number.isFinite(checkedAt) ? Math.floor((Date.now() - checkedAt) / 86400000) : Infinity;
      const lastSearched = Number.isFinite(checkedAt)
        ? '<small>Retrouvée dans une recherche le ' + escapeHtml(new Date(checkedAt).toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" })) + '</small>'
        : "";
      const freshnessNote = daysSinceCheck > 30
        ? '<small>Annonce non revérifiée depuis plus de 30 jours — vérifiez sa disponibilité sur le site source.</small>'
        : "";
      return '<article class="job-card" data-job-index="' + index + '">' +
        '<div class="job-card-main"><strong>' + escapeHtml(job.title) + '</strong>' +
        '<span>' + escapeHtml(job.company_name || "Employeur à vérifier") + ' • ' + escapeHtml(job.location) + '</span>' +
        '<small>Catégorie de recherche : ' + escapeHtml(job.sector) + ' • ' + escapeHtml(job.source) + '</small>' +
        '<p>' + escapeHtml(job.snippet) + '</p>' + lastSearched + freshnessNote + '</div>' +
        '<div class="job-card-actions">' + sourceLink +
        '<button class="primary compact" data-action="add-job">' + (job.company_name?.trim() ? "Ajouter aux candidatures" : "Renseigner l’employeur") + '</button></div></article>';
    }).join("");
  }

  function cleanSearchTerm(value) {
    return String(value || "").trim().replace(/[%(),]/g, " ").replace(/\s+/g, " ");
  }

  const jobPlatforms = [
    ["Jobup", "https://www.jobup.ch/en/jobs/"],
    ["jobs.ch", "https://www.jobs.ch/fr/offres-emplois/"],
    ["JobScout24", "https://www.jobscout24.ch/fr/jobs/"],
    ["Indeed Suisse", "https://ch.indeed.com/jobs", "q", "l"]
  ];

  function renderJobPlatforms(query, city) {
    const links = jobPlatforms.map(([name, address, termKey = "term", cityKey = "location"]) => {
      const url = new URL(address);
      if (query) url.searchParams.set(termKey, query);
      if (city) url.searchParams.set(cityKey, city);
      const link = document.createElement("a");
      link.className = "secondary compact";
      link.href = url.href;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = name;
      return link;
    });
    document.querySelector("#job-platforms").replaceChildren(...links);
  }

  document.querySelector("#open-all-jobs").addEventListener("click", () => {
    document.querySelector("#jobs-query").value = "";
    document.querySelector("#jobs-sector").value = "";
    document.querySelector("#jobs-city").value = "";
    document.querySelector("#jobs-recent-only").checked = false;
    document.querySelector("#jobs-known-employer-only").checked = false;
    showView("jobs");
  });

  async function loadJobs() {
    const message = document.querySelector("#jobs-message");
    const request = ++jobsLoadRequest;
    const session = getSession();
    const userId = session?.user?.id;
    const generation = sessionGeneration;
    const current = () => request === jobsLoadRequest && generation === sessionGeneration &&
      Boolean(userId) && getSession()?.user?.id === userId;
    if (!getSession()) {
      jobResults = [];
      renderJobs();
      message.textContent = "Connectez-vous pour consulter les annonces référencées.";
      return;
    }

    const query = cleanSearchTerm(document.querySelector("#jobs-query").value);
    const city = cleanSearchTerm(document.querySelector("#jobs-city").value);
    const sector = document.querySelector("#jobs-sector").value;
    renderJobPlatforms(query, city);
    const filters = ["active=eq.true"];
    if (query) {
      const pattern = encodeURIComponent("*" + query + "*");
      filters.push("or=(title.ilike." + pattern + ",company_name.ilike." + pattern + ",snippet.ilike." + pattern + ")");
    }
    if (city) filters.push("location=ilike." + encodeURIComponent("*" + city + "*"));
    if (sector) filters.push("sector=eq." + encodeURIComponent(sector));
    const knownEmployerOnly = document.querySelector("#jobs-known-employer-only").checked;
    if (document.querySelector("#jobs-recent-only").checked) {
      filters.push("updated_at=gte." + encodeURIComponent(new Date(Date.now() - 30 * 86400000).toISOString()));
    }

    message.textContent = "Chargement…";
    try {
      const results = await supabaseFetch(
        "job_market_offers?select=id,title,company_name,location,sector,source,url,snippet,discovered_at,updated_at&" +
        filters.join("&") + "&order=updated_at.desc&limit=1000"
      );
      if (!current()) return;
      jobResults = knownEmployerOnly ? results.filter(job => String(job.company_name || "").trim()) : results;
      renderJobs();
      const olderThan30Days = jobResults.filter(job => {
        const checkedAt = Date.parse(job.updated_at || "");
        return !Number.isFinite(checkedAt) || Date.now() - checkedAt > 30 * 86400000;
      }).length;
      const missingEmployers = jobResults.filter(job => !String(job.company_name || "").trim()).length;
      const resultsTruncated = results.length >= 1000;
      message.textContent = jobResults.length
        ? "Annonces référencées correspondant à vos critères (disponibilité à confirmer). " +
          (missingEmployers ? missingEmployers + " employeur(s) à vérifier. " : "") +
          (olderThan30Days ? olderThan30Days + " offre(s) non revérifiée(s) depuis plus de 30 jours. " : "") +
          (resultsTruncated ? "Seules les 1 000 annonces les plus récemment référencées sont affichées ; affinez les critères pour en consulter d’autres. " : "") +
          "Vérifiez leur disponibilité sur le site source."
        : "Aucune annonce référencée ne correspond à ces critères.";
    } catch (error) {
      if (!current()) return;
      jobResults = [];
      renderJobs();
      message.textContent = error.message;
    }
  }

  function canEditApplication(row) {
    return !row.hidden_at && !row.sent_at && ["draft", "ready"].includes(row.status);
  }

  function renderApplications() {
    const list = document.querySelector("#applications-list");
    const filter = document.querySelector("#applications-filter").value;
    const query = trackingText(document.querySelector("#applications-search").value.trim());
    updateBatchSelection();
    const visible = applications.filter(row => (!query || trackingText(
      [row.company_name, row.job_title, row.company_city, row.company_email].filter(Boolean).join(" ")
    ).includes(query)) && (!filter || (filter === "sent"
      ? Boolean(row.sent_at) || ["sent", "reply_received", "interview", "accepted", "rejected"].includes(row.status)
      : row.status === filter)));
    if (!visible.length) {
      if (filter || query) {
        list.textContent = "Aucun dossier ne correspond à cette recherche.";
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
        (canEditApplication(application) ? '<button type="button" class="secondary compact" data-action="edit">Modifier le dossier</button>' : "") +
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

  async function fetchApplicationPages(path, current) {
    const pageSize = 500;
    path += "&order=id.asc&limit=" + pageSize;
    const rows = [];
    let cursor = "";
    while (current()) {
      const page = await supabaseFetch(path + (cursor ? "&id=gt." + encodeURIComponent(cursor) : ""));
      rows.push(...page);
      if (page.length < pageSize) break;
      cursor = page.at(-1).id;
    }
    return rows;
  }

  let applicationsLoadRequest = 0;

  async function loadApplications() {
    const message = document.querySelector("#applications-message");
    const userId = getSession()?.user?.id;
    const request = ++applicationsLoadRequest;
    if (!userId) {
      applications = [];
      renderApplications();
      message.textContent = "Connectez-vous pour afficher vos candidatures.";
      return;
    }
    const includeHidden = document.querySelector("#show-hidden-applications").checked;
    const current = () => request === applicationsLoadRequest && getSession()?.user?.id === userId;
    message.textContent = "Chargement…";
    try {
      const filter = includeHidden ? "" : "&hidden_at=is.null";
      const rows = await fetchApplicationPages(
        "user_applications?select=id,company_name,company_city,company_email,job_title,status,source_url,hidden_at,last_activity_at,sent_at,updated_at" +
        filter, current
      );
      if (!current()) return;
      applications = rows.sort((a, b) => Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at) || a.id.localeCompare(b.id));
      renderApplications();
      message.textContent = applications.length + " candidature" + (applications.length > 1 ? "s" : "") + ".";
    } catch (error) {
      if (!current()) return;
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

  const replyDraftPrefix = "candidature-pro-reply:";
  function replyDraftKey(context) {
    return replyDraftPrefix + context.userId + ":" + context.applicationId + ":" + (context.replyTo?.id || "draft");
  }
  function saveReplyDraft(context) {
    if (!context) return false;
    try {
      if (!replyDraft.value.trim() && !context.requestId) sessionStorage.removeItem(replyDraftKey(context));
      else sessionStorage.setItem(replyDraftKey(context), JSON.stringify({
        message: replyDraft.value, recipient: context.replyTo?.recipient || "", requestId: context.requestId || null
      }));
      return true;
    } catch { return false; }
  }
  function restoreReplyDraft(context) {
    try {
      const saved = JSON.parse(sessionStorage.getItem(replyDraftKey(context)) || "null");
      if (typeof saved?.message !== "string" || saved.recipient !== (context.replyTo?.recipient || "")) return;
      replyDraft.value = saved.message.slice(0, 12000);
      context.requestId = typeof saved.requestId === "string" ? saved.requestId : null;
      replyDraft.readOnly = replyGenerate.disabled = Boolean(context.requestId);
      replyEditorStatus.textContent = context.requestId
        ? "Un envoi a déjà été demandé pour ce texte. Une nouvelle vérification réutilisera le même identifiant. Vérifiez aussi les messages envoyés dans Gmail."
        : "Brouillon restauré depuis cet onglet.";
      replyEditor.open = true;
    } catch { /* Le formulaire reste disponible sans stockage local. */ }
  }
  replyDraft.addEventListener("input", () => {
    if (!replyContext || replyContext.requestId) return;
    replyEditorStatus.textContent = saveReplyDraft(replyContext)
      ? "Brouillon conservé dans cet onglet jusqu’à l’envoi ou la déconnexion." : "Le navigateur ne peut pas conserver le brouillon.";
  });

  replyDialog.addEventListener("close", () => {
    saveReplyDraft(replyContext);
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
    if (!context || context.requestId || replyGenerate.disabled) return;
    context.generating = true;
    replyGenerate.disabled = replySend.disabled = true;
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
      replyEditorStatus.textContent = saveReplyDraft(context)
        ? "Proposition prête à modifier. Brouillon conservé dans cet onglet." : "Proposition prête à modifier. Le navigateur ne peut pas conserver le brouillon.";
    } catch (error) {
      if (replyContext === context) replyEditorStatus.textContent = error.message;
    } finally {
      context.generating = false;
      if (replyContext === context) {
        replyGenerate.disabled = Boolean(context.requestId);
        replySend.disabled = false;
      }
    }
  });

  replySend.addEventListener("click", async () => {
    const context = replyContext;
    const message = replyDraft.value.trim();
    if (!context?.replyTo || context.generating || replySend.disabled) return;
    if (!message) { replyEditorStatus.textContent = "Rédigez votre réponse."; return; }
    if (!window.confirm("Envoyer cette réponse à " + context.replyTo.recipient + " ?")) return;
    replySend.disabled = true;
    context.requestId ||= crypto.randomUUID();
    if (!saveReplyDraft(context)) {
      context.requestId = null; replySend.disabled = false;
      replyEditorStatus.textContent = "Le navigateur ne peut pas mémoriser cet envoi. Aucun message envoyé."; return;
    }
    replyDraft.readOnly = replyGenerate.disabled = true;
    try {
      const result = await invokeEdgeFunction("gmail-web", { action: "send_reply",
        applicationId: context.applicationId, replyId: context.replyTo.id, recipient: context.replyTo.recipient, requestId: context.requestId, message });
      if (result.sent !== true) throw new Error("Gmail n’a pas confirmé l’envoi.");
      try { sessionStorage.removeItem(replyDraftKey(context)); } catch { /* Gmail a confirmé l’envoi. */ }
      context.requestId = null;
      if (replyContext !== context) return;
      replyDraft.value = ""; replyDraft.readOnly = replyGenerate.disabled = false;
      replyEditorStatus.textContent = result.tracked === false
        ? "Réponse envoyée dans Gmail. L’enregistrement du suivi est indisponible ; ne renvoyez pas le message."
        : "Réponse envoyée dans le fil Gmail.";
    } catch (error) {
      if (error.status && error.status < 500 && error.uncertain !== true) {
        context.requestId = null;
        if (replyContext === context) {
          replyDraft.readOnly = replyGenerate.disabled = false;
          saveReplyDraft(context);
        }
      }
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
    replyDraft.readOnly = replyGenerate.disabled = replySend.disabled = false;
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
      const messages = previews.map(item => ({ ...item, text: ((typeof item.text === "string" ? item.text.trim() : "") || gmailHtmlToText(item.html)).slice(0, 30000) }))
        .filter(item => item.text);
      const replies = messages.map(item => item.text);
      if (replies.length) {
        const application = button.closest(".application-row");
        replyContext = { userId, applicationId: button.dataset.openReply, replyTo: result.replyTo, body: replies.at(-1).slice(0, 8000),
          companyName: application.querySelector(".application-main strong").textContent,
          jobTitle: application.querySelector(".application-main span").textContent };
        replyEditor.hidden = false;
        replySend.hidden = !result.replyTo;
        restoreReplyDraft(replyContext);
      }
      replyContent.textContent = result.needsConsent ? "Autorisez la lecture pour afficher le message ici." :
        replies.length ? "" : "Le contenu de ce message est disponible dans Gmail.";
      for (const item of messages) {
        const content = item.text.replace(/\r\n?/g, "\n").trim();
        const quoted = /\n(?:_{8,}|-{3,}\s*(?:Original Message|Message d’origine)\s*-{3,}|On .+ wrote:|Le .+ a écrit\s*:|From:.*\nSent:|De :.*\nEnvoyé :)/i.exec(content);
        const split = quoted && quoted.index > 0 ? quoted.index : content.length;
        const message = document.createElement("article");
        message.className = "reply-message";
        const header = document.createElement("header"); header.className = "reply-message-header";
        if (item.subject) { const subject = document.createElement("strong"); subject.textContent = item.subject; header.append(subject); }
        if (item.from) { const from = document.createElement("span"); from.textContent = "De : " + item.from; header.append(from); }
        if (item.receivedAt && Number.isFinite(Date.parse(item.receivedAt))) {
          const date = document.createElement("time"); date.dateTime = item.receivedAt;
          date.textContent = new Intl.DateTimeFormat("fr-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(item.receivedAt));
          header.append(date);
        }
        if (item.automatic) { const badge = document.createElement("span"); badge.textContent = "Réponse automatique"; badge.className = "badge"; header.append(badge); }
        if (header.childNodes.length) message.append(header);
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
          const session = getSession();
          if (session?.user?.id === userId) await Promise.all([loadTracking(), updateTrackingCounts(session)]);
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
  let followupGeneration = 0;
  let followupAiBusy = 0;
  const followupDraftPrefix = "candidature-pro-followup:";

  function followupDraftKey(userId, id) { return followupDraftPrefix + userId + ":" + id; }
  function readFollowupDraft(userId, id) {
    try { return JSON.parse(sessionStorage.getItem(followupDraftKey(userId, id)) || "null"); }
    catch { return null; }
  }
  function saveFollowupDraft(userId, row) {
    try {
      sessionStorage.setItem(followupDraftKey(userId, row.id), JSON.stringify({
        message: row.editor.value, requestId: row.requestId || null, recipient: row.company_email
      }));
      return true;
    } catch { return false; }
  }

  document.querySelector("#followup-batch").addEventListener("click", () => {
    const userId = getSession()?.user?.id;
    if (!userId) return;
    followupRows = selectedFollowUps().map(row => ({ ...row }));
    if (!followupRows.length) {
      document.querySelector("#tracking-message").textContent = "Sélectionnez les dossiers à relancer.";
      return;
    }
    const generation = ++followupGeneration;
    followupAiBusy = 0;
    followupConfirm.disabled = false;
    followupDrafts.replaceChildren();
    for (const row of followupRows) {
      const saved = readFollowupDraft(userId, row.id);
      const restored = saved?.recipient === row.company_email && typeof saved.message === "string";
      row.requestId = restored && typeof saved.requestId === "string" ? saved.requestId : null;
      const card = document.createElement("article");
      card.className = "followup-draft";
      const choiceLabel = document.createElement("label");
      choiceLabel.className = "followup-include";
      const choice = document.createElement("input");
      choice.type = "checkbox"; choice.checked = true;
      choiceLabel.append(choice, document.createTextNode(row.company_name));
      const recipient = document.createElement("p");
      recipient.textContent = "À : " + row.company_email + (row.job_title ? " · " + row.job_title : "");
      const label = document.createElement("label");
      label.textContent = "Texte de la relance";
      const editor = document.createElement("textarea");
      const name = [profile?.candidate_first_name, profile?.candidate_last_name].filter(Boolean).join(" ");
      editor.value = restored ? saved.message : "Bonjour,\n\nJe me permets de revenir vers vous au sujet de ma candidature" +
        (row.job_title ? " pour le poste de " + row.job_title : "") +
        ". Je reste à votre disposition pour tout complément.\n\nCordialement," + (name ? "\n" + name : "");
      editor.maxLength = 12000; editor.rows = 7;
      editor.readOnly = Boolean(row.requestId);
      const status = document.createElement("p");
      status.setAttribute("role", "status");
      if (row.requestId) status.textContent = "Un envoi a déjà été demandé pour ce texte. Une nouvelle vérification utilisera le même identifiant pour éviter un doublon. Vérifiez aussi les messages envoyés dans Gmail.";
      const ai = document.createElement("button");
      ai.type = "button"; ai.className = "secondary";
      ai.textContent = "Proposer une relance avec IA";
      ai.disabled = Boolean(row.requestId);
      const suggestion = document.createElement("textarea");
      suggestion.readOnly = true; suggestion.hidden = true; suggestion.rows = 7;
      suggestion.setAttribute("aria-label", "Proposition de relance pour " + row.company_name);
      const use = document.createElement("button");
      use.type = "button"; use.className = "secondary";
      use.textContent = "Utiliser la proposition"; use.hidden = true;
      row.editor = editor; row.choice = choice; row.ai = ai; row.use = use; row.result = status;
      editor.addEventListener("input", () => {
        status.textContent = saveFollowupDraft(userId, row)
          ? "Brouillon conservé dans cet onglet." : "Le navigateur ne peut pas conserver ce brouillon.";
      });
      use.addEventListener("click", () => {
        if (row.requestId || followupConfirm.disabled) return;
        editor.value = suggestion.value;
        use.hidden = true;
        status.textContent = saveFollowupDraft(userId, row)
          ? "Proposition insérée. Relisez le texte avant l’envoi." : "Proposition insérée. Le navigateur ne peut pas conserver le brouillon.";
      });
      ai.addEventListener("click", async () => {
        if (ai.disabled || row.requestId || !followupDialog.open) return;
        ai.disabled = true; ++followupAiBusy; followupConfirm.disabled = true;
        use.hidden = true; suggestion.hidden = true;
        status.textContent = "Préparation de la proposition… Votre texte reste conservé.";
        const before = editor.value;
        try {
          const result = await invokeEdgeFunction("smart-reply", {
            mode: "followup", classification: "Relance sans réponse", companyName: row.company_name,
            jobTitle: row.job_title || "", candidateName: name || "le candidat",
            replyBody: "Aucune réponse humaine reçue. Rédiger une courte relance professionnelle de ma candidature. Ne pas inventer de réponse du recruteur ni de qualification. Texte à améliorer : " + before
          });
          if (generation !== followupGeneration || !followupDialog.open || getSession()?.user?.id !== userId) return;
          if (typeof result.reply !== "string" || !result.reply.trim() || result.reply.length > 12000) throw new Error("La proposition est vide ou trop longue.");
          suggestion.value = result.reply.trim(); suggestion.hidden = false; use.hidden = false;
          status.textContent = "Relisez la proposition avant de l’utiliser. Votre texte est conservé.";
        } catch (error) {
          if (generation === followupGeneration && getSession()?.user?.id === userId) status.textContent = error.message;
        } finally {
          if (generation === followupGeneration) {
            ai.disabled = Boolean(row.requestId); --followupAiBusy;
            followupConfirm.disabled = followupAiBusy > 0;
          }
        }
      });
      label.append(editor);
      card.append(choiceLabel, recipient, label, ai, status, suggestion, use);
      followupDrafts.append(card);
    }
    followupStatus.textContent = "Les textes modifiés sont conservés dans cet onglet jusqu’à l’envoi ou la déconnexion.";
    followupConfirm.hidden = false;
    followupDialog.showModal();
  });

  followupClose.addEventListener("click", () => followupDialog.close());
  followupDialog.addEventListener("close", () => { ++followupGeneration; });
  followupDialog.addEventListener("cancel", event => {
    if (followupConfirm.disabled && !followupAiBusy) event.preventDefault();
  });
  followupForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (followupConfirm.disabled || followupConfirm.hidden || followupAiBusy) return;
    const userId = getSession()?.user?.id;
    if (!userId) return;
    const rows = followupRows.filter(row => row.choice.checked);
    if (!rows.length) { followupStatus.textContent = "Sélectionnez au moins une relance."; return; }
    if (rows.some(row => !row.editor.value.trim())) {
      followupStatus.textContent = "Renseignez le texte de chaque relance sélectionnée.";
      return;
    }
    followupConfirm.disabled = followupClose.disabled = true;
    for (const row of followupRows) {
      row.editor.readOnly = true; row.choice.disabled = true; row.ai.disabled = true; row.use.disabled = true;
    }
    const results = [];
    try {
      for (const [index, row] of rows.entries()) {
        if (getSession()?.user?.id !== userId) break;
        followupStatus.textContent = "Relance " + (index + 1) + " sur " + rows.length + "…";
        try {
          row.requestId ||= crypto.randomUUID();
          if (!saveFollowupDraft(userId, row)) throw new Error("Le navigateur ne peut pas mémoriser cet envoi. Aucun message envoyé pour ce dossier.");
          const response = await invokeEdgeFunction("gmail-web", { action: "send_followup",
            applicationId: row.id, recipient: row.company_email, requestId: row.requestId, message: row.editor.value.trim() });
          if (response.sent !== true) throw new Error("Gmail n’a pas confirmé l’envoi.");
          sessionStorage.removeItem(followupDraftKey(userId, row.id));
          row.requestId = null;
          results.push(row.company_name + (response.tracked === false
            ? " · Relance envoyée, mise à jour du suivi indisponible" : " · Relance envoyée"));
        } catch (error) {
          results.push(row.company_name + " · " + error.message);
        }
      }
      if (getSession()?.user?.id === userId) {
        followupStatus.textContent = results.join("\n");
        await loadTracking();
      }
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

  const closedFollowUpStatuses = new Set(["interview", "accepted", "rejected"]);

  function canFollowUp(row) {
    const awaitingReply = !row.last_human_reply_at &&
      (row.last_inbound_at ? row.last_inbound_at === row.last_automatic_reply_at : row.status === "sent");
    return ["sent", "reply_received"].includes(row.status) && awaitingReply &&
      row.company_email && row.sent_at && !row.hidden_at;
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
      scheduled: row => Boolean(row.next_follow_up_at) && ["sent", "reply_received"].includes(row.status),
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
    updateFollowupSelection();
  }

  const followupReschedule = document.querySelector("#followup-reschedule");
  const followupSelectionStatus = document.querySelector("#followup-selection-status");
  const followupBatch = document.querySelector("#followup-batch");
  const followupSelectDue = document.querySelector("#followup-select-due");

  function selectedFollowUps() {
    const selection = new Set([...trackingList.querySelectorAll("[data-followup-choice]:checked")].map(input => input.value));
    return trackingRows.filter(row => selection.has(row.id) && canFollowUp(row));
  }

  function updateFollowupSelection() {
    const count = selectedFollowUps().length;
    followupBatch.disabled = count === 0;
    followupReschedule.hidden = count === 0;
    followupSelectDue.disabled = !trackingRows.some(followUpDue);
    followupSelectionStatus.textContent = count ? count + " dossier(s) sélectionné(s)." : "";
  }

  followupSelectDue.addEventListener("click", () => {
    trackingFilter.value = "due";
    trackingSearch.value = "";
    applyTrackingFilters();
    for (const item of trackingList.children) {
      const choice = item.querySelector("[data-followup-choice]");
      if (choice) choice.checked = !item.hidden;
    }
    updateFollowupSelection();
  });

  trackingList.addEventListener("change", event => {
    if (event.target.matches("[data-followup-choice]")) updateFollowupSelection();
  });

  followupReschedule.addEventListener("submit", async event => {
    event.preventDefault();
    const button = followupReschedule.querySelector("button");
    const rows = selectedFollowUps();
    const userId = getSession()?.user?.id;
    if (button.disabled || !rows.length || !userId) return;
    const date = followupReschedule.elements.date.value;
    const delay = Number(followupReschedule.elements.delay.value);
    button.disabled = true;
    try {
      const ids = rows.map(row => encodeURIComponent(row.id)).join(",");
      const result = await supabaseWrite("user_applications?id=in.(" + ids +
        ")&status=in.(sent,reply_received)&last_human_reply_at=is.null&hidden_at=is.null&select=id", "PATCH", {
        follow_up_delay_days: delay,
        next_follow_up_at: new Date(date + "T12:00:00").toISOString()
      });
      if (getSession()?.user?.id !== userId) return;
      await loadTracking();
      if (getSession()?.user?.id === userId) {
        followupSelectionStatus.textContent = result.length + " relance(s) reportée(s)." +
          (result.length < rows.length ? " Certains dossiers ont changé entre-temps." : "");
      }
    } catch (error) {
      if (getSession()?.user?.id === userId) followupSelectionStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  for (const [buttonId, filter] of [["dashboard-unread", "unread"], ["dashboard-followups", "scheduled"], ["dashboard-interviews", "interview"]]) {
    document.querySelector("#" + buttonId).addEventListener("click", () => {
      trackingSearch.value = "";
      trackingHidden.checked = false;
      trackingFilter.value = filter;
      showView("tracking");
    });
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

  trackingList.addEventListener("click", async event => {
    const button = event.target.closest("[data-tracking-resend]");
    const userId = getSession()?.user?.id;
    if (!button || button.disabled || !userId) return;
    const row = trackingRows.find(item => item.id === button.dataset.trackingResend);
    if (!row?.sent_at) return;
    if (!window.confirm("Créer un nouveau brouillon pour « " + row.company_name + " » ? L’ancien envoi et son suivi seront conservés. Vérifiez le destinataire, le texte et les PDF avant tout nouvel envoi.")) return;
    button.disabled = true;
    try {
      const result = await supabaseRpc("create_web_resend_draft", { p_application_id: row.id });
      if (getSession()?.user?.id !== userId) return;
      if (!result?.id) throw new Error("Le nouveau brouillon n’a pas pu être confirmé.");
      document.querySelector("#applications-search").value = row.company_name;
      document.querySelector("#applications-filter").value = "";
      document.querySelector("#show-hidden-applications").checked = Boolean(result.hidden);
      showView("applications");
      document.querySelector("#application-message").textContent = result.created
        ? "Renvoi préparé. Contrôlez le destinataire et ajoutez le texte et les documents avant l’envoi."
        : result.hidden ? "Un renvoi existe déjà dans les dossiers masqués. Réaffichez-le pour le préparer."
          : "Un renvoi est déjà en attente. Aucun doublon créé.";
    } catch (error) {
      if (getSession()?.user?.id === userId) trackingMessage.textContent = error.message;
    } finally { button.disabled = false; }
  });

  let trackingLoadRequest = 0;

  async function fetchTrackingRows(current) {
    const path = "user_applications?select=id,company_name,company_email,job_title,status,sent_at,next_follow_up_at,last_inbound_at,last_follow_up_sent_at,follow_up_delay_days,hidden_at,last_automatic_reply_at,last_human_reply_at,last_reply_read_at,notes,updated_at,last_activity_at" +
      "&status=in.(sent,reply_received,interview,accepted,rejected)";
    const rows = await fetchApplicationPages(path, current);
    const reminderTime = row => row.next_follow_up_at ? Date.parse(row.next_follow_up_at) : Infinity;
    return rows.sort((a, b) => reminderTime(a) - reminderTime(b) ||
      Date.parse(b.last_activity_at) - Date.parse(a.last_activity_at) || a.id.localeCompare(b.id));
  }

  async function loadTracking() {
    const message = document.querySelector("#tracking-message");
    const list = document.querySelector("#tracking-list");
    const showHidden = trackingHidden.checked;
    const userId = getSession()?.user?.id;
    const request = ++trackingLoadRequest;
    const current = () => request === trackingLoadRequest && getSession()?.user?.id === userId && trackingHidden.checked === showHidden;
    trackingRows = [];
    list.replaceChildren();
    updateFollowupSelection();
    if (!userId) {
      message.textContent = "Connectez-vous pour consulter le suivi.";
      return;
    }
    message.textContent = "Chargement…";
    try {
      const rows = await fetchTrackingRows(current);
      if (!current()) return;
      const activeRows = rows.filter(row => !row.hidden_at);
      document.querySelector("#tracking-sent-count").textContent = activeRows.filter(row => row.sent_at).length;
      document.querySelector("#tracking-reply-count").textContent = activeRows.filter(row => row.last_human_reply_at).length;
      document.querySelector("#tracking-automatic-count").textContent = activeRows.filter(row => row.last_automatic_reply_at).length;
      document.querySelector("#tracking-interview-count").textContent = activeRows.filter(row => row.status === "interview").length;
      document.querySelector("#tracking-due-count").textContent = activeRows.filter(followUpDue).length;
      trackingRows = showHidden ? rows.filter(row => row.hidden_at) : activeRows;
      list.innerHTML = trackingRows.map(row => {
        const showReminder = !closedFollowUpStatuses.has(row.status);
        const followUp = showReminder && row.next_follow_up_at ? new Date(row.next_follow_up_at) : null;
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
          (row.sent_at ? '<button type="button" class="secondary compact" data-tracking-resend="' + escapeHtml(row.id) + '">Préparer un nouvel envoi</button>' : '') +
          '<button type="button" class="secondary compact" data-tracking-edit="' + escapeHtml(row.id) + '">Modifier le statut ou la note</button>' +
          '<button type="button" class="secondary compact" data-tracking-visibility="'  + escapeHtml(row.id) + '">' +
          (row.hidden_at ? "Réafficher" : "Masquer du suivi") + '</button></div>' +
          (showReminder ? '<form class="application-form tracking-form" data-id="' + escapeHtml(row.id) + '">' +
          '<label>Date de relance<input name="follow-up" type="date" value="' + localDate + '"></label>' +
          '<label>Délai entre les relances (jours)<input name="follow-up-delay" type="number" required min="1" max="365" value="' + row.follow_up_delay_days + '"></label>' +
          '<button type="submit" class="secondary compact">Enregistrer</button></form>' : "") + '</article>';
      }).join("");
      applyTrackingFilters();
    } catch (error) {
      if (current()) message.textContent = error.message;
    }
  }

  document.querySelector("#tracking-list").addEventListener("submit", async event => {
    event.preventDefault();
    const form = event.target;
    const date = form.elements.namedItem("follow-up").value;
    const button = form.querySelector("button");
    if (button.disabled) return;
    button.disabled = true;
    try {
      const saved = await supabaseWrite("user_applications?id=eq." + encodeURIComponent(form.dataset.id) +
        "&status=not.in.(interview,accepted,rejected)&select=id", "PATCH", {
        follow_up_delay_days: Number(form.elements.namedItem("follow-up-delay").value),
        next_follow_up_at: date ? new Date(date + "T12:00:00").toISOString() : null
      });
      await loadTracking();
      if (!saved.length) trackingMessage.textContent = "Le rappel n’a pas été modifié car le dossier a changé.";
    } catch (error) {
      document.querySelector("#tracking-message").textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  const trackingDetails = document.querySelector("#tracking-details-dialog");
  const trackingDetailsForm = document.querySelector("#tracking-details-form");
  const trackingDetailsStatus = document.querySelector("#tracking-details-status");
  const trackingDetailsClose = document.querySelector("#tracking-details-close");
  const trackingDetailsSave = trackingDetailsForm.querySelector("[type=submit]");
  let trackingDetailsRow = null;

  trackingList.addEventListener("click", event => {
    const button = event.target.closest("[data-tracking-edit]");
    if (!button || trackingDetails.open) return;
    trackingDetailsRow = trackingRows.find(row => row.id === button.dataset.trackingEdit);
    if (!trackingDetailsRow) return;
    document.querySelector("#tracking-details-title").textContent = trackingDetailsRow.company_name;
    trackingDetailsForm.elements.status.value = trackingDetailsRow.status;
    trackingDetailsForm.elements.notes.value = trackingDetailsRow.notes || "";
    trackingDetailsStatus.textContent = "";
    trackingDetails.showModal();
  });

  trackingDetailsClose.addEventListener("click", () => trackingDetails.close());
  trackingDetails.addEventListener("cancel", event => {
    if (trackingDetailsSave.disabled) event.preventDefault();
  });
  trackingDetailsForm.addEventListener("submit", async event => {
    event.preventDefault();
    const row = trackingDetailsRow;
    const userId = getSession()?.user?.id;
    if (!row || !userId || trackingDetailsSave.disabled) return;
    trackingDetailsSave.disabled = trackingDetailsClose.disabled = true;
    try {
      const status = trackingDetailsForm.elements.status.value;
      const notes = trackingDetailsForm.elements.notes.value.trim() || null;
      const result = await supabaseWrite("user_applications?id=eq." + encodeURIComponent(row.id) +
        "&updated_at=eq." + encodeURIComponent(row.updated_at) + "&select=id", "PATCH", {
        status, notes, last_activity_at: new Date().toISOString(),
        ...(closedFollowUpStatuses.has(status) ? { next_follow_up_at: null } : {})
      });
      if (getSession()?.user?.id !== userId) return;
      if (!result.length) {
        await loadTracking();
        trackingDetailsStatus.textContent = "Le dossier a changé depuis son ouverture. Copiez votre note, puis rouvrez le dossier.";
        return;
      }
      trackingDetails.close();
      await loadTracking();
      if (getSession()?.user?.id === userId) trackingMessage.textContent = "Suivi enregistré.";
    } catch (error) {
      trackingDetailsStatus.textContent = error.message;
    } finally {
      trackingDetailsSave.disabled = trackingDetailsClose.disabled = false;
    }
  });

  const adminMode = document.querySelector("#admin-mode");
  const adminStatus = document.querySelector("#admin-status");
  const adminResults = document.querySelector("#admin-results");
  const adminViews = {
    blacklist: ["admin_list_blacklisted_companies", {}],
    audit: ["admin_list_audit_log", { p_limit: 100 }],
    statistics: ["admin_get_statistics", {}],
    online: ["admin_list_users", { p_search: "" }],
    credits: ["admin_get_credit_usage_statistics", { p_month: null }],
    "job-market": ["admin_job_market_refresh_statistics", {}],
    contacts: ["admin_list_company_email_change_requests", {}],
    invalid: ["admin_list_invalid_company_email_reports", {}],
    verification: ["admin_list_company_manual_verifications", {}],
    reports: ["admin_list_support_reports", {}],
    users: ["admin_list_users", { p_search: "" }],
    identity: ["admin_list_web_identity_requests", {}]
  };
  let adminRequest = 0;

  const adminUserControls = document.querySelector("#admin-user-controls"), adminUserSearch = document.querySelector("#admin-user-search");
  const adminCreditControls = document.querySelector("#admin-credit-controls"), adminCreditMonth = document.querySelector("#admin-credit-month");
  const adminUpdated = document.querySelector("#admin-updated");
  const monthParts = new Intl.DateTimeFormat("en", { timeZone: "Europe/Zurich", year: "numeric", month: "2-digit" }).formatToParts(new Date());
  const adminCurrentMonth = monthParts.find(part => part.type === "year").value + "-" + monthParts.find(part => part.type === "month").value;
  adminCreditMonth.max = adminCurrentMonth;
  let adminInFlight = null, adminSearchTimer = null;

  function renderAdminMetrics(rows, credits) {
    const descriptions = credits ? [
      ["summary", "Consommation totale"], ["provider", "Par fournisseur"], ["user", "Par utilisateur"], ["operation", "Par opération"]
    ] : [
      ["summary_searches", "Recherches d’entreprises"], ["summary_applications", "Candidatures comptabilisées"],
      ["search_sector", "Secteurs les plus recherchés"], ["top_company", "Entreprises les plus ciblées"], ["top_user", "Utilisateurs les plus actifs"]
    ];
    const displayed = new Set();
    function group(category, label) {
      const matching = rows.filter(row => row.category === category);
      if (!matching.length) return;
      displayed.add(category);
      const section = document.createElement("section"); section.className = "admin-metric-group";
      const title = document.createElement("h3"); title.textContent = label; section.append(title);
      const list = document.createElement("dl"); list.className = "admin-metric-list";
      for (const row of matching) {
        const line = document.createElement("div"), term = document.createElement("dt"), amount = document.createElement("dd");
        term.textContent = row.label || "Mesure";
        if (row.detail) { const note = document.createElement("small"); note.textContent = row.detail; term.append(note); }
        amount.textContent = credits ? window.CP_ADMIN_TOOLS.count(row.credits) + " crédits · " + window.CP_ADMIN_TOOLS.money(row.estimated_cost_chf) : window.CP_ADMIN_TOOLS.count(row.total);
        line.append(term, amount); list.append(line);
      }
      section.append(list); adminResults.append(section);
    }
    for (const [category, title] of descriptions) group(category, title);
    for (const row of rows) if (!displayed.has(row.category)) group(row.category, row.category || "Autres mesures");
    const caption = document.createElement("p"); caption.className = "muted";
    caption.textContent = credits ? "Coûts estimés selon les tarifs enregistrés lors des appels. La navigation dans les offres n’utilise pas de crédit de recherche."
      : "Statistiques partagées avec l’application Windows. Les candidatures comptabilisées correspondent aux envois confirmés. Ces totaux ne sont pas limités au mois affiché dans les crédits.";
    adminResults.append(caption);
  }

  async function touchWebPresence() {
    const userId = getSession()?.user?.id;
    if (!userId || !profile || document.hidden || webPresenceInFlight) return;
    const now = Date.now(), key = "candidature-pro-web-presence:" + userId;
    let lastAttempt = webPresenceLast.userId === userId ? webPresenceLast.time : 0;
    try { lastAttempt = Math.max(lastAttempt, Number(localStorage.getItem(key)) || 0); } catch { /* Memory throttle remains available. */ }
    if (lastAttempt <= now && now - lastAttempt < 60000) return;
    webPresenceLast = { userId, time: now };
    try { localStorage.setItem(key, String(now)); } catch { /* A storage restriction must not block the app. */ }
    webPresenceInFlight = true;
    try {
      const session = await ensureSession();
      if (session?.user?.id !== userId || document.hidden) return;
      await fetch(config.supabaseUrl + "/rest/v1/rpc/touch_my_profile", {
        method: "POST", headers: { apikey: config.supabasePublishableKey, Authorization: "Bearer " + session.access_token, "Content-Type": "application/json" },
        body: JSON.stringify({ p_app_version: "web-2026.11.18" }), signal: AbortSignal.timeout(10000)
      });
    } catch { /* Presence is approximate and must not block candidate actions. */ }
    finally { webPresenceInFlight = false; }
  }
  let webPresenceInFlight = false, webPresenceLast = { userId: null, time: 0 };
  setInterval(() => {
    void touchWebPresence();
    if (!document.hidden && profile?.is_admin === true && adminMode.value === "online" && document.querySelector("#admin-view").classList.contains("active")) void loadAdmin({ quiet: true });
  }, 30000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) void touchWebPresence(); });

  const verificationSources = new Map([
    ["replacement_after_invalid_email", "Remplacement d’un e-mail confirmé invalide"],
    ["no_contact_found", "Aucun contact trouvé automatiquement"],
    ["company_search", "Recherche d’entreprise"]
  ]);

  function appendVerificationDetails(card, row, current) {
    const source = document.createElement("p");
    const sourceKey = String(row.source || "").trim().toLowerCase();
    source.textContent = verificationSources.get(sourceKey) || "Vérification automatique";
    if (row.created_at) source.textContent += " · " + trackingDateFormat.format(new Date(row.created_at));
    card.append(source);

    const actions = document.createElement("div");
    actions.className = "batch-actions";
    const website = safeExternalUrl(row.website);
    if (website) {
      const link = document.createElement("a");
      link.className = "secondary compact";
      link.href = website;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = "Ouvrir le site";
      actions.append(link);
    }
    if (row.address) {
      const copy = document.createElement("button");
      copy.type = "button";
      copy.className = "secondary compact";
      copy.textContent = "Copier l’adresse";
      copy.addEventListener("click", async () => {
        try {
          await navigator.clipboard.writeText(row.address);
          if (current()) adminStatus.textContent = "Adresse copiée.";
        } catch {
          if (current()) adminStatus.textContent = "Impossible de copier l’adresse.";
        }
      });
      actions.append(copy);
    }
    if (actions.childElementCount) card.append(actions);
  }

  function administrativeActions(mode, row, current) {
    const form = document.createElement("form");
    form.className = "profile-form";
    if (mode === "verification") {
      form.innerHTML = '<label>Entreprise<input name="company" required maxlength="200"></label>' +
        '<label>Secteur<select name="sector" required></select></label>' +
        '<label>Adresse vérifiée<input name="email" type="email" maxlength="254"></label>' +
        '<label>Type de contact<select name="type"><option value="general">Général</option><option value="hr">RH</option></select></label>' +
        '<label class="wide">Note<input name="note" maxlength="2000"></label>' +
        '<div class="wide"><button type="submit" class="primary" value="email">Valider le contact</button> ' +
        '<button type="submit" class="secondary" value="not_found">Clôturer sans contact</button> ' +
        '<button type="submit" class="secondary" value="inactive">Ajouter à la liste noire</button></div>';
      form.elements.company.value = row.company_name || "";
      form.elements.type.value = "hr";
      for (const option of document.querySelector("#company-sector").options) {
        if (option.value) form.elements.sector.append(option.cloneNode(true));
      }
      form.elements.sector.prepend(new Option("Choisir un secteur", ""));
      form.elements.sector.value = row.sector || "";
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
      if (mode === "verification" && (!["email", "not_found", "inactive"].includes(action) || (action === "email" && !email))) {
        adminStatus.textContent = "Indiquez une adresse vérifiée pour valider le contact.";
        return;
      }
      if (mode === "verification" && !String(data.get("company")).trim()) {
        adminStatus.textContent = "Indiquez le nom de l’entreprise.";
        return;
      }
      if (mode === "verification" && action === "inactive" &&
          !window.confirm("Ajouter cette entreprise à la liste noire ? Elle sera masquée aux utilisateurs.")) return;
      buttons.forEach(button => button.disabled = true);
      try {
        let done;
        if (mode === "verification") {
          const company = String(data.get("company")).trim();
          const sector = data.get("sector");
          if (company !== row.company_name || sector !== row.sector) {
            const corrected = await supabaseRpc("admin_correct_company_manual_verification", {
              p_request_id: row.id, p_company_name: company, p_sector: sector
            });
            if (corrected === false) throw new Error("La correction du dossier n’a pas été enregistrée.");
          }
          if (!current()) return;
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

  function renderAdminJobMarket(row, current) {
    const form = document.createElement("form");
    form.className = "profile-form";
    form.innerHTML = '<p id="job-market-summary" class="wide"></p>' +
      '<label>Ville suisse<input name="city" value="Genève" required maxlength="120"></label>' +
      '<p class="wide">La recherche cible la ville indiquée. Vérifiez la localisation exacte de chaque annonce.</p>' +
      '<label class="wide">Métier ou mot-clé<input name="query" maxlength="120"></label>' +
      '<div class="wide"><button type="submit" class="primary">Actualiser les postes maintenant</button> ' +
      '<button type="button" data-action="refresh-job-stats" class="secondary">Rafraîchir les statistiques (gratuit)</button></div>' +
      '<p class="wide" role="status"></p>';
    const usedCredits = row?.month_credits_used;
    // Do not coerce null, missing or malformed statistics to a false zero.
    const knownBudget = typeof usedCredits === "number" &&
      Number.isSafeInteger(usedCredits) && usedCredits >= 0;
    const remainingCredits = knownBudget ? Math.max(0, 100 - usedCredits) : null;
    const serverRefreshRunning = row?.last_status === "running";
    const refreshBlocked = remainingCredits === null || remainingCredits === 0 || serverRefreshRunning;
    form.querySelector("#job-market-summary").textContent = knownBudget
      ? usedCredits + "/100 crédits Serper ce mois · " + remainingCredits + " restant(s) · " +
        (row.month_runs ?? 0) + " actualisation(s)" +
        (row.last_started_at ? " · Dernière exécution le " + trackingDateFormat.format(new Date(row.last_started_at)) : "")
      : "Budget Serper indisponible. Actualisation désactivée par précaution.";
    const button = form.querySelector('button[type="submit"]');
    const statsButton = form.querySelector('[data-action="refresh-job-stats"]');
    const status = form.querySelector("[role=status]");
    statsButton.addEventListener("click", () => {
      if (!current() || profile?.is_admin !== true) return;
      void loadAdmin();
    });
    if (refreshBlocked) {
      button.disabled = true;
      status.textContent = serverRefreshRunning
        ? "Une actualisation est déjà en cours sur le serveur. Rechargez les statistiques pour suivre son état."
        : remainingCredits === 0
          ? "Plafond mensuel atteint : aucune nouvelle recherche payante."
          : "Impossible de vérifier les crédits restants.";
    } else if (row?.last_status === "failed") {
      status.textContent = "La dernière actualisation a échoué. Vous pouvez réessayer.";
    } else if (row?.last_status === "completed") {
      status.textContent = "Dernière actualisation terminée : " +
        (row.last_offers_added ?? 0) + " offre(s) ajoutée(s), " +
        (row.last_credits_used ?? 0) + " crédit(s) réservé(s).";
    }
    form.addEventListener("submit", async event => {
      event.preventDefault();
      if (!current() || profile?.is_admin !== true || adminJobRefreshRunning || refreshBlocked) return;
      const city = form.elements.city.value.trim();
      if (!city) { status.textContent = "Indiquez une ville suisse."; return; }
      if (!window.confirm("Actualiser les offres pour " + city + " ? Cette recherche utilise des crédits Serper.")) return;
      adminJobRefreshRunning = button.disabled = true;
      status.textContent = "Actualisation en cours…";
      try {
        const result = await invokeEdgeFunction("job-market-refresh", {
          city, query: form.elements.query.value.trim()
        }, false);
        if (!current()) return;
        const outcome = result.status === "completed"
          ? (result.added ?? 0) + " offre(s) ajoutée(s) · " + (result.credits ?? 0) + " crédit(s) utilisé(s)."
          : result.message || "Actualisation interrompue.";
        await loadAdmin();
        if (adminMode.value === "job-market" && profile?.is_admin === true) adminStatus.textContent = outcome;
      } catch (error) {
        if (current()) status.textContent = error.message;
      } finally {
        adminJobRefreshRunning = false;
        // Do not re-enable a budget-blocked action, even after a failed request.
        button.disabled = refreshBlocked;
      }
    });
    adminResults.append(form);
  }

  let adminJobRefreshRunning = false;

  async function loadAdmin({ quiet = false } = {}) {
    if (profile?.is_admin !== true) return;
    const userId = getSession()?.user?.id;
    const mode = adminMode.value;
    if (!userId || !Object.hasOwn(adminViews, mode)) return;
    if (quiet && adminInFlight?.userId === userId && adminInFlight?.mode === mode) return;
    const request = ++adminRequest;
    adminInFlight = { userId, mode, request };
    adminUserControls.hidden = mode !== "users";
    adminCreditControls.hidden = mode !== "credits";
    const [rpc, defaults] = adminViews[mode];
    const args = { ...defaults };
    if (mode === "users") args.p_search = adminUserSearch.value.trim();
    if (mode === "credits") {
      try { args.p_month = window.CP_ADMIN_TOOLS.monthParameter(adminCreditMonth.value, adminCurrentMonth); }
      catch (error) { adminStatus.textContent = error.message; adminInFlight = null; return; }
    }
    if (!quiet) { adminResults.replaceChildren(); adminUpdated.textContent = ""; adminStatus.textContent = "Chargement…"; }
    const current = () => request === adminRequest && getSession()?.user?.id === userId && profile?.is_admin === true && adminMode.value === mode;
    try {
      let rows = await supabaseRpc(rpc, args);
      if (!current()) return;
      if (!Array.isArray(rows)) throw new Error("La réponse d’administration est invalide.");
      adminResults.replaceChildren();
      adminUpdated.textContent = "Actualisé à " + new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", timeStyle: "short" }).format(new Date());
      if (["statistics", "credits"].includes(mode)) {
        adminStatus.textContent = rows.length ? "" : "Aucune donnée pour cette période.";
        renderAdminMetrics(rows, mode === "credits"); return;
      }
      if (mode === "online") {
        rows = window.CP_ADMIN_TOOLS.onlineUsers(rows);
        adminStatus.textContent = rows.length + " utilisateur(s) actif(s) au cours des 2 dernières minutes, parmi les 100 comptes les plus récents. Actualisation toutes les 30 secondes lorsque cette vue est visible.";
      }
      if (mode === "job-market") {
        adminStatus.textContent = "";
        renderAdminJobMarket(rows[0], current);
        return;
      }
      if (mode !== "online") adminStatus.textContent = rows.length ? (mode === "users" ? rows.length + " compte(s) affiché(s), au maximum 100. Affinez la recherche pour retrouver un compte plus ancien." : "") : "Aucun résultat.";
      for (const row of rows) {
        const card = document.createElement("article");
        card.className = "application-row";
        const title = document.createElement("strong");
        title.textContent = mode === "identity" ? [row.current_first_name, row.current_last_name, row.current_email].filter(Boolean).join(" · ") : row.company_name || row.label || row.title || row.email || row.action || "";
        const details = document.createElement("p");
        details.textContent = mode === "identity" ? "Identité demandée : " + [row.requested_first_name, row.requested_last_name, row.requested_email].filter(Boolean).join(" · ") + " — Motif : " + row.reason : mode === "blacklist" ? [row.city, row.sector, row.inactive_reason, row.inactive_at ? trackingDateFormat.format(new Date(row.inactive_at)) : ""].filter(Boolean).join(" · ") :
          mode === "audit" ? [row.summary, row.created_at].filter(Boolean).join(" · ") :
          mode === "credits" ? [row.category, row.credits + " crédits", row.estimated_cost_chf + " CHF", row.detail].filter(Boolean).join(" · ") :
          mode === "contacts" ? [row.city, row.current_email, row.proposed_email, row.reply_subject, row.reply_body].filter(Boolean).join(" · ") :
          mode === "invalid" ? [row.email, row.reason, row.reply_subject, row.reply_body].filter(Boolean).join(" · ") :
          mode === "verification" ? [row.city, row.address, row.website, row.status].filter(Boolean).join(" · ") :
          mode === "reports" ? [row.category, row.description, row.steps, row.status].filter(Boolean).join(" · ") :
          [row.plan === "premium" ? "Premium" : "Gratuit", row.is_admin ? "Administrateur" : "", mode === "online" ? "Actif récemment" : "", row.last_seen_at ? "Dernière activité : " + new Intl.DateTimeFormat("fr-CH", { timeZone: "Europe/Zurich", dateStyle: "medium", timeStyle: "short" }).format(new Date(row.last_seen_at)) : "Aucune activité enregistrée"].filter(Boolean).join(" · ");
        card.append(title, details);
        if (mode === "verification") appendVerificationDetails(card, row, current);
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
        if (mode === "contacts" || mode === "invalid" || mode === "identity") {
          const review = document.createElement("form");
          review.innerHTML = '<label>Note administrateur<input name="note" maxlength="2000"></label>' +
            '<button type="submit" class="primary" value="approve">' +
            (mode === "identity" ? "Approuver la correction d’identité" : mode === "contacts" ? "Approuver le changement" : "Confirmer l’adresse invalide") +
            '</button> <button type="submit" class="secondary" value="reject">Refuser</button>';
          review.addEventListener("submit", async event => {
            event.preventDefault();
            if (!event.submitter || !current() || profile?.is_admin !== true) return;
            const approved = event.submitter.value === "approve";
            if (mode === "identity" && approved && !window.confirm("Approuver cette correction d’identité pour " + (row.current_email || row.user_id) + " ? Nouvelle identité : " + [row.requested_first_name, row.requested_last_name, row.requested_email].join(" · "))) return;
            const note = new FormData(review).get("note");
            const buttons = review.querySelectorAll("button");
            buttons.forEach(button => button.disabled = true);
            try {
              const done = mode === "identity" ? await supabaseRpc("admin_review_web_identity_request", { p_request_id: row.id, p_approve: approved, p_note: note }) : mode === "contacts"
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
    } finally { if (adminInFlight?.request === request) adminInFlight = null; }
  }

  adminMode.addEventListener("change", loadAdmin);
  document.querySelector("#admin-refresh").addEventListener("click", loadAdmin);
  adminUserSearch.addEventListener("input", () => {
    clearTimeout(adminSearchTimer);
    adminSearchTimer = setTimeout(() => { if (adminMode.value === "users" && document.querySelector("#admin-view").classList.contains("active")) void loadAdmin(); }, 350);
  });
  adminCreditMonth.addEventListener("change", loadAdmin);
  document.querySelector("#admin-credit-current").addEventListener("click", () => { adminCreditMonth.value = adminCurrentMonth; void loadAdmin(); });
  document.querySelector("#admin-credit-all").addEventListener("click", () => { adminCreditMonth.value = ""; void loadAdmin(); });

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
  const cvFieldNames = ["name", "title", "contact", "summary", "experience", "education", "skills", "target", "offer", "template", "photo"];
  let savedCvVariants = [];
  let editingCvId = null;

  const cvTemplateNames = { classic: "Classique", modern: "Contemporain", compact: "Compact" };
  function syncCvStudio() {
    const form = document.querySelector("#cv-form");
    if (!form) return;
    const template = form.elements.template.value || "classic";
    document.querySelectorAll("[data-cv-template]").forEach(button => {
      const premiumLocked = button.dataset.cvTemplate !== "classic" && !hasPremiumCv();
      button.setAttribute("aria-pressed", String(button.dataset.cvTemplate === template));
      button.classList.toggle("is-selected", button.dataset.cvTemplate === template);
      button.classList.toggle("is-locked", premiumLocked);
      button.setAttribute("aria-label", button.querySelector("strong").textContent.trim() + (premiumLocked ? " — nécessite Premium" : ""));
    });
    const paper = document.querySelector("#cv-live-paper");
    paper.dataset.template = template;
    document.querySelector("#cv-live-style").textContent = cvTemplateNames[template] || "Classique";
    for (const [field, fallback] of [["name", "Votre nom"], ["title", "Votre métier"], ["contact", ""], ["summary", "Une courte présentation de votre parcours apparaîtra ici."], ["experience", "Vos expériences et réalisations."], ["education", "Vos études et certifications."], ["skills", "Vos points forts."]]) {
      document.querySelector("#cv-live-" + field).textContent = form.elements.namedItem(field).value.trim() || fallback;
    }
  }
  document.querySelectorAll("[data-cv-template]").forEach(button => button.addEventListener("click", () => {
    if (button.dataset.cvTemplate !== "classic" && !hasPremiumCv()) {
      cvSaveStatus.textContent = "Ce modèle nécessite Premium. Vous pouvez continuer avec le modèle Classique.";
      document.querySelector("#cv-premium-access-status").scrollIntoView({ block: "nearest", behavior: "smooth" });
      return;
    }
    cvForm.elements.template.value = button.dataset.cvTemplate;
    syncCvStudio();
  }));
  cvForm.addEventListener("input", syncCvStudio);
  cvForm.addEventListener("change", syncCvStudio);

  const cvPdfFile = document.querySelector("#cv-pdf-file"), cvPdfStatus = document.querySelector("#cv-pdf-status");
  const cvPdfText = document.querySelector("#cv-pdf-text"), cvPdfReview = document.querySelector("#cv-pdf-review");
  const cvPdfCancel = document.querySelector("#cv-pdf-cancel");
  const cvImportSections = document.querySelector("#cv-import-sections"), cvImportDetectStatus = document.querySelector("#cv-import-detect-status");
  const cvImportKeys = ["summary", "experience", "education", "skills"];
  let cvImportContext = null;
  function resetCvImportSections() {
    cvImportContext = null; cvImportSections.hidden = true; cvImportDetectStatus.textContent = "";
    for (const key of cvImportKeys) {
      document.querySelector("#cv-import-" + key).value = "";
      document.querySelector("#cv-import-" + key + "-check").checked = false;
    }
  }
  let cvPdfRequest = 0, cvPdfAbort = null;
  function clearCvPdfImport() {
    ++cvPdfRequest; cvPdfAbort?.abort(); cvPdfAbort = null; resetCvImportSections();
    cvPdfFile.value = cvPdfText.value = cvPdfStatus.textContent = "";
    cvPdfReview.hidden = cvPdfCancel.hidden = true; cvPdfFile.disabled = false;
  }
  cvPdfCancel.addEventListener("click", () => { clearCvPdfImport(); cvPdfStatus.textContent = "Lecture annulée."; });
  cvPdfFile.addEventListener("change", async () => {
    const file = cvPdfFile.files?.[0], userId = getSession()?.user?.id;
    if (!file || !userId) return;
    resetCvImportSections();
    cvPdfAbort?.abort(); const controller = new AbortController(); cvPdfAbort = controller;
    const request = ++cvPdfRequest;
    const current = () => request === cvPdfRequest && getSession()?.user?.id === userId;
    cvPdfFile.disabled = true; cvPdfCancel.hidden = false; cvPdfReview.hidden = true;
    cvPdfText.value = ""; cvPdfStatus.textContent = "Lecture du CV sur cet appareil…";
    try {
      const result = await window.CP_CV_IMPORT.extract(file, (page, total) => {
        if (current()) cvPdfStatus.textContent = "Lecture de la page " + page + " sur " + total + "…";
      }, controller.signal);
      if (!current()) return;
      cvPdfText.value = result.text; cvPdfReview.hidden = false;
      cvPdfStatus.textContent = (result.pages ? result.pages + " page(s) lue(s). " : "CV " + result.format + " lu. ") + "Relisez le texte avant de l’ajouter au formulaire. Aucun CV enregistré n’a été modifié.";
    } catch (error) { if (current()) cvPdfStatus.textContent = error.name === "AbortError" ? "Lecture annulée." : error.message; }
    finally { if (current()) { cvPdfFile.disabled = false; cvPdfCancel.hidden = true; cvPdfAbort = null; } }
  });
  document.querySelector("#cv-pdf-insert").addEventListener("click", () => {
    if (!getSession()?.user?.id || cvPdfReview.hidden || cvForm.dataset.saving) return;
    const name = document.querySelector("#cv-pdf-target").value;
    if (!["summary", "experience", "education", "skills", "contact"].includes(name)) return;
    const field = cvForm.elements.namedItem(name), text = cvPdfText.value.trim();
    if (!text) { cvPdfStatus.textContent = "Gardez le texte à ajouter dans la zone de relecture."; return; }
    const value = [field.value.trim(), text].filter(Boolean).join("\n\n");
    if (value.length > field.maxLength) { cvPdfStatus.textContent = "Cette rubrique accepte " + field.maxLength + " caractères. Réduisez le texte à insérer ; votre formulaire a été conservé."; return; }
    field.value = value;
    syncCvStudio();
    cvPdfStatus.textContent = "Texte ajouté au formulaire. Vérifiez la mise en page, puis enregistrez la variante pour conserver la modification.";
  });

  document.querySelector("#cv-import-detect").addEventListener("click", () => {
    const userId = getSession()?.user?.id;
    if (!userId || cvPdfReview.hidden) return;
    const result = window.CP_CV_IMPORT.partition(cvPdfText.value);
    resetCvImportSections();
    cvImportContext = { userId, variant: editingCvId, loadRequest: cvLoadRequest,
      fields: Object.fromEntries(cvImportKeys.map(key => [key, cvForm.elements.namedItem(key).value])) };
    const available = [];
    for (const key of cvImportKeys) {
      const text = result.fields[key], proposal = document.querySelector("#cv-import-" + key);
      proposal.value = text;
      const fits = text.length <= cvForm.elements.namedItem(key).maxLength;
      document.querySelector("#cv-import-" + key + "-check").checked = Boolean(text) && fits;
      if (text) available.push(key);
    }
    cvImportSections.hidden = false;
    cvImportDetectStatus.textContent = available.length
      ? available.length + " rubrique(s) reconnue(s). Relisez les propositions ; réduisez les textes trop longs avant de les cocher." + (result.unassigned ? " Certaines lignes restent à répartir manuellement depuis le texte source." : "")
      : "Aucune rubrique reconnue. Utilisez l’ajout manuel ci-dessous, ou ajoutez des titres tels que Expériences, Formation et Compétences dans le texte source.";
  });
  document.querySelector("#cv-import-apply").addEventListener("click", () => {
    const context = cvImportContext;
    if (!context || cvImportSections.hidden || cvForm.dataset.saving) return;
    if (context.userId !== getSession()?.user?.id || context.variant !== editingCvId || context.loadRequest !== cvLoadRequest) {
      cvImportDetectStatus.textContent = "Le CV affiché a changé. Détectez à nouveau les rubriques avant de les ajouter."; return;
    }
    const selected = cvImportKeys.filter(key => document.querySelector("#cv-import-" + key + "-check").checked);
    if (!selected.length) { cvImportDetectStatus.textContent = "Cochez au moins une rubrique à ajouter."; return; }
    const updates = [];
    for (const key of selected) {
      const field = cvForm.elements.namedItem(key), proposal = document.querySelector("#cv-import-" + key).value.trim();
      if (field.value !== context.fields[key]) { cvImportDetectStatus.textContent = "Le formulaire a été modifié. Vos changements sont conservés ; détectez à nouveau les rubriques."; return; }
      if (!proposal) { cvImportDetectStatus.textContent = "Une rubrique cochée est vide. Complétez-la ou décochez-la."; return; }
      const value = [field.value.trim(), proposal].filter(Boolean).join("\n\n");
      if (value.length > field.maxLength) { cvImportDetectStatus.textContent = "Une rubrique dépasse sa limite de " + field.maxLength + " caractères avec le contenu actuel. Réduisez la proposition ; aucun champ n’a été modifié."; return; }
      updates.push([field, value]);
    }
    for (const [field, value] of updates) field.value = value;
    syncCvStudio();
    resetCvImportSections();
    cvPdfStatus.textContent = updates.length + " rubrique(s) ajoutée(s) au formulaire. Relisez le CV puis enregistrez la variante pour conserver ces modifications.";
  });

  const cvPhotoFile = document.querySelector("#cv-photo-file");
  const cvPhotoThumbnail = document.querySelector("#cv-photo-thumbnail");
  const cvPhotoStatus = document.querySelector("#cv-photo-status");
  const cvPhotoRemove = document.querySelector("#cv-photo-remove");
  let cvPhotoRequest = 0, cvPhotoPreparing = false;
  function cvPhotoReady() {
    if (!cvPhotoPreparing) return true;
    cvSaveStatus.textContent = "Attendez la fin de la préparation de la photo avant d’enregistrer ou d’exporter le CV.";
    return false;
  }

  function validCvPhoto(value) {
    return typeof value === "string" && value.length <= 100000 &&
      /^data:image\/(?:jpeg|png);base64,(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(value) &&
      (value.startsWith("data:image/jpeg;base64,/9j/") || value.startsWith("data:image/png;base64,iVBORw0KGgo"));
  }

  function renderCvPhoto() {
    const photo = cvForm.elements.namedItem("photo");
    const visible = validCvPhoto(photo.value);
    if (visible) cvPhotoThumbnail.src = photo.value;
    else { photo.value = ""; cvPhotoThumbnail.removeAttribute("src"); }
    cvPhotoThumbnail.hidden = cvPhotoRemove.hidden = !visible;
  }

  cvPhotoRemove.addEventListener("click", () => {
    ++cvPhotoRequest; cvPhotoPreparing = false;
    cvForm.elements.namedItem("photo").value = ""; cvPhotoFile.value = "";
    renderCvPhoto();
    cvPhotoStatus.textContent = "Photo retirée du formulaire. Enregistrez la variante pour conserver cette modification.";
  });

  cvPhotoFile.addEventListener("change", async () => {
    const file = cvPhotoFile.files?.[0];
    const userId = getSession()?.user?.id;
    if (!file || !userId) return;
    const request = ++cvPhotoRequest; cvPhotoPreparing = false;
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 5 * 1024 * 1024) {
      cvPhotoStatus.textContent = "Choisissez une image JPG ou PNG de 5 Mo maximum."; cvPhotoFile.value = ""; return;
    }
    cvPhotoPreparing = true; cvPhotoStatus.textContent = "Préparation de la photo…";
    let bitmap;
    try {
      bitmap = await createImageBitmap(file);
      if (!bitmap.width || !bitmap.height || bitmap.width * bitmap.height > 25000000) throw new Error("Choisissez une photo de 25 mégapixels maximum.");
      const ratio = Math.min(256 / bitmap.width, 320 / bitmap.height, 1);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * ratio));
      canvas.height = Math.max(1, Math.round(bitmap.height * ratio));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Le navigateur ne peut pas préparer cette photo.");
      context.fillStyle = "#ffffff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const photo = canvas.toDataURL("image/jpeg", .82);
      if (!validCvPhoto(photo)) throw new Error("La photo reste trop volumineuse. Choisissez une image plus simple.");
      if (request !== cvPhotoRequest || getSession()?.user?.id !== userId) return;
      cvForm.elements.namedItem("photo").value = photo; renderCvPhoto();
      cvPhotoStatus.textContent = "Photo prête. Elle sera conservée lorsque vous enregistrerez la variante.";
    } catch (error) {
      if (request === cvPhotoRequest && getSession()?.user?.id === userId) cvPhotoStatus.textContent = error.message || "Impossible de lire cette photo.";
    } finally {
      bitmap?.close();
      if (request === cvPhotoRequest) { cvPhotoFile.value = ""; cvPhotoPreparing = false; }
    }
  });

  document.querySelector("#cv-use-profile").addEventListener("click", async event => {
    const button = event.currentTarget;
    const userId = getSession()?.user?.id;
    if (!userId || button.disabled) return;
    const variant = editingCvId;
    button.disabled = true;
    try {
      const details = await fetchProfileDetails(userId);
      if (getSession()?.user?.id !== userId || editingCvId !== variant) return;
      const suggestions = {
        name: [profile?.candidate_first_name, profile?.candidate_last_name].filter(Boolean).join(" "),
        title: (details.desired_jobs || "").split(/[;\n]/)[0].trim(),
        contact: [profile?.candidate_email || getSession().user.email, details.phone, details.city].filter(Boolean).join(" · "),
        skills: [details.skills, details.languages].filter(Boolean).join("\n")
      };
      let filled = 0;
      for (const [name, value] of Object.entries(suggestions)) {
        const input = cvForm.elements.namedItem(name);
        if (!input.value.trim() && value) {
          input.value = value.slice(0, input.maxLength);
          filled++;
        }
      }
      syncCvStudio();
      cvSaveStatus.textContent = filled ? "Champs vides complétés avec le profil." : "Aucun champ vide à compléter avec le profil.";
    } catch (error) {
      if (getSession()?.user?.id === userId) cvSaveStatus.textContent = error.message;
    } finally {
      button.disabled = false;
    }
  });

  async function loadCvVariants() {
    const userId = getSession()?.user?.id;
    if (!userId) return;
    try {
      const rows = await supabaseFetch("web_cv_variants?select=id,label&order=updated_at.desc&limit=200");
      if (getSession()?.user?.id !== userId) return;
      savedCvVariants = rows;
      cvVariants.length = 1;
      for (const row of rows) cvVariants.add(new Option(row.label, row.id));
      cvVariants.value = editingCvId || "";
    } catch (error) {
      if (getSession()?.user?.id === userId) cvSaveStatus.textContent = error.message;
    }
  }

  let cvLoadRequest = 0;
  document.querySelector("#cv-load").addEventListener("click", async event => {
    const selected = savedCvVariants.find(row => row.id === cvVariants.value);
    const userId = getSession()?.user?.id;
    const button = event.currentTarget;
    if (!selected || !userId || button.disabled || cvForm.dataset.saving) return;
    const request = ++cvLoadRequest;
    const before = JSON.stringify(cvFieldNames.map(name => cvForm.elements.namedItem(name).value));
    const beforeLabel = cvLabel.value;
    const beforeVariant = editingCvId;
    button.disabled = true;
    try {
      const [variant] = await supabaseFetch("web_cv_variants?id=eq." + encodeURIComponent(selected.id) + "&select=id,label,fields");
      if (request !== cvLoadRequest || getSession()?.user?.id !== userId || cvVariants.value !== selected.id) return;
      if (!variant) throw new Error("Cette variante n’est plus disponible.");
      if (beforeLabel !== cvLabel.value || beforeVariant !== editingCvId || before !== JSON.stringify(cvFieldNames.map(name => cvForm.elements.namedItem(name).value))) throw new Error("Vos modifications ont été conservées. Rouvrez le CV lorsque vous êtes prêt à remplacer le formulaire.");
      for (const name of cvFieldNames) cvForm.elements.namedItem(name).value = typeof variant.fields[name] === "string" ? variant.fields[name] : "";
      if (!cvForm.elements.template.value || (!hasPremiumCv() && cvForm.elements.template.value !== "classic")) {
        cvForm.elements.template.value = "classic";
      }
      syncCvStudio();
      ++cvPhotoRequest; cvPhotoPreparing = false; cvPhotoFile.value = ""; renderCvPhoto();
      cvPhotoStatus.textContent = "La photo affichée appartient à cette variante.";
      cvLabel.value = variant.label;
      editingCvId = variant.id;
      document.querySelector("#cv-target-context").textContent = "";
      cvSaveStatus.textContent = "Variante ouverte.";
      document.querySelector("#cv-analysis-target").value = variant.fields.target || "";
      cvAnalysisResults.hidden = true; cvAnalysisStatus.textContent = "";
    } catch (error) {
      if (request === cvLoadRequest && getSession()?.user?.id === userId) cvSaveStatus.textContent = error.message;
    } finally { button.disabled = false; }
  });

  document.querySelector("#cv-new").addEventListener("click", () => {
    ++cvLoadRequest; ++cvPhotoRequest; cvPhotoPreparing = false; clearCvPdfImport();
    cvForm.reset(); cvForm.elements.namedItem("photo").value = ""; renderCvPhoto();
    syncCvStudio();
    cvPhotoStatus.textContent = "La photo sera conservée avec la variante lorsque vous l’enregistrez.";
    editingCvId = null;
    document.querySelector("#cv-target-context").textContent = "";
    document.querySelector("#cv-adapt-status").textContent = "";
    cvSaveStatus.textContent = "";
    document.querySelector("#cv-analysis-target").value = "";
    cvAnalysisResults.hidden = true; cvAnalysisStatus.textContent = "";
  });

  const cvDelete = document.querySelector("#cv-delete");
  cvDelete.addEventListener("click", async () => {
    const userId = getSession()?.user?.id;
    const variant = savedCvVariants.find(row => row.id === cvVariants.value);
    if (!userId || cvForm.dataset.saving || cvDelete.disabled) return;
    if (!variant) { cvSaveStatus.textContent = "Sélectionnez la variante à supprimer."; return; }
    if (!window.confirm("Supprimer définitivement la variante « " + variant.label + " » ?")) return;
    cvDelete.disabled = true;
    try {
      const removed = await supabaseWrite("web_cv_variants?id=eq." + encodeURIComponent(variant.id) + "&select=id", "DELETE");
      if (getSession()?.user?.id !== userId) return;
      if (editingCvId === variant.id) editingCvId = null;
      await loadCvVariants();
      if (getSession()?.user?.id === userId) {
        cvSaveStatus.textContent = removed.length
          ? "Variante supprimée. Le formulaire conserve le texte affiché."
          : "Cette variante avait déjà été retirée.";
      }
    } catch (error) {
      if (getSession()?.user?.id === userId) cvSaveStatus.textContent = error.message;
    } finally {
      cvDelete.disabled = false;
    }
  });

  for (const [buttonId, copy] of [["cv-save", false], ["cv-save-copy", true]]) {
    document.querySelector("#" + buttonId).addEventListener("click", async () => {
      const userId = getSession()?.user?.id;
      if (!userId || cvForm.dataset.saving || cvDelete.disabled || !cvForm.reportValidity() || !cvPhotoReady()) return;
      const fields = Object.fromEntries(cvFieldNames.map(name => [name, cvForm.elements.namedItem(name).value.trim()]));
      if (!hasPremiumCv() && fields.template !== "classic") {
        cvSaveStatus.textContent = "Le modèle sélectionné nécessite Premium. Choisissez Classique pour enregistrer ce CV.";
        return;
      }
      const label = cvLabel.value.trim() || fields.title;
      if (new TextEncoder().encode(JSON.stringify(fields)).length > 150000) {
        cvSaveStatus.textContent = "Le CV est trop volumineux. Réduisez le texte ou retirez la photo avant d’enregistrer."; return;
      }
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

  const cvAnalyze = document.querySelector("#cv-analyze");
  const cvAnalysisStatus = document.querySelector("#cv-analysis-status");
  const cvAnalysisResults = document.querySelector("#cv-analysis-results");
  const cvAnalysisHistory = document.querySelector("#cv-analysis-history");
  const cvAnalysisHistoryStatus = document.querySelector("#cv-analysis-history-status");
  const cvAnalysisClear = document.querySelector("#cv-analysis-clear");
  let cvAnalysisRequest = 0;

  function analyzeCvFields(fields, target) {
    const skills = fields.skills.split(/[;\n]+/).map(value => value.trim()).filter(Boolean);
    const text = [fields.title, fields.summary, fields.experience, fields.education, fields.skills].join("\n");
    const normalize = value => value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
    const corpus = normalize(text);
    const tokens = [...new Set(normalize(target).split(/[^\p{L}\p{N}+#]+/u).filter(value => value.length >= 3))];
    const structure = 80 + (fields.title.trim() ? 10 : 0) + (skills.length >= 5 ? 10 : 0);
    const content = text.trim() ? Math.min(100, 70 + (text.length >= 800 ? 20 : 10)) : 55;
    const keywords = tokens.length ? Math.round(tokens.filter(word => corpus.includes(word)).length * 100 / tokens.length) : 50;
    const readability = fields.template === "modern" ? 90 : fields.template === "classic" ? 95 : 85;
    const ats = fields.template === "modern" ? 88 : fields.template === "classic" ? 95 : 84;
    const overall = Math.round(structure * .25 + content * .25 + keywords * .20 + readability * .15 + ats * .15);
    const findings = [];
    if (!fields.title.trim()) findings.push("Ajoutez un titre professionnel clair.");
    if (!fields.summary.trim()) findings.push("Ajoutez un court profil professionnel.");
    if (skills.length < 5) findings.push("Complétez les compétences avec vos savoir-faire réels, une compétence par ligne.");
    if (!fields.experience.trim()) findings.push("Renseignez les expériences et les réalisations pertinentes.");
    if (!/(?:19[89]\d|20\d\d)/.test(fields.experience + fields.education)) findings.push("Précisez les dates des expériences et des formations.");
    if (!target.trim()) findings.push("Indiquez un métier cible pour préciser l’analyse des mots-clés.");
    else if (keywords < 70) findings.push("Le métier cible apparaît peu dans le CV. Ajoutez uniquement les termes correspondant à votre expérience.");
    if (fields.experience.split("\n").some(line => line.length > 180)) findings.push("Raccourcissez les paragraphes les plus longs pour faciliter la lecture.");
    if (!findings.length) findings.push("Les rubriques essentielles sont présentes. Vérifiez les faits, les coordonnées et la présentation du PDF avant l’envoi.");
    return { overall, structure, content, keywords, readability, ats, findings };
  }

  function renderCvAnalysis(report) {
    cvAnalysisResults.replaceChildren();
    const score = document.createElement("p");
    score.className = "cv-analysis-score";
    score.textContent = report.overall + "/100";
    cvAnalysisResults.append(score);
    for (const [key, label] of [["structure", "Structure"], ["content", "Contenu"], ["keywords", "Mots-clés"], ["readability", "Lisibilité"], ["ats", "Compatibilité ATS"]]) {
      const line = document.createElement("label");
      line.className = "cv-analysis-metric";
      const caption = document.createElement("span"); caption.textContent = label + " · " + report[key] + "/100";
      const bar = document.createElement("progress"); bar.max = 100; bar.value = report[key];
      line.append(caption, bar); cvAnalysisResults.append(line);
    }
    const list = document.createElement("ul");
    for (const finding of report.findings) { const item = document.createElement("li"); item.textContent = finding; list.append(item); }
    cvAnalysisResults.append(list); cvAnalysisResults.hidden = false;
  }

  async function loadCvAnalysisHistory() {
    const request = ++cvAnalysisRequest;
    const userId = getSession()?.user?.id;
    if (!userId) return;
    cvAnalysisHistory.replaceChildren();
    cvAnalysisHistoryStatus.textContent = "Chargement…";
    try {
      const reports = await supabaseFetch("web_cv_analysis_reports?select=id,created_at,cv_name,target_role,overall&order=created_at.desc,id.desc&limit=30");
      if (request !== cvAnalysisRequest || getSession()?.user?.id !== userId) return;
      cvAnalysisHistoryStatus.textContent = reports.length ? "Les 30 dernières analyses au maximum." : "Aucune analyse enregistrée.";
      for (const [index, report] of reports.entries()) {
        const card = document.createElement("article"); card.className = "application-row";
        const body = document.createElement("div"); body.className = "application-main";
        const title = document.createElement("strong"); title.textContent = report.cv_name + " · " + report.overall + "/100";
        const caption = document.createElement("span");
        caption.textContent = new Intl.DateTimeFormat("fr-CH", { dateStyle: "medium", timeStyle: "short" }).format(new Date(report.created_at)) + (report.target_role ? " · " + report.target_role : "");
        body.append(title, caption);
        const previous = reports.slice(index + 1).find(item => item.cv_name === report.cv_name && item.target_role === report.target_role);
        if (previous) {
          const delta = report.overall - previous.overall;
          const change = document.createElement("small"); change.textContent = (delta > 0 ? "+" : "") + delta + " point(s) depuis l’analyse précédente du même CV et du même métier.";
          body.append(change);
        }
        card.append(body); cvAnalysisHistory.append(card);
      }
    } catch (error) {
      if (request === cvAnalysisRequest && getSession()?.user?.id === userId) cvAnalysisHistoryStatus.textContent = error.message;
    }
  }

  cvAnalyze.addEventListener("click", async () => {
    const userId = getSession()?.user?.id;
    if (!userId || cvAnalyze.disabled || cvAnalysisClear.disabled) return;
    if (!hasPremiumCv()) { cvAnalysisStatus.textContent = "L’analyse CV / ATS est disponible avec Premium."; return; }
    const fields = Object.fromEntries(cvFieldNames.map(name => [name, cvForm.elements.namedItem(name).value.trim()]));
    if (!fields.name || !fields.title || ![fields.summary, fields.experience, fields.education, fields.skills].some(Boolean)) {
      cvAnalysisStatus.textContent = "Complétez le nom, le titre et le contenu du CV dans le formulaire."; return;
    }
    const target = document.querySelector("#cv-analysis-target").value.trim() || fields.target;
    const report = analyzeCvFields(fields, target);
    renderCvAnalysis(report);
    cvAnalyze.disabled = true;
    cvAnalysisStatus.textContent = "Analyse terminée. Enregistrement du score…";
    try {
      await supabaseWrite("web_cv_analysis_reports", "POST", {
        cv_name: cvLabel.value.trim() || fields.title, target_role: target,
        ...Object.fromEntries(["overall", "structure", "content", "keywords", "readability", "ats"].map(key => [key, report[key]]))
      });
      if (getSession()?.user?.id !== userId) return;
      cvAnalysisStatus.textContent = "Analyse enregistrée. Le calcul est effectué dans votre navigateur, sans crédit IA.";
      await loadCvAnalysisHistory();
    } catch (error) {
      if (getSession()?.user?.id === userId) cvAnalysisStatus.textContent = "Analyse affichée, historique non enregistré. " + error.message;
    } finally { cvAnalyze.disabled = false; }
  });

  cvAnalysisClear.addEventListener("click", async () => {
    const userId = getSession()?.user?.id;
    if (!userId || cvAnalysisClear.disabled || cvAnalyze.disabled) return;
    if (!window.confirm("Effacer tout l’historique des analyses ? Vos CV et vos documents seront conservés.")) return;
    cvAnalysisClear.disabled = true;
    try {
      await supabaseWrite("web_cv_analysis_reports?user_id=eq." + encodeURIComponent(userId), "DELETE");
      if (getSession()?.user?.id === userId) await loadCvAnalysisHistory();
    } catch (error) {
      if (getSession()?.user?.id === userId) cvAnalysisHistoryStatus.textContent = error.message;
    } finally { cvAnalysisClear.disabled = false; }
  });

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
    syncCvStudio();
    status.textContent = matches.length ? matches.length + " compétence(s) de votre CV placée(s) en premier." :
      "Aucune correspondance exacte. Vous pouvez ajuster votre CV avant l’aperçu.";
  });

  document.querySelector("#cv-word-export").addEventListener("click", () => {
    if (!getSession()?.user?.id || !cvForm.reportValidity() || !cvPhotoReady()) return;
    try {
      const fields = Object.fromEntries(cvFieldNames.map(name => [name, cvForm.elements.namedItem(name).value.trim()]));
      if (!hasPremiumCv()) fields.template = "classic";
      const blob = window.CP_CV_WORD.create(fields), url = URL.createObjectURL(blob), link = document.createElement("a");
      link.href = url;
      const label = (cvLabel.value.trim() || fields.name).replace(/[\\/:*?"<>|\x00-\x1f\x7f]/g, "_").slice(0, 80);
      link.download = "CandidaturePro_CV_" + label + ".docx";
      document.body.append(link); link.click(); link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      cvSaveStatus.textContent = "CV Word préparé. Vérifiez la mise en page dans votre traitement de texte ; le téléchargement n’enregistre pas la variante sur votre compte.";
    } catch (error) { cvSaveStatus.textContent = error.message; }
  });

  cvForm.addEventListener("submit", event => {
    event.preventDefault();
    if (!getSession()?.user?.id || !cvPhotoReady()) return;
    const data = new FormData(cvForm);
    const preview = document.querySelector("#cv-preview");
    preview.replaceChildren();
    preview.dataset.template = hasPremiumCv() ? String(data.get("template")) : "classic";
    const photo = data.get("photo");
    if (validCvPhoto(photo)) {
      const image = document.createElement("img"); image.className = "cv-portrait";
      image.alt = "Photo du candidat"; image.src = photo; preview.append(image);
    }
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
  const documentKinds = { cv: "CV", lettre: "Lettre de motivation", certificat: "Certificat / attestation", diplome: "Diplôme", autre: "Autre document" };
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

  const documentPreview = document.querySelector("#document-preview-dialog");
  const documentPreviewFrame = document.querySelector("#document-preview-frame");
  const documentPreviewDownload = document.querySelector("#document-preview-download");
  let documentPreviewUrl = null;
  let documentPreviewRequest = 0;

  documentPreview.addEventListener("close", () => {
    documentPreviewFrame.removeAttribute("src");
    documentPreviewDownload.removeAttribute("href");
    if (documentPreviewUrl) URL.revokeObjectURL(documentPreviewUrl);
    documentPreviewUrl = null;
  });

  async function getDocumentBlob(userId, file) {
    const session = await ensureSession();
    if (session?.user?.id !== userId) throw new Error("Reconnectez-vous pour accéder à ce document.");
    const response = await documentRequest(session, "authenticated/" + documentsBucket + "/" +
      file.prefix + "/" + encodeURIComponent(file.name));
    return response.blob();
  }

  async function previewDocument(userId, file, name) {
    const request = ++documentPreviewRequest;
    const blob = await getDocumentBlob(userId, file);
    if (await blob.slice(0, 5).text() !== "%PDF-") throw new Error("Ce document ne peut pas être affiché comme PDF.");
    if (getSession()?.user?.id !== userId || request !== documentPreviewRequest || documentPreview.open) return;
    documentPreviewUrl = URL.createObjectURL(blob.slice(0, blob.size, "application/pdf"));
    documentPreviewFrame.src = documentPreviewUrl;
    documentPreviewDownload.href = documentPreviewUrl;
    documentPreviewDownload.download = name;
    document.querySelector("#document-preview-title").textContent = name;
    documentPreview.showModal();
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
            const blob = await getDocumentBlob(session.user.id, file);
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
        const open = document.createElement("button");
        open.type = "button";
        open.className = "secondary";
        open.textContent = "Aperçu";
        open.addEventListener("click", async () => {
          open.disabled = true;
          try { await previewDocument(session.user.id, file, name); }
          catch (error) {
            if (getSession()?.user?.id === session.user.id) documentsMessage.textContent = error.message;
          } finally { open.disabled = false; }
        });
        const remove = document.createElement("button");
        remove.type = "button";
        remove.className = "secondary";
        remove.textContent = "Supprimer";
        remove.addEventListener("click", async () => {
          const userId = session.user.id;
          if (remove.disabled || getSession()?.user?.id !== userId ||
              !window.confirm("Supprimer définitivement « " + name + " » de vos documents ?")) return;
          remove.disabled = open.disabled = button.disabled = true;
          try {
            const active = await ensureSession();
            if (active?.user?.id !== userId) return;
            const response = await documentRequest(active, documentsBucket, {
              method: "DELETE",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ prefixes: [file.prefix + "/" + file.name] })
            });
            const removed = await response.json();
            if (getSession()?.user?.id !== userId) return;
            await loadDocuments();
            if (getSession()?.user?.id === userId) {
              documentsMessage.textContent = Array.isArray(removed) && removed.length
                ? "Document supprimé." : "Aucun document supprimé. Il a peut-être déjà été retiré.";
            }
          } catch (error) {
            if (getSession()?.user?.id === userId) documentsMessage.textContent = error.message;
          } finally {
            remove.disabled = open.disabled = button.disabled = false;
          }
        });
        const actions = document.createElement("div");
        actions.className = "batch-actions";
        actions.append(open, button, remove);
        row.append(title, actions);
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

  const backupExport = document.querySelector("#backup-export");
  const backupFile = document.querySelector("#backup-file");
  const backupRestore = document.querySelector("#backup-restore");
  const backupPreview = document.querySelector("#backup-preview");
  const backupStatus = document.querySelector("#backup-status");
  let backupRequest = 0;
  let backupCandidate = null;
  let backupBusy = false;
  const backupApplicationFields = ["id", "company_name", "company_city", "company_email", "job_title", "status", "source", "notes", "sent_at", "last_activity_at", "next_follow_up_at", "last_inbound_at", "hidden_at", "created_at", "updated_at", "source_url", "last_follow_up_sent_at", "follow_up_delay_days", "last_automatic_reply_at", "last_human_reply_at", "last_reply_read_at", "source_job_id", "resend_of"];
  const backupUuid = /^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/i;

  function setBackupBusy(busy) {
    backupBusy = busy; backupExport.disabled = backupFile.disabled = busy;
    backupRestore.disabled = busy || !backupCandidate;
  }
  function downloadBackup(blob) {
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = "CandidaturePro_Sauvegarde_" + new Date().toISOString().slice(0, 10) + ".zip";
    document.body.append(link); link.click(); link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10000);
  }
  function safeBackupFilename(name) {
    return name.replace(/[\\/:\x00-\x1f\x7f]/g, "_").slice(0, 255);
  }
  function backupString(value, max, required = false) {
    if (value === null || value === undefined) { if (required) throw new Error("Un champ requis manque dans la sauvegarde."); return null; }
    if (typeof value !== "string" || [...value].length > max || (required && !value.trim())) throw new Error("Un champ de la sauvegarde est invalide ou trop long.");
    return value;
  }
  function validateBackupManifest(manifest, entries, userId) {
    if (!manifest || manifest.format !== "candidature-pro-web" || manifest.version !== 1 || manifest.accountId !== userId ||
        !Array.isArray(manifest.applications) || manifest.applications.length > 20000 ||
        !Array.isArray(manifest.cvVariants) || manifest.cvVariants.length > 1000 ||
        !Array.isArray(manifest.documents) || manifest.documents.length > 1999) throw new Error("Cette sauvegarde n’est pas compatible avec le compte connecté.");
    const seenApplications = new Set(), seenVariants = new Set(), seenDocuments = new Set();
    const applications = manifest.applications.map(row => {
      if (!row || !backupUuid.test(row.id) || seenApplications.has(row.id)) throw new Error("Identifiant de dossier invalide ou en double.");
      seenApplications.add(row.id);
      if (!Object.hasOwn(statusLabels, row.status) || !["web", "desktop", "import"].includes(row.source)) throw new Error("Statut de dossier invalide.");
      const clean = { id: row.id, status: row.status, source: row.source };
      for (const [key, max] of [["company_name", 200], ["company_city", 150], ["company_email", 254], ["job_title", 200], ["notes", 5000], ["source_url", 2000]]) clean[key] = backupString(row[key], max, key === "company_name");
      for (const key of ["sent_at", "last_activity_at", "next_follow_up_at", "last_inbound_at", "hidden_at", "created_at", "updated_at", "last_follow_up_sent_at", "last_automatic_reply_at", "last_human_reply_at", "last_reply_read_at"]) {
        const value = row[key];
        if (value !== null && value !== undefined && (typeof value !== "string" || value.length > 40 || !Number.isFinite(Date.parse(value)))) throw new Error("Une date de dossier est invalide.");
        if (value != null) clean[key] = value;
      }
      const delay = row.follow_up_delay_days ?? 10;
      if (!Number.isInteger(delay) || delay < 1 || delay > 365) throw new Error("Délai de relance invalide.");
      clean.follow_up_delay_days = delay;
      for (const key of ["source_job_id", "resend_of"]) { if (row[key] != null && !backupUuid.test(row[key])) throw new Error("Référence de dossier invalide."); clean[key] = row[key] || null; }
      return clean;
    });
    const cvVariants = manifest.cvVariants.map(row => {
      if (!row || !backupUuid.test(row.id) || seenVariants.has(row.id) || !row.fields || typeof row.fields !== "object" || Array.isArray(row.fields)) throw new Error("Variante de CV invalide.");
      seenVariants.add(row.id);
      const fields = {};
      for (const key of cvFieldNames) fields[key] = backupString(row.fields[key] ?? "", key === "photo" ? 100000 : 16000) || "";
      if (!fields.name || !fields.title || !["classic", "modern", "compact"].includes(fields.template) || (fields.photo && !validCvPhoto(fields.photo)) ||
          new TextEncoder().encode(JSON.stringify(fields)).length > 150000) throw new Error("Le contenu d’un CV est invalide.");
      const clean = { id: row.id, label: backupString(row.label, 120, true), fields };
      if (typeof row.updated_at === "string" && row.updated_at.length <= 40 && Number.isFinite(Date.parse(row.updated_at))) clean.updated_at = row.updated_at;
      return clean;
    });
    const documents = manifest.documents.map(row => {
      if (!row || !Object.hasOwn(documentKinds, row.kind) || typeof row.name !== "string" || row.name !== safeBackupFilename(row.name) || !/\.pdf$/i.test(row.name)) throw new Error("Document invalide dans la sauvegarde.");
      const path = "documents/" + row.kind + "/" + row.name;
      if (row.path !== path || seenDocuments.has(path)) throw new Error("Chemin de document invalide ou en double.");
      seenDocuments.add(path);
      const bytes = entries.get(path);
      if (!bytes || bytes.length > 10 * 1024 * 1024 || new TextDecoder().decode(bytes.subarray(0, 5)) !== "%PDF-") throw new Error("Un PDF est absent, invalide ou trop volumineux.");
      return { kind: row.kind, name: row.name, path, bytes };
    });
    if (entries.size !== documents.length + 1) throw new Error("La sauvegarde contient des fichiers inattendus.");
    return { applications, cvVariants, documents };
  }

  backupExport.addEventListener("click", async () => {
    const session = await ensureSession();
    if (!session?.user?.id || backupBusy) return;
    const request = ++backupRequest, userId = session.user.id;
    const current = () => request === backupRequest && getSession()?.user?.id === userId;
    setBackupBusy(true); backupStatus.textContent = "Préparation de la sauvegarde…";
    try {
      const [applicationRows, cvVariants, files] = await Promise.all([
        fetchApplicationPages("user_applications?select=" + backupApplicationFields.join(","), current),
        fetchApplicationPages("web_cv_variants?select=id,label,fields,updated_at", current), listDocuments(session)
      ]);
      if (!current()) return;
      const manifest = { format: "candidature-pro-web", version: 1, accountId: userId, exportedAt: new Date().toISOString(),
        applications: applicationRows.map(row => Object.fromEntries(backupApplicationFields.filter(key => row[key] !== undefined).map(key => [key, row[key]]))), cvVariants, documents: [] };
      const entries = [];
      let total = 0;
      for (const [index, file] of files.entries()) {
        if (!current()) return;
        backupStatus.textContent = "Ajout du PDF " + (index + 1) + " sur " + files.length + "…";
        const blob = await getDocumentBlob(userId, file);
        if (!current()) return;
        const bytes = new Uint8Array(await blob.arrayBuffer()); total += bytes.length;
        if (total > 100 * 1024 * 1024 || bytes.length > 10 * 1024 * 1024) throw new Error("La sauvegarde dépasse 100 Mo ou un document dépasse 10 Mo.");
        const kind = file.prefix.split("/").at(-1), name = safeBackupFilename(file.name), path = "documents/" + kind + "/" + name;
        entries.push({ name: path, bytes }); manifest.documents.push({ kind, name, path });
      }
      const manifestBytes = new TextEncoder().encode(JSON.stringify(manifest, null, 2));
      validateBackupManifest(manifest, new Map([["candidature-pro.json", manifestBytes], ...entries.map(entry => [entry.name, entry.bytes])]), userId);
      if (manifestBytes.length > 30 * 1024 * 1024) throw new Error("Les dossiers et variantes dépassent 30 Mo. Réduisez le nombre de variantes ou la taille des photos.");
      const archive = window.CP_BACKUP.buildArchive([{ name: "candidature-pro.json", bytes: manifestBytes }, ...entries]);
      if (!current()) return;
      downloadBackup(archive);
      backupStatus.textContent = "Sauvegarde préparée : " + applicationRows.length + " dossier(s), " + cvVariants.length + " CV et " + files.length + " PDF. Vérifiez que le téléchargement est terminé.";
    } catch (error) { if (current()) backupStatus.textContent = error.message; }
    finally { setBackupBusy(false); }
  });

  backupFile.addEventListener("change", async () => {
    const file = backupFile.files?.[0], userId = getSession()?.user?.id;
    const request = ++backupRequest;
    backupCandidate = null; backupRestore.hidden = true; backupRestore.disabled = true; backupPreview.textContent = "";
    if (!file || !userId || backupBusy) return;
    backupStatus.textContent = "Lecture de la sauvegarde…";
    try {
      if (file.size > 103 * 1024 * 1024) throw new Error("Choisissez une sauvegarde ZIP de 100 Mo maximum.");
      const entries = window.CP_BACKUP.readArchive(new Uint8Array(await file.arrayBuffer()));
      const manifestBytes = entries.get("candidature-pro.json");
      if (!manifestBytes || manifestBytes.length > 30 * 1024 * 1024) throw new Error("Le fichier de données est absent ou trop volumineux.");
      const parsed = validateBackupManifest(JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(manifestBytes)), entries, userId);
      if (request !== backupRequest || getSession()?.user?.id !== userId) return;
      backupCandidate = { ...parsed, userId };
      backupPreview.textContent = parsed.applications.length + " dossier(s), " + parsed.cvVariants.length + " CV et " + parsed.documents.length + " PDF à comparer aux données actuelles.";
      backupStatus.textContent = "Archive reconnue. Les éléments déjà présents seront conservés.";
      backupRestore.hidden = false; backupRestore.disabled = false;
    } catch (error) {
      if (request === backupRequest && getSession()?.user?.id === userId) backupStatus.textContent = error instanceof SyntaxError ? "Le fichier de données de la sauvegarde est invalide." : error.message;
    }
  });

  backupRestore.addEventListener("click", async () => {
    const candidate = backupCandidate, session = await ensureSession();
    if (!candidate || backupBusy || candidate.userId !== session?.user?.id) return;
    if (!window.confirm("Ajouter les dossiers, CV et PDF manquants de cette sauvegarde à votre compte ? Les éléments déjà présents seront conservés.")) return;
    const request = ++backupRequest, userId = candidate.userId;
    const current = () => request === backupRequest && getSession()?.user?.id === userId;
    const counts = { added: 0, skipped: 0 };
    setBackupBusy(true); backupStatus.textContent = "Comparaison avec les données actuelles…";
    try {
      const [applicationRows, variants, files] = await Promise.all([
        fetchApplicationPages("user_applications?select=id", current), fetchApplicationPages("web_cv_variants?select=id", current), listDocuments(session)
      ]);
      if (!current()) return;
      const applicationIds = new Set(applicationRows.map(row => row.id)), variantIds = new Set(variants.map(row => row.id));
      const filePaths = new Set(files.map(file => file.prefix.split("/").at(-1) + "/" + file.name));
      const pending = [...candidate.applications.map(row => ({ table: "user_applications", row, exists: applicationIds.has(row.id) })),
        ...candidate.cvVariants.map(row => ({ table: "web_cv_variants", row, exists: variantIds.has(row.id) }))];
      for (const [index, item] of pending.entries()) {
        if (!current()) return;
        backupStatus.textContent = "Restauration des données " + (index + 1) + " sur " + pending.length + "…";
        if (item.exists) { counts.skipped++; continue; }
        try { await supabaseWrite(item.table, "POST", { ...item.row, user_id: userId }); counts.added++; }
        catch (error) {
          // A concurrent creation must never cause an overwrite.
          const existing = await supabaseFetch(item.table + "?id=eq." + encodeURIComponent(item.row.id) + "&select=id");
          if (existing.length) counts.skipped++; else throw error;
        }
      }
      for (const [index, file] of candidate.documents.entries()) {
        if (!current()) return;
        backupStatus.textContent = "Restauration du PDF " + (index + 1) + " sur " + candidate.documents.length + "…";
        if (filePaths.has(file.kind + "/" + file.name)) { counts.skipped++; continue; }
        const freshSession = await ensureSession();
        if (freshSession?.user?.id !== userId || !current()) return;
        await documentRequest(freshSession, documentsBucket + "/" + userId + "/" + file.kind + "/" + encodeURIComponent(file.name), {
          method: "POST", headers: { "Content-Type": "application/pdf", "x-upsert": "false" }, body: file.bytes
        });
        counts.added++;
      }
      if (current()) {
        backupStatus.textContent = "Restauration terminée : " + counts.added + " élément(s) ajouté(s), " + counts.skipped + " déjà présent(s).";
        backupCandidate = null; backupRestore.hidden = true; backupFile.value = "";
        await loadDashboard();
      }
    } catch (error) {
      if (current()) backupStatus.textContent = counts.added + " élément(s) ajouté(s) avant l’arrêt. " + error.message + " Une nouvelle tentative conservera les éléments déjà restaurés.";
    } finally { setBackupBusy(false); }
  });

  async function loadSendQuota() {
    const response = await supabaseRpc("get_my_candidature_quota", {});
    const quota = Array.isArray(response) ? response[0] : response;
    if (typeof quota?.premium !== "boolean" || !Number.isSafeInteger(quota.used) || quota.used < 0 ||
        !Number.isSafeInteger(quota.limit) || quota.limit < 0) throw new Error("Quota indisponible.");
    return { ...quota, remaining: Math.max(0, quota.limit - quota.used) };
  }

  function describeSendQuota(quota) {
    if (!quota) return "Quota indisponible";
    if (quota.premium) return "Envois illimités";
    return quota.remaining + " envoi(s) restant(s) sur " + quota.limit + " ce mois";
  }

  let trackingCountsRequest = 0;

  async function updateTrackingCounts(session) {
    const request = ++trackingCountsRequest;
    const counts = await supabaseRpc("get_my_web_tracking_counts", {}).catch(() => null);
    if (request !== trackingCountsRequest || getSession()?.user?.id !== session.user.id) return;
    const badge = document.querySelector("#tracking-unread-badge");
    const unread = counts?.replies;
    badge.hidden = !Number.isSafeInteger(unread) || unread <= 0;
    badge.textContent = badge.hidden ? "" : unread > 99 ? "99+" : String(unread);
    badge.setAttribute("aria-label", badge.hidden ? "" : unread + " dossier(s) avec une réponse non lue");
    for (const key of ["replies", "followups", "interviews"]) {
      const amount = counts?.[key];
      document.querySelector("#stat-" + key).textContent = Number.isSafeInteger(amount) && amount >= 0 ? String(amount) : "—";
    }
  }

  let accountSetupRequest = 0;
  let accountSetup = { cv: null, gmail: null };

  function renderAccountSetup() {
    const steps = [
      ["profile", profile ? candidateIdentityLocked() : null, "Identité enregistrée et verrouillée", "Confirmer le prénom, le nom et l’e-mail"],
      ["cv", accountSetup.cv, "CV ajouté ou enregistré", "Ajouter un PDF ou créer un CV"],
      ["gmail", accountSetup.gmail, "Compte Gmail lié", "Connecter Gmail pour l’envoi et le suivi"]
    ];
    let completed = getSession()?.user?.id ? 1 : 0;
    steps.forEach(([key, done, ready, missing], index) => {
      const row = document.querySelector('[data-setup="' + key + '"]');
      row.classList.toggle("done", done === true);
      row.querySelector("i").textContent = done ? "✓" : String(index + 2);
      row.querySelector("small").textContent = done === null ? "État indisponible" : done ? ready : missing;
      if (done) completed++;
    });
    document.querySelector("#setup-progress").textContent = completed + "/4";
  }

  async function refreshAccountSetup(session) {
    const request = ++accountSetupRequest;
    const [pdf, variant, gmail] = await Promise.allSettled([
      documentRequest(session, "list/" + documentsBucket, {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prefix: session.user.id + "/cv", limit: 1 })
      }).then(response => response.json()).then(files => files.some(file => Boolean(file.id))),
      supabaseFetch("web_cv_variants?select=id&limit=1").then(rows => rows.length > 0),
      invokeEdgeFunction("gmail-web", { action: "status" }).then(result => result.connected === true)
    ]);
    if (request !== accountSetupRequest || getSession()?.user?.id !== session.user.id) return;
    const hasCv = [pdf, variant].some(result => result.status === "fulfilled" && result.value);
    accountSetup = {
      cv: hasCv ? true : pdf.status === "fulfilled" && variant.status === "fulfilled" ? false : null,
      gmail: gmail.status === "fulfilled" ? gmail.value : null
    };
    renderAccountSetup();
  }

  function refreshAccountRights() {
    if (!getSession()?.user?.id || !profile || Date.now() - accountLastRefreshed < 30000) return Promise.resolve();
    if (accountRefreshPromise) return accountRefreshPromise;
    accountRefreshPromise = loadDashboard().catch(() => {
      // Preserve the last verified rights while the network is unavailable.
      document.querySelector("#premium-plan").textContent += " · Actualisation indisponible";
    }).finally(() => { accountRefreshPromise = null; });
    return accountRefreshPromise;
  }

  window.addEventListener("focus", refreshAccountRights);
  document.addEventListener("visibilitychange", () => {
    if (!document.hidden) refreshAccountRights();
  });

  async function loadDashboard() {
    const session = await ensureSession();
    if (!session?.user?.id) {
      profile = null;
      renderAccount();
      for (const node of document.querySelectorAll("[id^=stat-]")) node.textContent = "0";
      document.querySelector("#monthly-quota-detail").textContent = "Ce mois";
      return;
    }

    const userId = encodeURIComponent(session.user.id);
    const [profiles, quota] = await Promise.all([
      supabaseFetch("profiles?id=eq." + userId + "&select=candidate_first_name,candidate_last_name,candidate_email,plan,premium_until,is_admin"),
      loadSendQuota().catch(() => null)
    ]);

    if (getSession()?.user?.id !== session.user.id) return;
    const firstProfile = !profile;
    profile = Array.isArray(profiles) ? profiles[0] || null : null;
    accountLastRefreshed = Date.now();
    void touchWebPresence();
    document.querySelector("#stat-sent").textContent = quota ? String(quota.used) : "—";
    document.querySelector("#monthly-quota-detail").textContent = describeSendQuota(quota);
    renderAccountSetup();
    renderAccount();
    if (firstProfile || !document.querySelector("#profile-view").classList.contains("active")) renderProfile();
    else renderIdentityState();
    await updateTrackingCounts(session);
  }

  document.querySelector("#profile-form").addEventListener("submit", async event => {
    event.preventDefault();
    const userId = getSession()?.user?.id;
    if (!userId || profileDetailsUser !== userId) return;
    const details = Object.fromEntries(profileDetailFields.map(field =>
      ["p_" + field, event.currentTarget.elements.namedItem(field).value]));
    const button = document.querySelector("#profile-submit");
    if (button.disabled || !event.currentTarget.reportValidity()) return;
    if (!candidateIdentityLocked() && !window.confirm("Confirmer et verrouiller votre identité candidat : " +
      document.querySelector("#profile-first-name").value.trim() + " " + document.querySelector("#profile-last-name").value.trim() +
      " · " + document.querySelector("#profile-email").value.trim() + " ? Une correction ultérieure passera par l’administration.")) return;
    const message = document.querySelector("#profile-message");
    button.disabled = true;
    button.textContent = "Enregistrement…";
    message.textContent = "";
    try {
      const updated = await supabaseRpc("save_web_candidate_profile", {
        ...details,
        p_first_name: document.querySelector("#profile-first-name").value,
        p_last_name: document.querySelector("#profile-last-name").value,
        p_email: document.querySelector("#profile-email").value
      });
      if (getSession()?.user?.id !== userId) return;
      profile = updated;
      renderAccount();
      renderProfile();
      renderAccountSetup();
      message.textContent = "Profil enregistré.";
    } catch (error) {
      message.textContent = error.message;
    } finally {
      button.disabled = false;
      renderIdentityState();
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

  document.querySelector("#jobs-recent-only").addEventListener("change", () => { void loadJobs(); });
  document.querySelector("#jobs-known-employer-only").addEventListener("change", () => { void loadJobs(); });

  document.querySelector("#jobs-results").addEventListener("click", async event => {
    if (event.target.dataset.action !== "add-job") return;
    const card = event.target.closest("[data-job-index]");
    const job = jobResults[Number(card.dataset.jobIndex)];
    const userId = getSession()?.user?.id;
    if (!job || !userId || event.target.disabled) return;
    const button = event.target;
    if (!job.company_name?.trim()) {
      pendingJobCompany = { job, button, userId };
      const dialog = document.querySelector("#job-company-dialog");
      document.querySelector("#job-company-form").reset();
      document.querySelector("#job-company-status").textContent = "";
      document.querySelector("#job-company-title").textContent = job.title;
      const source = document.querySelector("#job-company-source");
      source.href = safeExternalUrl(job.url) || "#";
      source.hidden = source.href.endsWith("#");
      dialog.showModal();
      document.querySelector("#job-company-name").focus();
      return;
    }
    button.disabled = true;
    button.textContent = "Ajout…";
    try {
      const result = await supabaseRpc("add_web_job_application", { p_job_id: job.id });
      if (getSession()?.user?.id !== userId) return;
      button.textContent = result.created ? "Ajoutée ✓" : result.hidden ? "Déjà dans les dossiers masqués" : "Déjà dans les candidatures";
    } catch (error) {
      button.disabled = false;
      button.textContent = "Réessayer";
      if (getSession()?.user?.id === userId) document.querySelector("#jobs-message").textContent = error.message;
    }
  });

  const jobCompanyDialog = document.querySelector("#job-company-dialog");
  const jobCompanyForm = document.querySelector("#job-company-form");
  const jobCompanySubmit = document.querySelector("#job-company-submit");
  const jobCompanyCancel = document.querySelector("#job-company-cancel");
  jobCompanyCancel.addEventListener("click", () => jobCompanyDialog.close());
  jobCompanyDialog.addEventListener("cancel", event => {
    if (jobCompanySubmit.disabled) event.preventDefault();
  });
  jobCompanyDialog.addEventListener("close", () => {
    pendingJobCompany = null;
    jobCompanyForm.reset();
  });
  jobCompanyForm.addEventListener("submit", async event => {
    event.preventDefault();
    const pending = pendingJobCompany;
    if (!pending || jobCompanySubmit.disabled || !jobCompanyForm.reportValidity()) return;
    const company = document.querySelector("#job-company-name").value.trim();
    const status = document.querySelector("#job-company-status");
    if (!company) { status.textContent = "Indiquez le nom de l’employeur."; return; }
    jobCompanySubmit.disabled = jobCompanyCancel.disabled = true;
    status.textContent = "Ajout du dossier…";
    try {
      const result = await supabaseRpc("add_web_job_application_with_company", {
        p_job_id: pending.job.id, p_company_name: company
      });
      if (getSession()?.user?.id !== pending.userId || pendingJobCompany !== pending) return;
      pending.button.textContent = result.created ? "Ajoutée ✓" : result.hidden ? "Déjà dans les dossiers masqués" : "Déjà dans les candidatures";
      pending.button.disabled = true;
      jobCompanyDialog.close();
      document.querySelector("#jobs-message").textContent = result.created
        ? "Dossier créé avec le nom de l’employeur indiqué. Vérifiez les coordonnées avant tout envoi."
        : "Cette annonce figure déjà dans vos candidatures.";
    } catch (error) {
      if (getSession()?.user?.id === pending.userId && pendingJobCompany === pending) status.textContent = error.message;
    } finally {
      jobCompanySubmit.disabled = jobCompanyCancel.disabled = false;
    }
  });

  document.querySelector("#company-search-form").addEventListener("submit", async event => {
    event.preventDefault();
    const button = document.querySelector("#company-search-submit");
    const message = document.querySelector("#company-search-message");
    if (companySearchRunning) return;
    companySearchRunning = true;
    button.disabled = true;
    button.textContent = "Recherche…";
    try {
      await searchCompanies();
    } catch (error) {
      companyResults = [];
      renderCompanies();
      message.textContent = error.message;
    } finally {
      companySearchRunning = false;
      button.disabled = false;
      button.textContent = "Rechercher";
    }
  });

  document.querySelector("#company-results").addEventListener("click", async event => {
    const button = event.target.closest("[data-action]");
    const action = button?.dataset.action;
    const userId = getSession()?.user?.id;
    if (!userId || button?.disabled || !["add-company", "verify-company"].includes(action)) return;
    const card = button.closest("[data-company-index]");
    const company = companyResults[Number(card?.dataset.companyIndex)];
    if (!company) return;
    const verifying = action === "verify-company";
    const message = document.querySelector("#company-search-message");
    const label = button.textContent;
    button.disabled = true;
    button.textContent = verifying ? "Demande en cours…" : "Ajout…";
    try {
      if (verifying) {
        const request = await supabaseRpc("queue_company_manual_verification_v2", {
          p_company_name: company.name, p_city: company.city, p_address: company.address,
          p_website: safeExternalUrl(company.website), p_sector: company.sector,
          p_source: "company_search", p_country: "CH"
        });
        if (getSession()?.user?.id !== userId) return;
        if (!request) throw new Error("La demande de vérification n’a pas pu être confirmée.");
        button.textContent = "Demande enregistrée";
      } else {
        const result = await supabaseRpc("add_web_company_application", {
          p_company: company.name, p_city: company.city, p_email: company.email
        });
        if (getSession()?.user?.id !== userId) return;
        button.textContent = result.created ? "Ajoutée ✓" :
          result.hidden ? "Déjà dans les dossiers masqués" : "Déjà dans les candidatures";
      }
    } catch (error) {
      button.disabled = false;
      button.textContent = label;
      if (getSession()?.user?.id === userId) message.textContent = error.message;
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

  document.querySelector("#applications-search").addEventListener("input", renderApplications);
  document.querySelector("#applications-filter").addEventListener("change", renderApplications);
  document.querySelector("#show-hidden-applications").addEventListener("change", loadApplications);

  document.querySelector("#applications-list").addEventListener("change", async event => {
    const select = event.target;
    const userId = getSession()?.user?.id;
    if (select.dataset.action !== "status" || select.disabled || !userId) return;
    const id = select.closest("[data-id]")?.dataset.id;
    const row = applications.find(item => item.id === id);
    const status = select.value;
    if (!row || !Object.hasOwn(statusLabels, status) || row.status === status) return;
    const message = document.querySelector("#applications-message");
    const now = new Date().toISOString();
    select.disabled = true;
    try {
      const saved = await supabaseWrite("user_applications?id=eq." + encodeURIComponent(row.id) +
        "&updated_at=eq." + encodeURIComponent(row.updated_at) + "&select=id", "PATCH", {
        status,
        sent_at: status === "sent" && !row.sent_at ? now : undefined,
        last_activity_at: now,
        ...(closedFollowUpStatuses.has(status) ? { next_follow_up_at: null } : {})
      });
      if (getSession()?.user?.id !== userId) return;
      await loadApplications();
      if (!saved.length && getSession()?.user?.id === userId) message.textContent = "Le dossier a changé. Vérifiez son statut avant de réessayer.";
    } catch (error) {
      if (getSession()?.user?.id === userId) {
        select.value = row.status;
        message.textContent = error.message;
      }
    } finally {
      select.disabled = false;
    }
  });

  const applicationEditDialog = document.querySelector("#application-edit-dialog");
  const applicationEditForm = document.querySelector("#application-edit-form");
  const applicationEditStatus = document.querySelector("#application-edit-status");
  const applicationEditClose = document.querySelector("#application-edit-close");
  const applicationEditSave = applicationEditForm.querySelector("[type=submit]");
  const applicationProposeEmail = document.querySelector("#application-propose-email");
  let applicationBeingEdited = null;
  let proposedEmailRequest = null;

  function toggleApplicationEditActions(disabled) {
    applicationEditSave.disabled = applicationEditClose.disabled = applicationProposeEmail.disabled = disabled;
  }

  applicationProposeEmail.addEventListener("click", async () => {
    const row = applicationBeingEdited;
    const userId = getSession()?.user?.id;
    const fields = applicationEditForm.elements;
    if (!row || !userId || applicationProposeEmail.disabled) return;
    const email = fields.email.value.trim();
    const previousEmail = (row.company_email || "").trim();
    if (!email || email.toLowerCase() === previousEmail.toLowerCase() || !fields.email.reportValidity()) {
      applicationEditStatus.textContent = "Saisissez une adresse e-mail différente pour la proposer.";
      return;
    }
    if (fields.company.value.trim() !== (row.company_name || "").trim() ||
        fields.city.value.trim() !== (row.company_city || "").trim()) {
      applicationEditStatus.textContent = "Enregistrez d’abord le nom et la ville corrigés, puis rouvrez le dossier.";
      return;
    }
    if (proposedEmailRequest?.email !== email) {
      proposedEmailRequest = { email, id: "manual-" + crypto.randomUUID() };
    }
    toggleApplicationEditActions(true);
    applicationEditStatus.textContent = "Enregistrement de la proposition…";
    try {
      const result = await supabaseRpc("submit_company_email_change_request", {
        p_company_name: row.company_name, p_city: row.company_city || "",
        p_current_email: previousEmail, p_proposed_email: email,
        p_reply_subject: "Proposition depuis une candidature",
        p_reply_body: "Adresse proposée par le candidat pour vérification.",
        p_source_message_id: proposedEmailRequest.id
      });
      if (getSession()?.user?.id !== userId || applicationBeingEdited !== row) return;
      if (!result) throw new Error("La proposition n’a pas pu être confirmée.");
      applicationEditStatus.textContent = "Proposition enregistrée. Enregistrez le dossier si vous souhaitez aussi utiliser cette adresse pour votre candidature.";
    } catch (error) {
      if (getSession()?.user?.id === userId && applicationBeingEdited === row) applicationEditStatus.textContent = error.message;
    } finally {
      toggleApplicationEditActions(false);
    }
  });

  function openApplicationEditor(row) {
    if (!row || !canEditApplication(row) || applicationEditDialog.open) return;
    applicationBeingEdited = row;
    proposedEmailRequest = null;
    applicationEditForm.elements.company.value = row.company_name || "";
    applicationEditForm.elements.job.value = row.job_title || "";
    applicationEditForm.elements.city.value = row.company_city || "";
    applicationEditForm.elements.email.value = row.company_email || "";
    applicationEditStatus.textContent = "";
    applicationEditDialog.showModal();
  }

  applicationEditClose.addEventListener("click", () => applicationEditDialog.close());
  applicationEditDialog.addEventListener("cancel", event => {
    if (applicationEditSave.disabled) event.preventDefault();
  });
  applicationEditDialog.addEventListener("close", () => {
    applicationBeingEdited = null;
    applicationEditForm.reset();
  });
  applicationEditForm.addEventListener("submit", async event => {
    event.preventDefault();
    const row = applicationBeingEdited;
    const userId = getSession()?.user?.id;
    const fields = applicationEditForm.elements;
    if (!row || !userId || applicationEditSave.disabled) return;
    const companyName = fields.company.value.trim();
    if (!companyName) { applicationEditStatus.textContent = "Indiquez le nom de l’entreprise."; return; }

    toggleApplicationEditActions(true);
    applicationEditStatus.textContent = "";
    try {
      const saved = await supabaseWrite("user_applications?id=eq." + encodeURIComponent(row.id) +
        "&sent_at=is.null&hidden_at=is.null&status=in.(draft,ready)&select=id" +
        "&updated_at=eq." + encodeURIComponent(row.updated_at), "PATCH", {
        company_name: companyName,
        job_title: fields.job.value.trim() || null,
        company_city: fields.city.value.trim() || null,
        company_email: fields.email.value.trim() || null,
        last_activity_at: new Date().toISOString()
      });
      if (getSession()?.user?.id !== userId) return;
      if (!saved.length) {
        await loadApplications();
        applicationEditStatus.textContent = "Le dossier a changé. Copiez vos modifications, puis rouvrez-le pour les appliquer.";
        return;
      }
      batchSelection.delete(row.id);
      applicationEditDialog.close();
      await loadApplications();
      if (getSession()?.user?.id === userId) {
        document.querySelector("#applications-message").textContent = "Dossier modifié.";
      }
    } catch (error) {
      if (getSession()?.user?.id === userId) applicationEditStatus.textContent = error.message;
    } finally {
      toggleApplicationEditActions(false);
    }
  });

  document.querySelector("#applications-list").addEventListener("click", async event => {
    const action = event.target.dataset.action;
    if (action === "edit") {
      const id = event.target.closest("[data-id]")?.dataset.id;
      openApplicationEditor(applications.find(row => row.id === id));
      return;
    }
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
  guestLogin.addEventListener("click", () => { setAuthMode("signin"); dialog.showModal(); });
  document.querySelector("#guest-signup").addEventListener("click", () => { setAuthMode("signup"); dialog.showModal(); });
  document.querySelector("#close-login").addEventListener("click", () => { if (!authBusy && !document.querySelector("#login-submit").disabled) dialog.close(); });
  loginButton.addEventListener("click", () => {
    if (getSession()) showView("settings");
    else { setAuthMode("signin"); dialog.showModal(); }
  });
  signOutButton.addEventListener("click", () => {
    profile = null; passwordRecoveryStatus.textContent = "";
    ++backupRequest; backupCandidate = null; backupFile.value = ""; backupPreview.textContent = backupStatus.textContent = "";
    if (passwordDialog.open) passwordDialog.close();
    ++accountSetupRequest;
    accountSetup = { cv: null, gmail: null };
    profileDetailsUser = null;
    ++identityChangeRequest; identityChangeForm.reset(); identityChangeStatus.textContent = ""; identityChangePanel.open = false;
    ++profileDetailsRequest;
    document.querySelector("#profile-form").reset();
    if (replyDialog.open) replyDialog.close();
    cancelBatch();
    clearSendDrafts();
    batchSelection.clear();
    ++documentsRequest;
    ++cvAnalysisRequest;
    cvAnalysisHistory.replaceChildren(); cvAnalysisResults.replaceChildren();
    cvAnalysisResults.hidden = true; cvAnalysisStatus.textContent = "";
    cvAnalysisHistoryStatus.textContent = "";
    document.querySelector("#cv-analysis-target").value = "";
    ++adminRequest; adminInFlight = null; clearTimeout(adminSearchTimer); adminUserSearch.value = ""; adminCreditMonth.value = ""; adminUpdated.textContent = "";
    adminResults.replaceChildren();
    ++cvLoadRequest; ++cvPhotoRequest; cvPhotoPreparing = false; clearCvPdfImport();
    cvForm.reset(); cvForm.elements.namedItem("photo").value = ""; renderCvPhoto();
    cvPhotoStatus.textContent = "";
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
    ++documentPreviewRequest;
    if (documentPreview.open) documentPreview.close();
    documentsList.replaceChildren();
    documentsMessage.textContent = "";
    document.querySelector("#tracking-list").replaceChildren();
    document.querySelector("#tracking-message").textContent = "";
    setSession(null);
    location.replace("../");
  });

  function setAuthBusy(busy) {
    authBusy = busy;
    for (const node of [document.querySelector("#login-submit"), passwordForgot, signupResend, authModeSignin, authModeSignup, document.querySelector("#close-login"), microsoftSignin]) node.disabled = busy;
  }
  const signupConfirmationMessage = "Si cette adresse peut être utilisée, un message de confirmation a été envoyé. Ouvrez-le dans ce même navigateur, puis connectez-vous. Si vous avez déjà un compte, utilisez la connexion ou « Mot de passe oublié ». Vérifiez aussi les courriers indésirables.";
  loginForm.addEventListener("submit", async event => {
    event.preventDefault();
    const submit = document.querySelector("#login-submit");
    if (authBusy || submit.disabled || passwordForgot.disabled || !loginForm.reportValidity()) return;
    const email = document.querySelector("#email").value.trim().toLowerCase(), password = document.querySelector("#password").value;
    const mode = authMode;
    if (mode === "signup" && password !== signupConfirm.value) { loginMessage.textContent = "Les deux mots de passe sont différents."; return; }
    loginMessage.textContent = ""; setAuthBusy(true);
    submit.textContent = mode === "signup" ? "Création en cours…" : "Connexion…";
    try {
      let session;
      if (mode === "signup") {
        const result = await window.CP_SIGNUP.create(email, password);
        document.querySelector("#password").value = signupConfirm.value = "";
        if (result.type === "confirmation") {
          pendingConfirmationEmail = email; signupResendAfter = Date.now() + 60000;
          signupResend.hidden = false; loginMessage.textContent = signupConfirmationMessage; return;
        }
        session = normalizeSession(result.session);
      } else session = await signIn(email, password);
      profile = null; setSession(session);
      showView("dashboard"); dialog.close(); loginForm.reset(); pendingConfirmationEmail = null;
      await loadDashboard().catch(error => { document.querySelector("#account-label").textContent = error.message; });
    } catch (error) {
      loginMessage.textContent = error.message;
      if (error.code === "email_not_confirmed") { pendingConfirmationEmail = email; signupResend.hidden = false; }
    } finally {
      setAuthBusy(false);
      submit.textContent = authMode === "signup" ? "Créer mon compte gratuit" : "Se connecter";
    }
  });
  signupResend.addEventListener("click", async () => {
    if (authBusy || signupResend.disabled || !pendingConfirmationEmail) return;
    const email = document.querySelector("#email").value.trim().toLowerCase();
    if (email !== pendingConfirmationEmail) { loginMessage.textContent = "L’adresse a changé. Relancez la connexion ou l’inscription pour cette adresse."; return; }
    if (Date.now() < signupResendAfter) { loginMessage.textContent = "Patientez encore " + Math.ceil((signupResendAfter - Date.now()) / 1000) + " seconde(s) avant de renvoyer le message."; return; }
    setAuthBusy(true); loginMessage.textContent = "Demande du message de confirmation…";
    try {
      await window.CP_SIGNUP.resend(email); signupResendAfter = Date.now() + 60000;
      loginMessage.textContent = signupConfirmationMessage;
    } catch (error) { loginMessage.textContent = error.message; }
    finally { setAuthBusy(false); }
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

  async function verifyReviewedApplication(draft) {
    const rows = await supabaseFetch("user_applications?id=eq." + encodeURIComponent(draft.applicationId) +
      "&select=id,company_email,status,sent_at,hidden_at,updated_at");
    const row = rows[0];
    if (!readyForBatch(row) || row.company_email !== draft.recipient || row.updated_at !== draft.updatedAt) {
      throw new Error("Dossier modifié depuis le contrôle final. Rouvrez-le pour vérifier son contenu.");
    }
  }

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
      const files = draft.files.map(file => file.name).join(", ");
      item.textContent = [draft.companyName, draft.recipient, draft.subject, files || "Aucune pièce jointe"].join(" · ");
      recipients.append(item);
    }
    batchStatus.textContent = "";
    batchConfirm.hidden = false;
    const quotaMessage = document.querySelector("#batch-quota");
    quotaMessage.textContent = "Vérification du quota…";
    batchDialog.showModal();
    const drafts = batchDrafts;
    const userId = getSession()?.user?.id;
    loadSendQuota().catch(() => null).then(quota => {
      if (!batchDialog.open || batchDrafts !== drafts || getSession()?.user?.id !== userId) return;
      const exceedsQuota = quota && !quota.premium && drafts.length > quota.remaining;
      quotaMessage.textContent = describeSendQuota(quota) + (exceedsQuota
        ? ". Le lot dépasse le quota restant. Les dossiers au-delà du plafond seront refusés."
        : ".");
    });
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
          await verifyReviewedApplication(draft);
          if (getSession()?.user?.id !== userId) break;
          await invokeEdgeFunction("gmail-web", { action: "send", applicationId: draft.applicationId,
            recipient: draft.recipient, subject: draft.subject, message: draft.message, reviewedAt: draft.updatedAt, attachments });
          removeSendDraft(userId, draft.applicationId);
          batchSelection.delete(draft.applicationId);
          outcomes.push(draft.companyName + " · " + draft.recipient + " · Envoyée");
        } catch (error) {
          outcomes.push(draft.companyName + " · " + draft.recipient + " · " + error.message);
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

  const sendAiContext = document.querySelector("#send-ai-cv");
  const sendAiSourceStatus = document.querySelector("#send-ai-source-status");
  const sendAiProfile = document.querySelector("#send-ai-profile");
  const sendAiVariant = document.querySelector("#send-ai-variant");
  const sendAiUseVariant = document.querySelector("#send-ai-use-variant");
  let letterCvRequest = 0;

  function applyLetterContext(parts) {
    const text = parts.filter(value => typeof value === "string" && value.trim()).join("\n\n");
    if (!text) {
      sendAiSourceStatus.textContent = "Cette source ne contient aucun élément à reprendre.";
      return;
    }
    if (sendAiContext.value.trim() && !window.confirm("Remplacer le texte actuel du champ Expérience et compétences ?")) return;
    sendAiContext.value = text.slice(0, sendAiContext.maxLength);
    sendAiSourceStatus.textContent = text.length > sendAiContext.maxLength
      ? "Texte inséré dans la limite de 4 000 caractères. Relisez-le avant de générer la lettre."
      : "Texte ajouté. Vous pouvez le modifier avant de générer la lettre.";
  }

  sendAi.addEventListener("toggle", async () => {
    const userId = getSession()?.user?.id;
    if (!sendAi.open || !sendDialog.open || !userId || reviewed) return;
    const request = ++letterCvRequest;
    try {
      const rows = await supabaseFetch("web_cv_variants?select=id,label&order=updated_at.desc&limit=200");
      if (request !== letterCvRequest || getSession()?.user?.id !== userId || !sendDialog.open) return;
      const selected = sendAiVariant.value;
      sendAiVariant.length = 1;
      for (const row of rows) sendAiVariant.add(new Option(row.label, row.id));
      sendAiVariant.value = rows.some(row => row.id === selected) ? selected : "";
    } catch (error) {
      if (request === letterCvRequest && sendDialog.open && getSession()?.user?.id === userId) {
        sendAiSourceStatus.textContent = error.message;
      }
    }
  });

  sendAiUseVariant.addEventListener("click", async () => {
    const userId = getSession()?.user?.id;
    const id = sendAiVariant.value;
    const request = letterCvRequest;
    const current = () => sendDialog.open && !reviewed && request === letterCvRequest && getSession()?.user?.id === userId;
    if (!userId || sendAiUseVariant.disabled) return;
    if (!id) { sendAiSourceStatus.textContent = "Choisissez un CV enregistré."; return; }
    sendAiUseVariant.disabled = true;
    try {
      const rows = await supabaseFetch("web_cv_variants?id=eq." + encodeURIComponent(id) + "&select=fields");
      if (!current() || sendAiVariant.value !== id) return;
      const fields = rows[0]?.fields;
      if (!fields) { sendAiSourceStatus.textContent = "Le CV sélectionné n’est plus disponible."; return; }
      applyLetterContext([fields.summary, fields.experience, fields.skills, fields.education]);
    } catch (error) {
      if (current()) sendAiSourceStatus.textContent = error.message;
    } finally {
      sendAiUseVariant.disabled = false;
    }
  });

  sendAiProfile.addEventListener("click", async () => {
    const userId = getSession()?.user?.id;
    const dossier = sendApplication;
    const request = letterCvRequest;
    if (!userId || !dossier || sendAiProfile.disabled) return;
    sendAiProfile.disabled = true;
    try {
      const details = await fetchProfileDetails(userId);
      if (!sendDialog.open || sendApplication !== dossier || request !== letterCvRequest ||
          reviewed || getSession()?.user?.id !== userId) return;
      applyLetterContext([details.skills, details.languages]);
    } catch (error) {
      if (sendDialog.open && sendApplication === dossier && request === letterCvRequest &&
          getSession()?.user?.id === userId) sendAiSourceStatus.textContent = error.message;
    } finally {
      sendAiProfile.disabled = false;
    }
  });

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
  const selectedDocumentSources = new Map();
  const selectedDocumentList = document.querySelector("#send-document-list");

  function renderSelectedDocuments() {
    selectedDocumentList.replaceChildren();
    selectedDocumentList.hidden = Boolean(reviewed) || selectedDocuments.length === 0;
    librarySummary.hidden = Boolean(reviewed) || selectedDocuments.length === 0;
    librarySummary.textContent = "Retirer tous les documents ajoutés";
    for (const file of selectedDocuments) {
      const row = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = file.name + " · " + new Intl.NumberFormat("fr-CH", { maximumFractionDigits: 1 }).format(file.size / 1024) + " Ko";
      const remove = document.createElement("button");
      remove.type = "button"; remove.className = "secondary compact"; remove.textContent = "Retirer";
      remove.setAttribute("aria-label", "Retirer " + file.name);
      remove.addEventListener("click", () => {
        if (reviewed || sendSubmit.disabled) return;
        const source = selectedDocumentSources.get(file);
        selectedDocuments = selectedDocuments.filter(item => item !== file);
        selectedDocumentSources.delete(file);
        for (const option of librarySelect.options) if (option.value === source) option.disabled = false;
        libraryAdd.disabled = !librarySelect.value || selectedDocuments.length >= 8;
        renderSelectedDocuments();
      });
      row.append(name, remove); selectedDocumentList.append(row);
    }
  }

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
    if (!documentFile || selectedDocuments.length >= 8) return;
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
      if (await blob.slice(0, 5).text() !== "%PDF-") throw new Error("Ce document n’est pas un PDF valide.");
      if (!sendDialog.open || sendApplication !== dossier || reviewed || getSession()?.user?.id !== session.user.id) return;
      const existing = [...sendInputs[2].files, ...selectedDocuments];
      if (existing.length >= 8 || existing.reduce((total, file) => total + file.size, blob.size) > 10 * 1024 * 1024) {
        throw new Error("Le dossier accepte au maximum huit PDF de 10 Mo au total. Retirez une pièce jointe avant d’ajouter ce document.");
      }
      const attached = new File([blob], name, { type: "application/pdf" });
      selectedDocuments.push(attached); selectedDocumentSources.set(attached, option.value);
      renderSelectedDocuments();
      option.disabled = true;
      librarySelect.value = "";
    } catch (error) {
      if (sendDialog.open && sendApplication === dossier) sendStatus.textContent = error.message;
    } finally {
      if (sendApplication === dossier) {
        librarySelect.disabled = false;
        libraryAdd.disabled = !librarySelect.value || selectedDocuments.length >= 8;
      }
    }
  });

  librarySummary.addEventListener("click", () => {
    if (reviewed || sendSubmit.disabled) return;
    selectedDocuments = []; selectedDocumentSources.clear();
    renderSelectedDocuments();
    for (const option of librarySelect.options) option.disabled = false;
    libraryAdd.disabled = !librarySelect.value;
  });

  const sendSaveDraft = document.querySelector("#send-save-draft");
  const sendDraftPrefix = "candidature-pro-send-draft:";

  function sendDraftKey(userId, applicationId) {
    return sendDraftPrefix + userId + ":" + applicationId;
  }

  function clearSendDrafts() {
    try {
      for (let index = sessionStorage.length - 1; index >= 0; index--) {
        const key = sessionStorage.key(index);
        if (key?.startsWith(sendDraftPrefix) || key?.startsWith(followupDraftPrefix) || key?.startsWith(replyDraftPrefix)) sessionStorage.removeItem(key);
      }
    } catch { /* Le navigateur peut bloquer le stockage de session. */ }
  }

  function removeSendDraft(userId, applicationId) {
    try { sessionStorage.removeItem(sendDraftKey(userId, applicationId)); }
    catch { /* L’envoi est déjà confirmé. */ }
  }

  sendSaveDraft.addEventListener("click", () => {
    const userId = getSession()?.user?.id;
    if (!userId || !sendApplication || reviewed) return;
    const [subject, message] = sendInputs;
    try {
      sessionStorage.setItem(sendDraftKey(userId, sendApplication.id),
        JSON.stringify({ subject: subject.value, message: message.value }));
      sendStatus.textContent = "Brouillon conservé dans cet onglet. Ajoutez à nouveau les PDF à la réouverture.";
    } catch {
      sendStatus.textContent = "Le navigateur n’a pas pu conserver le brouillon.";
    }
  });

  function editSendDraft() {
    reviewed = null;
    sendSaveDraft.hidden = false;
    sendReview.hidden = true;
    sendAi.hidden = false;
    librarySelect.closest("label").hidden = false;
    libraryAdd.hidden = false;
    renderSelectedDocuments();
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
    document.querySelector("#send-skip").hidden = !batchSize;
    batchProgress.textContent = batchSize ? "Dossier " + (batchSize - batchQueue.length) + " sur " + batchSize : "";
    sendForm.reset();
    libraryFiles = [];
    selectedDocuments = []; selectedDocumentSources.clear(); renderSelectedDocuments();
    librarySelect.length = 1;
    librarySelect.disabled = false;
    libraryAdd.disabled = true;
    librarySummary.textContent = "";
    librarySummary.hidden = true;
    sendAi.open = false;
    ++letterCvRequest;
    sendAiVariant.length = 1;
    sendAiSourceStatus.textContent = "";
    editSendDraft();
    sendSubmit.disabled = false;
    sendStatus.textContent = "";
    document.querySelector("#send-recipient").textContent = "Destinataire · " + dossier.company_email;
    document.querySelector("#send-subject").value =
      (dossier.job_title ? "Candidature – " + dossier.job_title : "Candidature spontanée").slice(0, 120);
    try {
      const draft = JSON.parse(sessionStorage.getItem(sendDraftKey(getSession().user.id, dossier.id)) || "null");
      if (typeof draft?.subject === "string" && typeof draft.message === "string") {
        sendInputs[0].value = draft.subject.slice(0, 120);
        sendInputs[1].value = draft.message.slice(0, 12000);
        sendStatus.textContent = "Brouillon restauré. Ajoutez les PDF avant le contrôle final.";
      }
    } catch { /* La préparation reste disponible sans brouillon local. */ }
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

  document.querySelector("#send-skip").addEventListener("click", () => {
    if (!batchSize || !sendApplication || sendSubmit.disabled) return;
    batchSelection.delete(sendApplication.id);
    updateBatchSelection();
    sendDialog.close();
    nextBatchApplication();
  });

  document.querySelector("#send-cancel").addEventListener("click", () => {
    if (sendSubmit.disabled) return;
    cancelBatch();
    sendDialog.close();
  });
  sendDialog.addEventListener("cancel", event => {
    if (sendSubmit.disabled) event.preventDefault();
    else cancelBatch();
  });
  async function checkSendDraft(application, files) {
    const [blockedResponse, gmail] = await Promise.all([
      supabaseRpc("is_company_email_blocked", {
        p_company_name: application.company_name, p_city: application.company_city || "", p_email: application.company_email
      }),
      invokeEdgeFunction("gmail-web", { action: "status" }),
      Promise.all(files.map(validateSendPdf))
    ]);
    const blocked = Array.isArray(blockedResponse) ? blockedResponse[0] : blockedResponse;
    if (blocked === true) throw new Error("Cette adresse est bloquée dans la base entreprises. Vérifiez le contact dans le dossier.");
    if (blocked !== false) throw new Error("Impossible de vérifier le destinataire. Réessayez.");
    if (!gmail.configured) throw new Error("Le service Gmail est indisponible.");
    if (!gmail.connected) throw new Error("Connectez Gmail dans Paramètres avant de poursuivre.");
  }

  sendForm.addEventListener("submit", async event => {
    event.preventDefault();
    if (sendSubmit.disabled || !sendApplication) return;
    const userId = getSession()?.user?.id;
    if (!userId) return;
    if (!reviewed) {
      const dossier = sendApplication;
      const [subject, message, fileInput] = sendInputs;
      const draft = { subject: subject.value.trim(), message: message.value.trim(), files: [...fileInput.files, ...selectedDocuments] };
      if (!draft.subject || !draft.message) {
        sendStatus.textContent = "Renseignez l’objet et le message.";
        return;
      }
      if (draft.files.length > 8 || draft.files.some(file => !/\.pdf$/i.test(file.name)) ||
          draft.files.reduce((total, file) => total + file.size, 0) > 10 * 1024 * 1024) {
        sendStatus.textContent = "Choisissez au maximum huit PDF de 10 Mo au total.";
        return;
      }
      sendSubmit.disabled = true;
      sendStatus.textContent = "Vérification du destinataire, de Gmail et des pièces jointes…";
      try {
        await checkSendDraft(dossier, draft.files);
        if (!sendDialog.open || sendApplication !== dossier || getSession()?.user?.id !== userId) return;
        const currentFiles = [...fileInput.files, ...selectedDocuments];
        if (draft.subject !== subject.value.trim() || draft.message !== message.value.trim() ||
            draft.files.length !== currentFiles.length || draft.files.some((file, index) => file !== currentFiles[index])) {
          sendStatus.textContent = "Le brouillon a changé. Relancez le contrôle final.";
          return;
        }
      } catch (error) {
        if (sendDialog.open && sendApplication === dossier && getSession()?.user?.id === userId) sendStatus.textContent = error.message;
        return;
      } finally {
        sendSubmit.disabled = false;
      }
      reviewed = draft;
      sendSaveDraft.hidden = true;
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
      selectedDocumentList.hidden = true;
      sendReview.hidden = false;
      sendReview.focus();
      return;
    }
    const application = sendApplication;
    const draft = { ...reviewed, applicationId: application.id, recipient: application.company_email,
      companyName: application.company_name, updatedAt: application.updated_at };
    if (batchSize) {
      batchDrafts.push(draft);
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
      await verifyReviewedApplication(draft);
      if (!userId || getSession()?.user?.id !== userId) return;
      await invokeEdgeFunction("gmail-web", {
        action: "send", attachments, applicationId: application.id, recipient: application.company_email,
        subject: draft.subject, message: draft.message, reviewedAt: draft.updatedAt
      });
      if (getSession()?.user?.id !== userId) return;
      removeSendDraft(userId, application.id);
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

  async function validateSendPdf(file) {
    if (!/\.pdf$/i.test(file.name) || await file.slice(0, 5).text() !== "%PDF-") {
      throw new Error("Les pièces jointes doivent être des PDF.");
    }
  }

  async function encodeSendFiles(files) {
    return Promise.all(files.map(async file => {
        await validateSendPdf(file);
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
  const outlookFlowKey = "candidature-pro-outlook-flow";
  const outlookStatus = document.querySelector("#outlook-status");
  const outlookConnect = document.querySelector("#outlook-connect");
  const outlookDisconnect = document.querySelector("#outlook-disconnect");

  async function loadOutlook() {
    const userId = getSession()?.user?.id;
    outlookConnect.hidden = outlookDisconnect.hidden = true;
    outlookStatus.textContent = userId ? "Vérification de la connexion Outlook…" : "Connectez-vous à Candidature Pro pour lier Outlook.";
    if (!userId) return;
    try {
      const result = await invokeEdgeFunction("outlook-web", { action: "status" });
      if (getSession()?.user?.id !== userId) return;
      outlookConnect.hidden = !result.configured || result.connected;
      outlookDisconnect.hidden = !result.connected;
      outlookStatus.textContent = result.connected ? "Compte Outlook connecté." :
        result.configured ? "Aucun compte Outlook connecté." : "La connexion Outlook attend la configuration Microsoft.";
    } catch (error) {
      if (getSession()?.user?.id === userId) outlookStatus.textContent = error.message;
    }
  }

  outlookConnect.addEventListener("click", async () => {
    const userId = getSession()?.user?.id;
    if (!userId) return;
    outlookConnect.disabled = true;
    try {
      const verifier = gmailEncode(crypto.getRandomValues(new Uint8Array(32)));
      const state = gmailEncode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = gmailEncode(new Uint8Array(await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier))));
      const result = await invokeEdgeFunction("outlook-web", { action: "start", challenge, state });
      if (getSession()?.user?.id !== userId) return;
      const url = new URL(result.url);
      if (url.origin !== "https://login.microsoftonline.com" || !url.pathname.endsWith("/oauth2/v2.0/authorize"))
        throw new Error("Adresse Microsoft inattendue.");
      sessionStorage.setItem(outlookFlowKey, JSON.stringify({ verifier, state, userId, startedAt: Date.now() }));
      location.assign(url.href);
    } catch (error) { outlookStatus.textContent = error.message; }
    finally { outlookConnect.disabled = false; }
  });

  outlookDisconnect.addEventListener("click", async () => {
    outlookDisconnect.disabled = true;
    try { await invokeEdgeFunction("outlook-web", { action: "disconnect" }); await loadOutlook(); }
    catch (error) { outlookStatus.textContent = error.message; }
    finally { outlookDisconnect.disabled = false; }
  });

  async function finishOutlookConnection() {
    const url = new URL(location.href);
    if (!url.searchParams.has("state") || !(url.searchParams.has("code") || url.searchParams.has("error"))) return false;
    const stored = sessionStorage.getItem(outlookFlowKey);
    if (!stored) return false;
    sessionStorage.removeItem(outlookFlowKey);
    history.replaceState(null, "", url.pathname);
    showView("settings", false);
    try {
      const flow = JSON.parse(stored);
      if (flow.state !== url.searchParams.get("state") || Date.now() - flow.startedAt > 10 * 60 * 1000 ||
          flow.userId !== getSession()?.user?.id || !url.searchParams.get("code"))
        throw new Error(url.searchParams.has("error") ? "L’autorisation Outlook a été refusée." : "La demande Outlook a expiré. Réessayez.");
      await invokeEdgeFunction("outlook-web", { action: "exchange", code: url.searchParams.get("code"), verifier: flow.verifier });
      await loadOutlook();
    } catch (error) { await loadOutlook(); outlookStatus.textContent = error.message; }
    return true;
  }

  function gmailEncode(bytes) {
    return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }

  const settingsCheck = document.querySelector("#settings-check");
  const settingsCheckResults = document.querySelector("#settings-check-results");
  settingsCheck.addEventListener("click", async () => {
    const userId = getSession()?.user?.id;
    if (!userId || settingsCheck.disabled) return;
    settingsCheck.disabled = true;
    settingsCheckResults.hidden = false;
    const showChecks = checks => settingsCheckResults.replaceChildren(...checks.map(text => {
      const item = document.createElement("li");
      item.textContent = text;
      return item;
    }));
    showChecks(["Vérification en cours…"]);
    try {
      const checks = await Promise.allSettled([
        supabaseFetch("user_applications?select=id&limit=1"),
        invokeEdgeFunction("gmail-web", { action: "status" }),
        invokeEdgeFunction("outlook-web", { action: "status" })
      ]);
      if (getSession()?.user?.id !== userId) return;
      const [applicationsCheck, gmailCheck, outlookCheck] = checks;
      showChecks([
        applicationsCheck.status === "fulfilled" ? "Accès aux candidatures opérationnel." : "Accès aux candidatures indisponible.",
        gmailCheck.status !== "fulfilled" ? "Service Gmail indisponible." :
          !gmailCheck.value.configured ? "Service Gmail en attente de configuration." :
          gmailCheck.value.connected ? "Connexion Gmail enregistrée." : "Aucun compte Gmail lié.",
        outlookCheck.status !== "fulfilled" ? "Service Outlook indisponible." :
          !outlookCheck.value.configured ? "Service Outlook en attente de configuration." :
          outlookCheck.value.connected ? "Connexion Outlook enregistrée." : "Aucun compte Outlook lié."
      ]);
    } finally {
      settingsCheck.disabled = false;
    }
  });

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

  const gmailSyncVisible = () => !appShell.hidden && !document.hidden &&
    (trackingVisible() || document.querySelector("#dashboard").classList.contains("active"));

  function syncGmailRepliesAutomatically() {
    const userId = getSession()?.user?.id;
    if (userId && gmailSyncVisible() &&
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
        if (after && !manual && !gmailSyncVisible()) {
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
      const session = getSession();
      if (updated && session?.user?.id === userId) {
        await Promise.all([updateTrackingCounts(session), trackingVisible() ? loadTracking() : null]);
      }
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
      const oauthError = url.searchParams.get("error");
      if (oauthError) {
        const messages = new Map([
          ["access_denied", "L’autorisation Gmail a été refusée. Relancez la connexion pour réessayer."],
          ["temporarily_unavailable", "Google est temporairement indisponible. Réessayez dans quelques minutes."],
          ["server_error", "Google n’a pas pu terminer la connexion. Réessayez dans quelques minutes."]
        ]);
        throw new Error(messages.get(oauthError) || "Google n’a pas pu autoriser Gmail. Relancez la connexion.");
      }
      await invokeEdgeFunction("gmail-web", { action: "exchange", code: url.searchParams.get("code"), verifier: flow.verifier, readReplies: flow.readReplies === true });
      if (flow.readReplies && flow.fromTracking) await syncGmailReplies(true);
      else await loadGmail();
    } catch (error) {
      await loadGmail();
      (flow?.fromTracking ? repliesStatus : gmailStatus).textContent = error.message;
    }
  }

  async function bootstrap() {
    if (await finishPasswordRecovery()) return;
    await finishMicrosoftConnection();
    await ensureSession();
    const signupConfirmation = await window.CP_SIGNUP.complete(getSession()?.user?.email || null);
    if (signupConfirmation?.session) { profile = null; setSession(normalizeSession(signupConfirmation.session)); }
    await ensureSession();
    renderAccount();
    showView("dashboard", false);
    if (!await finishOutlookConnection()) await finishGmailConnection();
    syncGmailRepliesAutomatically();
    const url = new URL(location.href);
    const signupRequested = url.searchParams.has("inscription"), signinRequested = url.searchParams.has("connexion");
    if (signupRequested || signinRequested) {
      url.searchParams.delete("connexion"); url.searchParams.delete("inscription"); history.replaceState(null, "", url);
      if (appShell.hidden) { setAuthMode(signupRequested ? "signup" : "signin"); dialog.showModal(); }
    }
    if (signupConfirmation?.error) {
      if (appShell.hidden) { setAuthMode("signin"); loginMessage.textContent = signupConfirmation.error; if (!dialog.open) dialog.showModal(); }
      else { showView("settings"); passwordRecoveryStatus.textContent = signupConfirmation.error; }
    }
    try { await loadDashboard(); }
    catch (error) {
      document.querySelector("#account-label").textContent = error.message;
    }
  }

  bootstrap();
})();
