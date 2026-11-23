/*
 * Better Autofill web dashboard. No framework, no build, no third-party code
 * (PRIVACY_POLICY.md: no third-party network calls).
 *
 * Sign-in: Cognito managed login, authorization code + PKCE, public client.
 * Tokens live in sessionStorage: they end with the tab, and the CSP allows
 * scripts from this origin only, which is what keeps them away from other code.
 * All user text is rendered with textContent, never innerHTML.
 */
(() => {
  'use strict';

  const STATUSES = ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn'];
  const TOKENS = 'ba.tokens';
  const PKCE = 'ba.pkce';
  const $ = (id) => document.getElementById(id);
  let CFG;
  let items = [];
  let cursor = null;

  // ------------------------------------------------------------------ auth
  const b64url = (bytes) => btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  const randomString = () => b64url(crypto.getRandomValues(new Uint8Array(32)));
  const redirectUri = () => `${location.origin}/auth/callback`;

  function claims(jwt) {
    try {
      const part = jwt.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
      return JSON.parse(decodeURIComponent(escape(atob(part))));
    } catch { return {}; }
  }

  async function signIn() {
    const verifier = randomString();
    const state = randomString();
    sessionStorage.setItem(PKCE, JSON.stringify({ verifier, state }));
    const challenge = b64url(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier)));
    const url = new URL('/oauth2/authorize', CFG.authDomain);
    url.search = new URLSearchParams({
      response_type: 'code', client_id: CFG.clientId, redirect_uri: redirectUri(),
      scope: CFG.scopes.join(' '), state, code_challenge: challenge, code_challenge_method: 'S256',
    });
    location.assign(url);
  }

  async function tokenRequest(params) {
    const res = await fetch(new URL('/oauth2/token', CFG.authDomain), {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ client_id: CFG.clientId, ...params }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error_description || body.error || `Sign-in failed (${res.status})`);
    return body;
  }

  function saveTokens(t, previousRefresh) {
    sessionStorage.setItem(TOKENS, JSON.stringify({
      access: t.access_token, id: t.id_token, refresh: t.refresh_token || previousRefresh,
      expiresAt: Date.now() + Number(t.expires_in || 3600) * 1000,
    }));
  }

  async function finishCallback() {
    const q = new URLSearchParams(location.search);
    const saved = JSON.parse(sessionStorage.getItem(PKCE) || 'null');
    sessionStorage.removeItem(PKCE);
    history.replaceState(null, '', '/');
    if (q.get('error')) throw new Error(q.get('error_description') || q.get('error'));
    if (!saved || !q.get('code') || q.get('state') !== saved.state) throw new Error('Sign-in did not complete. Try again.');
    saveTokens(await tokenRequest({
      grant_type: 'authorization_code', code: q.get('code'), redirect_uri: redirectUri(), code_verifier: saved.verifier,
    }));
  }

  async function accessToken() {
    const t = JSON.parse(sessionStorage.getItem(TOKENS) || 'null');
    if (!t) return null;
    if (Date.now() < t.expiresAt - 60_000) return t.access;
    if (!t.refresh) return null;
    try {
      saveTokens(await tokenRequest({ grant_type: 'refresh_token', refresh_token: t.refresh }), t.refresh);
      return JSON.parse(sessionStorage.getItem(TOKENS)).access;
    } catch {
      sessionStorage.removeItem(TOKENS);
      return null;
    }
  }

  function signOut() {
    sessionStorage.removeItem(TOKENS);
    const url = new URL('/logout', CFG.authDomain);
    url.search = new URLSearchParams({ client_id: CFG.clientId, logout_uri: `${location.origin}/` });
    location.assign(url);
  }

  // ------------------------------------------------------------------ API
  async function api(method, path, body) {
    const token = await accessToken();
    if (!token) { show('signedout'); throw new Error('Signed out'); }
    const res = await fetch(CFG.apiUrl + path, {
      method,
      headers: { Authorization: `Bearer ${token}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      body: body ? JSON.stringify(body) : undefined,
    });
    if (res.status === 204) return null;
    const data = await res.json().catch(() => ({}));
    if (res.status === 401) { sessionStorage.removeItem(TOKENS); show('signedout'); }
    if (!res.ok) throw Object.assign(new Error(data.message || `Request failed (${res.status})`), { status: res.status });
    return data;
  }

  // ------------------------------------------------------------------ UI
  function show(which) {
    $('signedout').hidden = which !== 'signedout';
    $('app').hidden = which !== 'app';
    $('signout').hidden = which !== 'app';
  }

  function error(msg) {
    $('error').textContent = msg || '';
    $('error').hidden = !msg;
  }

  const el = (tag, props = {}, ...kids) => {
    const n = Object.assign(document.createElement(tag), props);
    n.append(...kids.filter((k) => k !== null && k !== undefined));
    return n;
  };
  const fmtDate = (iso) => (iso ? new Date(iso).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' }) : '');
  const label = (s) => s[0].toUpperCase() + s.slice(1);

  function renderStats() {
    const counts = Object.fromEntries(STATUSES.map((s) => [s, 0]));
    for (const it of items) counts[it.status] = (counts[it.status] || 0) + 1;
    const responded = items.filter((i) => ['screening', 'interview', 'offer'].includes(i.status)).length;
    const tiles = [
      ['Total', items.length],
      ['Interviewing', counts.interview],
      ['Offers', counts.offer],
      ['Response rate', items.length ? `${Math.round((responded / items.length) * 100)}%` : '-'],
    ];
    $('stats').replaceChildren(...tiles.map(([k, v]) => el('div', { className: 'stat' }, el('b', { textContent: String(v) }), el('span', { textContent: k }))));
  }

  async function patch(it, fields) {
    try {
      Object.assign(it, await api('PATCH', `/applications/${encodeURIComponent(it.id)}`, fields));
      renderStats();
      error('');
    } catch (e) { error(e.message); }
  }

  function row(it) {
    const status = el('select', { 'aria-label': `Status for ${it.company}` },
      ...STATUSES.map((s) => el('option', { value: s, textContent: label(s), selected: s === it.status })));
    status.addEventListener('change', () => patch(it, { status: status.value }));

    const notes = el('textarea', { value: it.notes || '', maxLength: 2000, placeholder: 'Add a note', 'aria-label': `Notes for ${it.company}` });
    notes.addEventListener('change', () => patch(it, { notes: notes.value }));

    const del = el('button', { className: 'danger', textContent: 'Delete', title: 'Delete this application' });
    del.addEventListener('click', async () => {
      if (!confirm(`Delete ${it.company} - ${it.role}?`)) return;
      try {
        await api('DELETE', `/applications/${encodeURIComponent(it.id)}`);
        items = items.filter((x) => x !== it);
        render();
      } catch (e) { error(e.message); }
    });

    const role = /^https:\/\//.test(it.url || '')
      ? el('a', { href: it.url, target: '_blank', rel: 'noopener noreferrer', textContent: it.role })
      : document.createTextNode(it.role);

    return el('tr', {},
      el('td', { textContent: it.company }),
      el('td', {}, role),
      el('td', { className: 'date', textContent: fmtDate(it.appliedAt) }),
      el('td', {}, status),
      el('td', {}, notes),
      el('td', {}, del));
  }

  function render() {
    const q = $('search').value.trim().toLowerCase();
    const f = $('filter').value;
    const shown = items.filter((i) => (!f || i.status === f) &&
      (!q || `${i.company} ${i.role}`.toLowerCase().includes(q)));
    $('rows').replaceChildren(...shown.map(row));
    $('empty').hidden = shown.length > 0;
    $('more').hidden = !cursor;
    renderStats();
  }

  async function loadApplications(more = false) {
    const qs = new URLSearchParams({ limit: '100', ...(more && cursor ? { cursor } : {}) });
    const page = await api('GET', `/applications?${qs}`);
    items = more ? items.concat(page.items) : page.items;
    cursor = page.cursor || null;
    render();
  }

  async function loadProfile() {
    const body = $('profileBody');
    try {
      const p = await api('GET', '/profiles/default');
      const d = p.data || {};
      const pi = d.personalInfo || {};
      const n = (a) => (Array.isArray(a) ? a.length : 0);
      body.className = '';
      body.replaceChildren(el('dl', {},
        el('dt', { textContent: 'Name' }), el('dd', { textContent: [pi.firstName, pi.lastName].filter(Boolean).join(' ') || '-' }),
        el('dt', { textContent: 'Jobs' }), el('dd', { textContent: String(n(d.workExperience)) }),
        el('dt', { textContent: 'Schools' }), el('dd', { textContent: String(n(d.education)) }),
        el('dt', { textContent: 'Skills' }), el('dd', { textContent: String(n(d.skills)) }),
        el('dt', { textContent: 'Last synced' }), el('dd', { textContent: fmtDate(p.updatedAt) || '-' })),
        el('p', { className: 'muted', textContent: 'Edit your profile in the extension side panel.' }));
    } catch (e) {
      body.textContent = e.status === 404 ? 'Profile sync is off. Turn it on in the extension under Settings.' : e.message;
    }
  }

  async function start() {
    CFG = await (await fetch('/config.json', { cache: 'no-store' })).json();
    $('filter').append(...STATUSES.map((s) => el('option', { value: s, textContent: label(s) })));
    $('signin').addEventListener('click', () => signIn().catch((e) => error(e.message)));
    $('signout').addEventListener('click', signOut);
    $('search').addEventListener('input', render);
    $('filter').addEventListener('change', render);
    $('more').addEventListener('click', () => loadApplications(true).catch((e) => error(e.message)));

    if (location.pathname === '/auth/callback') await finishCallback();
    if (!(await accessToken())) return show('signedout');

    const t = JSON.parse(sessionStorage.getItem(TOKENS));
    $('who').textContent = claims(t.id).email || '';
    show('app');
    await Promise.all([loadApplications(), loadProfile()]);
  }

  start().catch((e) => { if (e.message !== 'Signed out') error(e.message); });
})();
