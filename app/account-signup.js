(() => {
  'use strict';
  const config = window.CANDIDATURE_PRO_CONFIG || {};
  const flowKey = 'candidature-pro-web-signup';
  function encode(bytes) { let text = ''; for (const byte of bytes) text += String.fromCharCode(byte); return btoa(text).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, ''); }
  function failure(code, fallback) {
    const messages = {
      signup_disabled: 'La création de comptes est momentanément désactivée.',
      email_provider_disabled: 'L’inscription par e-mail est momentanément désactivée.',
      email_address_invalid: 'Vérifiez le format de votre adresse e-mail.',
      weak_password: 'Le mot de passe ne respecte pas les exigences du service. Choisissez un mot de passe plus long et difficile à deviner.',
      over_email_send_rate_limit: 'Trop de messages demandés. Patientez avant de réessayer.',
      over_request_rate_limit: 'Trop de demandes rapprochées. Patientez avant de réessayer.',
      email_exists: 'Essayez de vous connecter ou utilisez « Mot de passe oublié ».',
      user_already_exists: 'Essayez de vous connecter ou utilisez « Mot de passe oublié ».',
      otp_expired: 'Ce lien a expiré. Renvoyez le message de confirmation ou essayez de vous connecter.',
      flow_state_expired: 'Ce lien a expiré. Essayez de vous connecter avec votre e-mail et votre mot de passe.',
      flow_state_not_found: 'Ce lien n’est plus utilisable ici. Essayez de vous connecter avec votre e-mail et votre mot de passe.'
    };
    const error = new Error(messages[code] || fallback); error.code = code; error.definitive = true; return error;
  }
  function redirect() { return new URL(location.pathname, location.origin).href; }
  async function request(path, body, withRedirect = false) {
    let response;
    try {
      response = await fetch(config.supabaseUrl + '/auth/v1/' + path + (withRedirect ? '?redirect_to=' + encodeURIComponent(redirect()) : ''), {
        method: body ? 'POST' : 'GET', headers: { apikey: config.supabasePublishableKey, 'Content-Type': 'application/json' },
        ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(15000)
      });
    } catch { const error = new Error('Connexion interrompue. La demande a peut-être abouti : vérifiez vos e-mails avant de réessayer.'); error.uncertain = true; throw error; }
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw failure(result.error_code || result.code || (response.status === 429 ? 'over_request_rate_limit' : ''), 'Le service ne peut pas terminer cette demande. Réessayez plus tard.');
    return result;
  }
  function emailAddress(value) {
    const email = String(value || '').trim().toLowerCase();
    if (!email || email.length > 254 || !/^[^\s@]+@[^\s@]+$/.test(email)) throw Error('Indiquez une adresse e-mail valide.');
    return email;
  }
  function validSession(result, email) {
    return typeof result.access_token === 'string' && Boolean(result.access_token) && typeof result.refresh_token === 'string' && Boolean(result.refresh_token) &&
      typeof result.user?.id === 'string' && Boolean(result.user.id) && result.user.email?.toLowerCase() === email;
  }
  async function create(email, password) {
    email = emailAddress(email);
    if (typeof password !== 'string' || password.length < 8 || password.length > 128) throw Error('Choisissez un mot de passe de 8 à 128 caractères.');
    const settings = await request('settings');
    if (settings.disable_signup === true) throw failure('signup_disabled');
    if (settings.external?.email === false) throw failure('email_provider_disabled');
    if (typeof settings.mailer_autoconfirm !== 'boolean') throw Error('La configuration d’inscription n’a pas pu être vérifiée. Réessayez plus tard.');
    const body = { email, password };
    let previous = null, stored = null;
    if (!settings.mailer_autoconfirm) {
      const verifier = encode(crypto.getRandomValues(new Uint8Array(32)));
      const challenge = encode(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier))));
      previous = localStorage.getItem(flowKey); stored = JSON.stringify({ email, verifier, startedAt: Date.now() });
      localStorage.setItem(flowKey, stored);
      body.code_challenge = challenge; body.code_challenge_method = 's256';
    }
    try {
      const result = await request('signup', body, true);
      if (settings.mailer_autoconfirm && validSession(result, email)) return { type: 'session', session: result };
      // Existing accounts can receive an intentionally obfuscated response. Never treat it as a signed-in session.
      return { type: 'confirmation', email };
    } catch (error) {
      if (error.definitive && stored && localStorage.getItem(flowKey) === stored) {
        if (previous) localStorage.setItem(flowKey, previous); else localStorage.removeItem(flowKey);
      }
      throw error;
    }
  }
  async function resend(email) {
    await request('resend', { type: 'signup', email: emailAddress(email) }, true);
  }
  async function complete(currentEmail = null) {
    const url = new URL(location.href);
    if (url.searchParams.has('state') || url.searchParams.has('recuperation')) return null;
    let raw = null, flow = null;
    try { raw = localStorage.getItem(flowKey); flow = JSON.parse(raw || 'null'); } catch { /* Missing or malformed verifier is handled below. */ }
    if (!url.searchParams.has('code') && !(url.searchParams.has('error') && flow)) return null;
    const code = url.searchParams.get('code'), errorCode = url.searchParams.get('error_code') || url.searchParams.get('error');
    for (const key of ['code', 'error', 'error_description', 'error_code']) url.searchParams.delete(key);
    history.replaceState(null, '', url.pathname + url.search);
    try {
      if (errorCode) throw failure(errorCode, 'Le lien de confirmation n’est plus utilisable. Renvoyez le message ou essayez de vous connecter.');
      if (!code || code.length > 4096 || !flow || !/^[A-Za-z0-9_-]{43}$/.test(flow.verifier || '') || !Number.isFinite(flow.startedAt) || flow.startedAt > Date.now() || Date.now() - flow.startedAt > 24 * 60 * 60 * 1000) throw Error('Le lien a expiré ou a été ouvert dans un autre navigateur. Essayez de vous connecter avec votre e-mail et votre mot de passe ; renvoyez la confirmation si nécessaire.');
      const email = emailAddress(flow.email);
      if (currentEmail && currentEmail.toLowerCase() !== email) throw Error('Un autre compte est déjà connecté dans ce navigateur. Déconnectez-vous pour utiliser le compte confirmé.');
      const result = await request('token?grant_type=pkce', { auth_code: code, code_verifier: flow.verifier });
      if (!validSession(result, email)) throw Error('La confirmation ne correspond pas au compte demandé. Connectez-vous avec vos identifiants.');
      if (localStorage.getItem(flowKey) === raw) localStorage.removeItem(flowKey);
      return { session: result };
    } catch (error) { return { error: error.message }; }
  }
  window.CP_SIGNUP = Object.freeze({ create, resend, complete });
})();
