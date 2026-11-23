/*
 * Optional cloud account: sign-in with Amazon Cognito (authorization code +
 * PKCE) and an authenticated fetch for the EasyApply API.
 *
 * Loaded by the side panel (popup.html). Sign-in runs in the panel rather than
 * the service worker because Chrome can stop an idle worker while the sign-in
 * window is still open; the panel lives as long as the user keeps it open.
 *
 * Storage (plan/Security and Privacy.md):
 *   chrome.storage.session  cloudSession  { accessToken, idToken, expiresAt }
 *       cleared when the browser closes; not readable by content scripts.
 *   chrome.storage.local    cloudAuth     { refreshToken, email, sub }
 *       cleared on sign-out and by "Delete all data".
 * Every key starting with "cloud" is left out of profile export and refused on
 * import, so a backup file never carries a session and can't plant one.
 */
(function (global) {
    'use strict';

    const CFG = global.EASYAPPLY_CLOUD_CONFIG;
    const SESSION_KEY = 'cloudSession';
    const AUTH_KEY = 'cloudAuth';
    const EXPIRY_SKEW_MS = 60 * 1000; // refresh a minute early
    const ORIGINS = [`${CFG.apiUrl}/*`, `${CFG.authDomain}/*`];

    // ------------------------------------------------------------ helpers

    function b64url(bytes) {
        let s = '';
        for (const b of new Uint8Array(bytes)) s += String.fromCharCode(b);
        return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
    }

    function randomString(byteLength) {
        return b64url(crypto.getRandomValues(new Uint8Array(byteLength)));
    }

    async function pkceChallenge(verifier) {
        const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
        return b64url(digest);
    }

    // Reads claims only. The token came straight from Cognito over TLS, and the
    // API verifies every token itself, so the extension never trusts it for access.
    function decodeJwt(token) {
        const part = String(token).split('.')[1] || '';
        const b64 = part.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (part.length % 4)) % 4);
        const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
        return JSON.parse(new TextDecoder().decode(bytes));
    }

    function notSignedIn(message) {
        const err = new Error(message || 'Not signed in.');
        err.notSignedIn = true;
        return err;
    }

    const redirectUri = () => chrome.identity.getRedirectURL(); // https://<extension-id>.chromiumapp.org/

    // /signup is Cognito's "Create an account" page; it takes the same parameters
    // and returns to the same redirect as /oauth2/authorize.
    function authorizeUrl(state, challenge, signUp = false) {
        const url = new URL(signUp ? '/signup' : '/oauth2/authorize', CFG.authDomain);
        url.search = new URLSearchParams({
            response_type: 'code',
            client_id: CFG.clientId,
            redirect_uri: redirectUri(),
            scope: CFG.scopes.join(' '),
            state,
            code_challenge: challenge,
            code_challenge_method: 'S256'
        }).toString();
        return url.toString();
    }

    async function tokenRequest(params) {
        const res = await fetch(new URL('/oauth2/token', CFG.authDomain), {
            method: 'POST',
            headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: CFG.clientId, ...params })
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
            const err = new Error(body.error_description || body.error || `Sign-in failed (${res.status}).`);
            err.code = body.error;
            throw err;
        }
        return body;
    }

    async function saveTokens(tokens, previousRefreshToken) {
        const claims = decodeJwt(tokens.id_token);
        await chrome.storage.session.set({
            [SESSION_KEY]: {
                accessToken: tokens.access_token,
                idToken: tokens.id_token,
                expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000
            }
        });
        await chrome.storage.local.set({
            [AUTH_KEY]: {
                // Cognito returns a new refresh token only if rotation is on.
                refreshToken: tokens.refresh_token || previousRefreshToken,
                email: claims.email || '',
                sub: claims.sub
            }
        });
    }

    // Also switches sync off on this device (cloudSync, see cloud-sync.js) and
    // forgets which jobs were logged (cloudTracked, cloud-tracker.js): after a
    // different account signs in, nothing from this one may flow into it.
    async function clearCredentials() {
        await chrome.storage.session.remove(SESSION_KEY);
        await chrome.storage.local.remove([AUTH_KEY, 'cloudSync', 'cloudTracked']);
    }

    // ------------------------------------------------------------ public API

    /** Host access to the API and sign-in domains. Must be requested from a click. */
    const hasPermission = () => chrome.permissions.contains({ origins: ORIGINS });
    const requestPermission = () => chrome.permissions.request({ origins: ORIGINS });

    async function status() {
        const { [AUTH_KEY]: auth } = await chrome.storage.local.get(AUTH_KEY);
        return auth && auth.refreshToken ? { signedIn: true, email: auth.email } : { signedIn: false };
    }

    /** Opens Cognito's sign-in page, or its "Create an account" page with { signUp: true }. */
    // The first Google sign-in after Cognito links it to an existing email account
    // can fail once with "Already found an entry for username ..."; the second
    // attempt signs in to the linked account. See cloud/src/functions/link.
    const LINKED_RETRY = /already found an entry for username/i;

    async function signIn({ signUp = false, retried = false } = {}) {
        const verifier = randomString(48);
        const state = randomString(16);
        const challenge = await pkceChallenge(verifier);

        let responseUrl;
        try {
            responseUrl = await chrome.identity.launchWebAuthFlow({
                url: authorizeUrl(state, challenge, signUp),
                interactive: true
            });
        } catch (e) {
            throw new Error('Sign-in was cancelled or the sign-in window could not open.');
        }

        const params = new URL(responseUrl).searchParams;
        if (params.get('error')) {
            const msg = params.get('error_description') || params.get('error');
            if (!retried && LINKED_RETRY.test(msg)) return signIn({ signUp: false, retried: true });
            throw new Error(msg);
        }
        if (params.get('state') !== state) throw new Error('Sign-in response did not match this request. Please try again.');
        const code = params.get('code');
        if (!code) throw new Error('Sign-in did not return an authorization code.');

        const tokens = await tokenRequest({
            grant_type: 'authorization_code',
            code,
            redirect_uri: redirectUri(),
            code_verifier: verifier
        });
        await saveTokens(tokens);
        return status();
    }

    let refreshing = null;

    async function refresh() {
        const { [AUTH_KEY]: auth } = await chrome.storage.local.get(AUTH_KEY);
        if (!auth || !auth.refreshToken) throw notSignedIn();
        try {
            const tokens = await tokenRequest({ grant_type: 'refresh_token', refresh_token: auth.refreshToken });
            await saveTokens(tokens, auth.refreshToken);
            return tokens.access_token;
        } catch (e) {
            if (e.code === 'invalid_grant') {
                await clearCredentials();
                throw notSignedIn('Your session expired. Please sign in again.');
            }
            throw e;
        }
    }

    async function getAccessToken() {
        const { [SESSION_KEY]: session } = await chrome.storage.session.get(SESSION_KEY);
        if (session && session.expiresAt - EXPIRY_SKEW_MS > Date.now()) return session.accessToken;
        if (!refreshing) refreshing = refresh().finally(() => { refreshing = null; });
        return refreshing;
    }

    /** Calls the EasyApply API as the signed-in user. Retries once on 401 with a fresh token. */
    async function api(path, { method = 'GET', body } = {}) {
        const send = (token) => fetch(new URL(path, CFG.apiUrl), {
            method,
            headers: {
                Authorization: `Bearer ${token}`,
                ...(body === undefined ? {} : { 'Content-Type': 'application/json' })
            },
            body: body === undefined ? undefined : JSON.stringify(body)
        });

        let res = await send(await getAccessToken());
        if (res.status === 401) {
            await chrome.storage.session.remove(SESSION_KEY);
            res = await send(await getAccessToken());
        }
        const text = await res.text();
        let data = null;
        try { data = text ? JSON.parse(text) : null; } catch (e) { data = null; }
        if (!res.ok) {
            const err = new Error((data && data.error) || `Request failed (${res.status}).`);
            err.status = res.status;
            throw err;
        }
        return data;
    }

    /** Signs out on this device. Local profile data is not touched. */
    async function signOut() {
        const { [AUTH_KEY]: auth } = await chrome.storage.local.get(AUTH_KEY);
        await clearCredentials(); // first, so a failed network call can't leave a session behind

        if (auth && auth.refreshToken) {
            try {
                await fetch(new URL('/oauth2/revoke', CFG.authDomain), {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                    body: new URLSearchParams({ token: auth.refreshToken, client_id: CFG.clientId })
                });
            } catch (e) { /* offline: the token still expires on its own */ }
        }
        // End the Cognito session cookie so the next sign-in asks for credentials again.
        try {
            const url = new URL('/logout', CFG.authDomain);
            url.search = new URLSearchParams({ client_id: CFG.clientId, logout_uri: redirectUri() }).toString();
            await chrome.identity.launchWebAuthFlow({ url: url.toString(), interactive: false });
        } catch (e) { /* best effort */ }
    }

    /** Deletes the cloud account and everything in it, then signs out. */
    async function deleteAccount() {
        const result = await api('/account', { method: 'DELETE', body: { confirm: 'DELETE' } });
        await signOut();
        return result;
    }

    const isCloudKey = (key) => typeof key === 'string' && key.startsWith('cloud');

    global.EasyApplyCloud = Object.freeze({
        hasPermission,
        requestPermission,
        status,
        signIn,
        signOut,
        api,
        deleteAccount,
        isCloudKey,
        _test: { pkceChallenge, decodeJwt, authorizeUrl, getAccessToken }
    });
})(self);
