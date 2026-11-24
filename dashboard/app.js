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
    if (q.get('error')) {
      const msg = q.get('error_description') || q.get('error');
      // First Google sign-in after account linking can fail once; the retry works.
      // (cloud/src/functions/link). The flag stops a loop.
      if (/already found an entry for username/i.test(msg) && !sessionStorage.getItem('ba.retried')) {
        sessionStorage.setItem('ba.retried', '1');
        await signIn();
        return new Promise(() => {}); // navigating away
      }
      throw new Error(msg);
    }
    sessionStorage.removeItem('ba.retried');
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

  // ------------------------------------------------------------- insights
  // Counts come from GET /insights (all applications, server-side), not from
  // the pages loaded into the table. Bar sizes are set through element.style,
  // which the CSP (style-src 'self') allows; style="" attributes it would not.
  const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);
  const fmtWeek = (ymd) => {
    const d = new Date(`${ymd}T00:00:00Z`);
    return Number.isNaN(d.getTime()) ? String(ymd) : d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', timeZone: 'UTC' });
  };
  const fmtPct = (r) => (r === null || r === undefined || !Number.isFinite(Number(r)) ? '—' : `${Math.round(Number(r) * 100)}%`);
  const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

  function weeklyChart(weekly) {
    const max = Math.max(1, ...weekly.map((w) => num(w.count)));
    const total = weekly.reduce((a, w) => a + num(w.count), 0);
    const cols = weekly.map((w) => {
      const n = num(w.count);
      const bar = el('div', { className: 'wbar' });
      bar.style.height = `${(n / max) * 100}%`;
      return el('div', { className: 'wcol', title: `Week of ${fmtWeek(w.weekStart)}: ${plural(n, 'application', 'applications')}` },
        el('span', { className: 'wcount', textContent: n ? String(n) : '' }),
        el('div', { className: 'wtrack' }, bar),
        el('span', { className: 'wlabel', textContent: fmtWeek(w.weekStart) }));
    });
    const visual = el('div', { className: 'wchart' }, ...cols);
    visual.setAttribute('aria-hidden', 'true');

    const table = el('table', { className: 'sr-only' },
      el('caption', { textContent: 'Applications per week, last 12 weeks' }),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', textContent: 'Week of' }), el('th', { scope: 'col', textContent: 'Applications' }))),
      el('tbody', {}, ...weekly.map((w) => el('tr', {}, el('td', { textContent: fmtWeek(w.weekStart) }), el('td', { textContent: String(num(w.count)) })))));

    return el('figure', { className: 'card insight-chart' },
      el('figcaption', {},
        el('span', { textContent: 'Applications per week' }),
        el('span', { className: 'muted', textContent: `${plural(total, 'application', 'applications')} in the last ${weekly.length} weeks` })),
      visual, table);
  }

  function statusBreakdown(byStatus, total) {
    const max = Math.max(1, ...STATUSES.map((s) => num(byStatus[s])));
    return el('div', { className: 'card insight-status' },
      el('h3', { textContent: 'By status' }),
      el('ul', { className: 'sbars' }, ...STATUSES.map((s) => {
        const n = num(byStatus[s]);
        const fill = el('div', { className: `sfill s-${s}` });
        fill.style.width = `${(n / max) * 100}%`;
        const track = el('div', { className: 'strack' }, fill);
        track.setAttribute('aria-hidden', 'true');
        const pct = total ? ` (${Math.round((n / total) * 100)}%)` : '';
        return el('li', {},
          el('span', { className: 'slabel', textContent: label(s) }),
          track,
          el('span', { className: 'scount', textContent: String(n), title: `${label(s)}: ${n}${pct}` }));
      })));
  }

  // Pure: builds the Insights view for one GET /insights payload into `root`.
  function renderInsights(data, root = $('insightsBody'), meta = $('insightsMeta')) {
    const d = data || {};
    const byStatus = d.byStatus || {};
    const weekly = Array.isArray(d.weekly) ? d.weekly : [];
    const total = num(d.total);

    const tiles = [
      ['Total applications', String(total)],
      ['Response rate', fmtPct(d.responseRate)],
      ['Interviews', String(num(byStatus.interview))],
      ['Offers', String(num(byStatus.offer))],
    ];
    const kids = [el('div', { className: 'stats' }, ...tiles.map(([k, v]) =>
      el('div', { className: 'stat' }, el('b', { textContent: v }), el('span', { textContent: k }))))];

    if (d.truncated) {
      kids.push(el('p', { className: 'muted small note', textContent: 'Only your first 2,000 applications were counted, so these numbers may be lower than your real totals.' }));
    }
    if (total === 0) {
      kids.push(el('p', { className: 'card muted center', textContent: 'No applications yet — they\'ll show up here once you track one.' }));
    } else {
      kids.push(el('div', { className: 'insight-grid' }, weeklyChart(weekly), statusBreakdown(byStatus, total)));
    }
    root.replaceChildren(...kids);
    root.setAttribute('aria-busy', 'false');

    if (meta) {
      const at = d.generatedAt ? new Date(d.generatedAt) : null;
      meta.textContent = at && !Number.isNaN(at.getTime())
        ? `Updated ${at.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}` : '';
    }
  }

  let insightsSeq = 0;
  let insightsTimer = null;
  let insightsLoaded = false;

  async function loadInsights() {
    const seq = ++insightsSeq;
    const root = $('insightsBody');
    root.setAttribute('aria-busy', 'true');
    if (!insightsLoaded) root.replaceChildren(el('p', { className: 'muted', textContent: 'Loading insights...' }));
    try {
      const data = await api('GET', '/insights');
      if (seq !== insightsSeq) return; // a newer refresh is on its way
      renderInsights(data);
      insightsLoaded = true;
    } catch (e) {
      if (seq !== insightsSeq || e.message === 'Signed out') return;
      root.setAttribute('aria-busy', 'false');
      // Keep the last good numbers on a failed refresh; only replace the loading text.
      if (!insightsLoaded) root.replaceChildren(el('p', { className: 'muted', textContent: `Insights could not be loaded: ${e.message}` }));
    }
  }

  // Status changes can come in quick bursts from the table; refresh once.
  function refreshInsights() {
    clearTimeout(insightsTimer);
    insightsTimer = setTimeout(() => { loadInsights(); }, 400);
  }

  async function patch(it, fields) {
    try {
      Object.assign(it, await api('PATCH', `/applications/${encodeURIComponent(it.id)}`, fields));
      if ('status' in fields) refreshInsights();
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
        refreshInsights();
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
    await Promise.all([loadApplications(), loadProfile(), loadInsights()]);
  }

  start().catch((e) => { if (e.message !== 'Signed out') error(e.message); });
})();
