Warning: truncated output (original token count: 71449)
Total output lines: 5260

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
    document.querySelector("#account-label").textContent = email || "Espace candidat";
    document.querySelector("#first-name").textContent = firstName || (email ? email.split("@")[0] : "👋");
    loginButton.textContent = email ? "Mon compte" : "Se connecter";
    signOutButton.hidden = !email;

    const isPremium = hasPremiumCv();
    const planLabel = profile ? (isPremium ? "Premium" : "Free") : "Vérification…";
    document.querySelector("#cv-targeting").hidden = !isPremium;
    const cvTemplateSelect = document.querySelector("#cv-form [name=template]");
    cvTemplateSelect.querySelectorAll("option:not([value=classic])").forEach(option => { option.disabled = !isPremium; });
    document.querySelector("#cv-premium-access-status").textContent = !profile ? "Vérification des droits du compte…" : isPremium ? "Premium actif : les trois modèles de CV sont disponibles." : "Formule Free : seul le modèle Classique est disponible. Vérifiez votre formule dans Premium.";
    if (!isPremium && cvTemplateSelect.value !== "classic") {
      cvTemplateSelect.value = "classic";
      document.querySelector("#cv-save-status").textContent = "Votre formule actuelle donne accès au modèle Classique. Les modèles Contemporain et Compact nécessitent Premium.";
    }
    syncCvStudio();
    document.querySelector("#current-plan").textContent = planLabel;
    document.querySelector("#settings-account").textContent = email
      ? email + (profile ? " · " + (isPremium ? "Premium" : "Free") : "")
      : "Connectez-vous pour accéder à votre compte.";
    document.querySelector("#premium-plan").textContent = "Formule actuelle · " + planLabel;
    document.querySelector("#plan-detail").textContent = !profile ? "Vérification des droits du compte" : isPremium ? "Candidatures illimitées" : "3 recherches par mois";
    document.querySelector("#premium-checkout").hidden = !profile?.is_admin || isPremium;
    document.querySelector("#premium-portal").hidden = true;
    document.querySelector("#premium-billing-note").hidden = !profile?.is_admin;
    document.querySelector("#premium-checkout").dataset.billingMode = "sandbox";
    document.querySelector("#premium-portal").dataset.billingMode = "sandbox";
  }

  async function refreshPremiumBillingStatus() {
    const status = document.querySelector("#premium-billing-status");
    const session = getSession();
    if (!session?.user?.id) { status.textContent = "Connectez-vous pour consulter votre formule."; return false; }
    try {
      let result;
      try {
        result = await invokeEdgeFunction("stripe-live-billing", { action: "status" });
      } catch {
        result = await invokeEdgeFunction("stripe-sandbox-billing", { action: "status" });
      }
      if (getSession()?.user?.id !== session.user.id) return false;
      const liveAvailable = result.mode === "live" && result.available === true;
      const checkoutButton = document.querySelector("#premium-checkout");
      const portalButton = document.querySelector("#premium-portal");
      checkoutButton.dataset.billingMode = liveAvailable ? "live" : "sandbox";
      portalButton.dataset.billingMode = result.mode === "live" && result.portal_available ? "live" : "sandbox";
      document.querySelector("#premium-billing-note").hidden = liveAvailable || !profile?.is_admin;
      if (result.subscription) {
        const active = ["active", "trialing", "past_due"].includes(result.subscription.status) &&
          (!result.subscription.current_period_end || Date.parse(result.subscription.current_period_end) > Date.now());
        checkoutButton.hidden = (!liveAvailable && !profile?.is_admin) || active || hasPremiumCv();
        portalButton.hidden = result.mode === "live"
          ? !result.portal_available
          : (!profile?.is_admin || !result.subscription.customer_id);
        const expiry = result.subscription.current_period_end
          ? new Intl.DateTimeFormat("fr-CH", { dateStyle: "long", timeZone: "Europe/Zurich" }).format(new Date(result.subscription.current_period_end))
          : null;
        const suffix = expiry ? " jusqu’au " + expiry : "";
        status.textContent = result.subscription.cancel_at_period_end
          ? "Votre Premium reste actif" + suffix + " puis ne sera pas renouvelé."
          : result.subscription.status === "past_due"
            ? "Un paiement est en attente. Votre accès reste disponible pendant la période déjà réglée" + suffix + "."
            : "Abonnement Premium actif · 14,99 CHF par mois" + suffix + ".";
      } else {
        checkoutButton.hidden = (!liveAvailable && !profile?.is_admin) || hasPremiumCv();
        portalButton.hidden = true;
        status.textContent = "Formule actuelle · " + (hasPremiumCv() ? "Premium (activation manuelle)" : "Free");
      }
      return Boolean(result.subscription);
    } catch (error) {
      document.querySelector("#premium-checkout").hidden = !profile?.is_admin || hasPremiumCv();
      document.querySelector("#premium-portal").hidden = true;
      status.textContent = "État de l’abonnement momentanément indisponible. Votre formule actuelle reste inchangée.";
      return false;
    }
  }

  async function openPremiumBilling(action, button) {
    button.disabled = true;
    const status = document.querySelector("#premium-billing-status");
    status.textContent = action === "checkout" ? "Ouverture du paiement sécurisé…" : "Ouverture de la gestion de l’abonnement…";
    try {
      const mode = button.dataset.billingMode === "live" ? "live" : "sandbox";
      const result = await invokeEdgeFunction(mode === "live" ? "stripe-live-billing" : "stripe-sandbox-billing", { action });
      const destination = new URL(result.url);
      const allowed = action === "checkout"
        ? destination.origin === "https://checkout.stripe.com"
        : destination.origin === "https://billing.stripe.com";
      if (!allowed) throw new Error("Adresse de paiement inattendue.");
      location.assign(destination.href);
    } catch (error) {
      status.textContent = error.message || "Le service de paiement est momentanément indisponible.";
    } finally {
      button.disabled = false;
    }
  }

  document.querySelector("#premium-checkout").addEventListener("click", event => openPremiumBilling("checkout", event.currentTarget));
  document.querySelector("#premium-portal").addEventListener("click", event => openPremiumBilling("portal", event.currentTarget));

  function showView(name, syncReplies = true) {
    if (appShell.hidden || (name === "admin" && profile?.is_admin !== true)) return;
    if (profile) refreshAccountRights();
    if (name === "premium") void refreshPremiumBillingStatus();
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
    document.querySelectorAll(".nav-item[data-view]").forEach(item => {
      const active = item.dataset.view === name;
      item.classList.toggle("active", active);
      if (active) item.setAttribute("aria-current", "page");
      else item.removeAttribute("aria-current");
    });

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
    setMobileMenuOpen(false);
    window.scrollTo(0, 0);
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

  function trustedJobSourceUrl(job) {
    const safeUrl = safeExternalUrl(job?.url);
    if (!safeUrl) return "";
    try {
      const parsed = new URL(safeUrl);
      if (parsed.protocol !== "https:") return "";
      if (job.source === "JobScout24" &&
          !["jobscout24.ch", "www.jobscout24.ch"].includes(parsed.hostname.toLowerCase())) return "";
      if (job.source === "JobScout24" && !parsed.pathname.startsWith("/fr/job/")) return "";
      return safeUrl;
    } catch { return ""; }
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

  function isSearchableCompany(company) {
    const name = String(company.name || "").trim();
    // A geocoded street or building address is not the name of an employer.
    if (/^(?:rue|route|avenue|chemin|boulevard|passage|place|quai|sentier|impasse)\s+/i.test(name)) return false;
    if (company.sector === "Immobilier" && /^(?:gare de |metro shopping$)/i.test(name)) return false;
    // Fuel stations and convenience stores are not automotive employers for this search.
    if (company.sector === "Automobile" && /^(?:avia|bp|shell|tamoil|migrolino|coop\s+pronto)(?:\b.*)?$/i.test(name)) return false;
    return Boolean(name);
  }

  function uniqueSearchableCompanies(companies) {
    const seen = new Set();
    return companies.filter(company => {
      if (!isSearchableCompany(company)) return false;
      // Preserve different branches of the same employer at distinct addresses.
      const canonical = value => String(value || "").normalize("NFKC")
        .toLocaleLowerCase("fr").replace(/\s+/g, " ").trim();
      const name = canonical(company.name);
      const address = canonical(company.address);
      const city = canonical(company.city);
      // City alone is not a unique location: several branches may share it.
      // Without an address, only deduplicate when a stronger identifier exists.
      const recordId = canonical(company.id);
      const key = address
        ? name + "|city|" + city + "|address|" + address
        : recordId ? "record|" + recordId : "";
      if (!key) return true;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  function isSuspectCompanyWebsite(company) {
    const name = String(company.name || "").trim().toLocaleLowerCase("fr");
    const url = safeExternalUrl(company.website);
    if (!url) return false;
    // Confirmed directory mismatch to review: Proman listing points to BM Emploi.
    // Do not silently change the source URL or the company's saved contacts.
    const host = new URL(url).hostname.toLowerCase();
    return name === "proman" && (host === "bm-emploi.ch" || host === "www.bm-emploi.ch");
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
        ? '<a href="' + escapeHtml(safeWebsite) + '" target="_blank" rel="noopener noreferrer">' +
          (isSuspectCompanyWebsite(company) ? 'Lien à vérifier (autre enseigne)' : 'Site indiqué') + '</a>'
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

  async function searchCompanies({ complete = false } = {}) {
    const message = document.querySelector("#company-search-message");
    const source = document.querySelector("#company-search-source");
    const sector = document.querySelector("#company-sector").value.trim();
    const city = document.querySelector("#company-city").value.trim();
    const radius = document.querySelector("#company-radius").value;
    message.textContent = "Recherche dans la base entreprises…";
    source.textContent = "";

    const cached = await supabaseRpc("get_cached_company_search", {
      p_sector: sector,
      p_city: city,
      p_radius: radius
    });
    const cachedCompanies = Array.isArray(cached) ? cached.map(normalizeCompany) : [];
    const usableCachedCompanies = uniqueSearchableCompanies(cachedCompanies);
    // A fresh cache containing only excluded/invalid entries must not block discovery.
    if (usableCachedCompanies.length && !complete) {
      companyResults = usableCachedCompanies;
      renderCompanies();
      source.textContent = "Base entreprises • sans crédit API";
      message.textContent = companyResults.length + " entreprise" + (companyResults.length > 1 ? "s trouvées." : " trouvée.") +
        (cachedCompanies.length >= 100 ? " Au moins 100 fiches ont été récupérées : la liste peut être incomplète. Affinez la ville ou le rayon." : "");
      await supabaseRpc("record_company_search_event", { p_sector: sector || "Tous les secteurs", p_city: city });
      return;
    }

    if (!complete) {
      const geographic = await supabaseRpc("get_geocoded_company_search", {
        p_sector: sector, p_city: city, p_radius: radius
      });
      const reusable = Array.isArray(geographic) && geographic.length ? geographic :
        await supabaseRpc("get_reusable_company_search", {
          p_sector: sector, p_city: city, p_radius: radius
        });
      const known = uniqueSearchableCompanies((Array.isArray(reusable) ? reusable : []).map(normalizeCompany));
      if (known.length) {
        companyResults = known;
        renderCompanies();
        source.textContent = "Base entreprises • sans crédit API";
        message.textContent = known.length + " entreprise(s) enregistrée(s) dans ce périmètre. " +
          "La liste peut être incomplète pour ce rayon. ";
        const completion = document.createElement("button");
        completion.type = "button";
        completion.className = "secondary compact";
        completion.textContent = "Compléter par Internet (utilise le quota de recherche)";
        completion.addEventListener("click", async () => {
          if (companySearchRunning) return;
          companySearchRunning = completion.disabled = true;
          try { await searchCompanies({ complete: true }); }
          catch (error) { message.textContent = error.message; }
          finally { companySearchRunning = completion.disabled = false; }
        });
        message.append(completion);
        await supabaseRpc("record_company_search_event", { p_sector: sector || "Tous les secteurs", p_city: city });
        return;
      }
    }

    message.textContent = "Recherche Internet en cours…";
    const result = await invokeEdgeFunction("app-services", {
      action: "company_search",
      payload: { sector, city, radius }
    });
    const quota = result.quota || {};
    const rawCompanies = Array.isArray(result.companies) ? result.companies : [];
    // The shared cache enforces admin-inactive exclusions and canonical contact
    // rules. Read it back before showing Internet results so both views agree.
    if (rawCompanies.length) {
      await supabaseRpc("remember_geocoded_company_search", {
        p_sector: sector,
        p_city: city,
        p_radius: radius,
        p_companies: rawCompanies,
        p_center: result.center || null
      });
    }
    const verified = rawCompanies.length ? await supabaseRpc("get_cached_company_search", {
      p_sector: sector,
      p_city: city,
      p_radius: radius
    }) : [];
    companyResults = uniqueSearchableCompanies((Array.isArray(verified) ? verified : []).map(normalizeCompany));
    renderCompanies();
    source.textContent = quota.premium ? "Recherche Internet • Premium" : "Recherche Internet • " + (quota.used ?? "—") + "/" + (quota.limit ?? 3);
    message.textContent = (companyResults.length
      ? companyResults.length + " entreprise" + (companyResults.length > 1 ? "s trouvées." : " trouvée.")
      : "Aucune entreprise trouvée pour ces critères.") +
      (rawCompanies.length >= 100 || (Array.isArray(verified) && verified.length >= 100)
        ? " Au moins 100 fiches ont été récupérées : la liste peut être incomplète. Affinez la ville ou le rayon."
        : "");
    if (companyResults.some(company => company.email)) {
      await supabaseRpc("review_discovered_company_emails", { p_companies: companyResults });
    }
    await supabaseRpc("record_company_search_event", { p_sector: sector || "Tous les secteurs", p_city: city });
  }

  function renderJobs() {
    const container = document.querySelector("#jobs-results");
    document.querySelector("#jobs-results-count").textContent =
      jobResults.length + " offre" + (jobResults.length === 1 ? "" : "s");

    if (!jobResults.length) {
      container.innerHTML = '<div class="empty-list"><strong>Aucune offre trouvée</strong><span>Modifiez le métier, la ville ou le secteur.</span></div>';
      return;
    }

    container.innerHTML = jobResults.map((job, index) => {
      const trustedJobLink = trustedJobSourceUrl(job);
      const sourceLink = trustedJobLink
        ? '<a class="secondary compact" href="' + escapeHtml(trustedJobLink) + '" target="_blank" rel="noopener noreferrer">Voir l’annonce</a>'
        : "";
      const checkedAt = Date.parse(job.updated_at || "");
      const daysSinceCheck = Number.isFinite(checkedAt) ? Math.floor((Date.now() - checkedAt) / 86400000) : Infinity;
      const lastSearched = Number.isFinite(checkedAt)
        ? '<small>Fiche mise à jour le ' + escapeHtml(new Date(checkedAt).toLocaleDateString("fr-CH", { day: "numeric", month: "long", year: "numeric" })) + '</small>'
        : "";
      const availabilityNote = job.availability_status === "accessible" && job.availability_checked_at
        ? '<small>Lien accessible lors du contrôle du ' + escapeHtml(new Date(job.availability_checked_at).toLocaleDateString("fr-CH")) + ' — disponibilité du poste à confirmer.</small>'
        : job.availability_status === "suspected_expired"
          ? '<small>Attention : lien potentiellement expiré — vérifiez sur le site source.</small>'
          : '<small>Disponibilité du poste non vérifiée — consultez le site source.</small>';
      return '<article class="job-card" data-job-index="' + index + '">' +
        '<div class="job-card-main"><strong>' + escapeHtml(job.title) + '</strong>' +
        '<span>' + escapeHtml(job.company_name || "Employeur à vérifier") + ' • ' + escapeHtml(job.location) + '</span>' +
        '<small>Catégorie de recherche : ' + escapeHtml(job.sector) + ' • ' + escapeHtml(job.source) + '</small>' +
        '<p>' + escapeHtml(job.snippet) + '</p>' + lastSearched + availabilityNote + '</div>' +
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
    document.querySelector("#jobs-known-employer-only").checked = true;
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
    const filters = ["active=eq.true", "availability_status=neq.confirmed_expired"];
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
        "job_market_offers?select=id,title,company_name,location,sector,source,url,snippet,d…41449 tokens truncated…sion()?.user?.id === userId) message.textContent = "Le dossier a changé. Vérifiez son statut avant de réessayer.";
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
  const menuToggle = document.querySelector("#menu-toggle");
  const sidebarScrim = document.querySelector(".sidebar-scrim");
  function setMobileMenuOpen(open) {
    sidebar.classList.toggle("open", open);
    sidebarScrim.hidden = !open;
    menuToggle.setAttribute("aria-expanded", String(open));
    menuToggle.setAttribute("aria-label", open ? "Fermer le menu" : "Ouvrir le menu");
  }
  menuToggle.addEventListener("click", () => setMobileMenuOpen(!sidebar.classList.contains("open")));
  sidebarScrim.addEventListener("click", () => setMobileMenuOpen(false));
  document.addEventListener("keydown", event => {
    if (event.key === "Escape" && sidebar.classList.contains("open")) {
      setMobileMenuOpen(false);
      menuToggle.focus();
    }
  });
  guestLogin.addEventListener("click", () => { setAuthMode("signin"); dialog.showModal(); });
  document.querySelector("#guest-signup").addEventListener("click", () => { setAuthMode("signup"); dialog.showModal(); });
  document.querySelector("#close-login").addEventListener("click", () => { if (!authBusy && !document.querySelector("#login-submit").disabled) dialog.close(); });
  loginButton.addEventListener("click", () => {
    if (getSession()) showView("settings");
    else { setAuthMode("signin"); dialog.showModal(); }
  });
  const deleteAccountDialog = document.querySelector("#account-delete-dialog");
  const deleteAccountInput = document.querySelector("#account-delete-confirmation");
  const deleteAccountSubmit = document.querySelector("#account-delete-submit");
  const deleteAccountStatus = document.querySelector("#account-delete-dialog-status");
  const deleteAccountOpen = document.querySelector("#account-delete-open");
  let deleteAccountBusy = false;
  deleteAccountOpen.addEventListener("click", () => {
    if (!getSession()?.user?.id || deleteAccountBusy) return;
    deleteAccountInput.value = "";
    deleteAccountStatus.textContent = "";
    deleteAccountSubmit.disabled = true;
    deleteAccountDialog.showModal();
  });
  deleteAccountInput.addEventListener("input", () => {
    deleteAccountSubmit.disabled = deleteAccountBusy || deleteAccountInput.value !== "SUPPRIMER";
  });
  document.querySelector("#account-delete-cancel").addEventListener("click", () => {
    if (!deleteAccountBusy) deleteAccountDialog.close();
  });
  deleteAccountDialog.addEventListener("cancel", event => {
    if (deleteAccountBusy) event.preventDefault();
  });
  document.querySelector("#account-delete-form").addEventListener("submit", async event => {
    event.preventDefault();
    if (deleteAccountBusy || deleteAccountInput.value !== "SUPPRIMER") return;
    deleteAccountBusy = true;
    deleteAccountSubmit.disabled = true;
    deleteAccountOpen.disabled = true;
    deleteAccountStatus.textContent = "Suppression du compte en cours…";
    try {
      const result = await invokeEdgeFunction("delete-my-account", { confirmation: "SUPPRIMER" });
      if (!result?.deleted) throw new Error("La suppression n'a pas été confirmée par le serveur.");
      // The deleted account must not remain authenticated in this browser.
      setSession(null);
      localStorage.removeItem("candidature-pro-web-signup");
      deleteAccountDialog.close();
      location.replace("../");
    } catch (error) {
      deleteAccountStatus.textContent = error.message || "Impossible de supprimer le compte.";
    } finally {
      deleteAccountBusy = false;
      deleteAccountOpen.disabled = false;
      deleteAccountSubmit.disabled = deleteAccountInput.value !== "SUPPRIMER";
    }
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
  const signupConfirmationMessage = "Si cette adresse peut être utilisée, cherchez l’e-mail « Confirmez votre adresse e-mail | Candidature Pro » envoyé par notifications@transactional.candidaturepro.ch. Ouvrez son lien dans ce même navigateur, puis connectez-vous. S’il n’arrive pas, vérifiez les courriers indésirables ou renvoyez le message. Si vous avez déjà un compte, utilisez la connexion ou « Mot de passe oublié ».";
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
      // A confirmation link may be revisited after successful verification. Never show an error to an authenticated user.
    }
    try { await loadDashboard(); }
    catch (error) {
      document.querySelector("#account-label").textContent = error.message;
    }
    const billingResult = url.searchParams.get("billing");
    if (["success", "cancelled", "returned"].includes(billingResult)) {
      url.searchParams.delete("billing");
      history.replaceState(null, "", url.pathname + url.search + url.hash);
      if (billingResult === "success") document.querySelector("#premium-billing-status").textContent = "Paiement transmis. Votre formule sera activée après confirmation sécurisée par Stripe.";
      else if (billingResult === "cancelled") document.querySelector("#premium-billing-status").textContent = "Paiement annulé. Aucun abonnement n’a été créé.";
      const hasBillingRecord = await refreshPremiumBillingStatus();
      if (billingResult === "success" && !hasBillingRecord) {
        document.querySelector("#premium-billing-status").textContent = "Paiement transmis. L’accès Premium sera activé uniquement après réception et validation de l’événement Stripe.";
      }
    }
  }

  bootstrap();
})();
