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


  // ------------------------------------------------------------ flow chart
  // Sankey of the whole pipeline from GET /insights `funnel`: one group per
  // industry, company or role family, then Applied -> OA / Screen -> Technical
  // round -> Offer, with each stage's exits (no response, rejected, ...).
  // Hand-drawn SVG: the CSP allows no third-party code. SVG presentation
  // attributes (fill, d) are attributes, not inline styles, so the CSP allows them.
  const SVGNS = 'http://www.w3.org/2000/svg';
  const svg = (tag, attrs = {}, ...kids) => {
    const n = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, String(v));
    n.append(...kids.filter(Boolean));
    return n;
  };
  // Categorical slots, dark steps, validated on the card surface #2d2a27
  // (dataviz validate_palette: all checks pass). Fixed order, never cycled;
  // "Other"/"Unspecified" are neutral, not a hue.
  const SERIES = ['#3987e5', '#d95926', '#199e70', '#c98500', '#d55181', '#0ca30c', '#9085e9'];
  const NEUTRAL = '#7d746d';
  const STAGE_FILL = '#a29790';
  const FLOW_DIMS = [['industry', 'Industry'], ['company', 'Company'], ['role', 'Role']];
  const STAGES = ['applied', 'screening', 'interview', 'offer'];
  const STAGE_NAME = { applied: 'Applied', screening: 'OA / Screen', interview: 'Technical round', offer: 'Offer' };
  const EXIT_ORDER = ['In progress', 'No response', 'Rejected', 'Withdrawn'];
  let flowDim = sessionStorage.getItem('ba.flowDim') || 'industry';
  let lastInsights = null;

  /** Where an application leaves stage `s`, or null when it moves on to the next stage. */
  function exitLabel(stage, path) {
    if (STAGES.indexOf(path.reached) > STAGES.indexOf(stage)) return null;
    if (path.outcome === 'rejected') return 'Rejected';
    if (path.outcome === 'withdrawn') return 'Withdrawn';
    if (path.outcome === 'ghosted') return 'No response';
    return stage === 'applied' ? 'No response' : 'In progress';
  }

  /** Nodes per column and group-split links, from the funnel groups. */
  function buildFlow(groups) {
    const cols = [[], [], [], [], []];
    const nodes = new Map();
    const node = (col, name, color) => {
      const id = `${col}:${name}`;
      if (!nodes.has(id)) { const n = { id, col, name, color, value: 0, inV: 0, outV: 0 }; nodes.set(id, n); cols[col].push(n); }
      return nodes.get(id);
    };
    const links = new Map();
    const link = (a, b, g, v) => {
      const k = `${a.id}>${b.id}>${g.i}`;
      const l = links.get(k) || { source: a, target: b, group: g, value: 0 };
      l.value += v; links.set(k, l);
    };
    groups.forEach((g) => node(0, g.name, g.color));
    for (const g of groups) {
      const src = nodes.get(`0:${g.name}`);
      for (const p of g.paths || []) {
        const n = num(p.count);
        if (!n) continue;
        src.value += n;
        let prev = node(1, STAGE_NAME.applied, STAGE_FILL);
        link(src, prev, g, n);
        for (let s = 0; s < 3; s++) {
          const stage = STAGES[s];
          const exit = exitLabel(stage, p);
          const next = exit ? node(s + 2, exit, STAGE_FILL) : node(s + 2, STAGE_NAME[STAGES[s + 1]], STAGE_FILL);
          link(prev, next, g, n);
          if (exit || s === 2) break;
          prev = next;
        }
      }
    }
    for (const l of links.values()) { l.source.outV += l.value; l.target.inV += l.value; }
    for (const n of nodes.values()) if (n.col > 0) n.value = Math.max(n.inV, n.outV);
    // Moving-on node on top, exits below, so the main flow stays straight.
    const rank = (n) => (Object.values(STAGE_NAME).includes(n.name) ? -1 : EXIT_ORDER.indexOf(n.name));
    for (let c = 1; c < cols.length; c++) cols[c].sort((a, b) => rank(a) - rank(b));
    return { cols, links: [...links.values()] };
  }

  function flowTotals(groups) {
    const t = { applied: 0, noResponse: 0, screen: 0, rejected: 0, technical: 0, offer: 0 };
    for (const g of groups) for (const p of g.paths || []) {
      const n = num(p.count); const r = STAGES.indexOf(p.reached);
      t.applied += n;
      if (r >= 1) t.screen += n;
      if (r >= 2) t.technical += n;
      if (r >= 3) t.offer += n;
      if (p.outcome === 'rejected') t.rejected += n;
      if (p.outcome === 'ghosted' || (p.outcome === 'active' && r === 0)) t.noResponse += n;
    }
    return t;
  }

  function sankeySvg(flow, total) {
    const W = 1000, NODE = 12, GAP = 14, TOP = 8;
    const LEFT = 170, RIGHT = 150;
    const maxNodes = Math.max(...flow.cols.map((c) => c.length));
    const H = Math.max(260, maxNodes * 34 + TOP * 2);
    const k = (H - TOP * 2 - GAP * (maxNodes - 1)) / Math.max(1, total);
    const step = (W - LEFT - RIGHT - NODE) / (flow.cols.length - 1);
    flow.cols.forEach((col, c) => {
      let y = TOP;
      for (const n of col) {
        n.x = LEFT + c * step; n.y = y; n.h = Math.max(2, n.value * k); n.sy = n.y; n.ty = n.y;
        y += n.h + GAP;
      }
    });
    const order = (a, b) => a.y - b.y;
    const out = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'sankey', role: 'img', 'aria-label': 'Flow of applications through each stage' });
    const ribbons = svg('g', { class: 'ribbons' });
    // Outgoing ribbons stack in target order, incoming in source order; groups keep their order inside each.
    const sorted = flow.links.slice().sort((a, b) => order(a.target, b.target) || a.group.i - b.group.i);
    for (const l of sorted) { l.h = l.value * k; l.y0 = l.source.sy; l.source.sy += l.h; }
    flow.links.slice().sort((a, b) => order(a.source, b.source) || a.group.i - b.group.i)
      .forEach((l) => { l.y1 = l.target.ty; l.target.ty += l.h; });
    for (const l of sorted) {
      const x0 = l.source.x + NODE, x1 = l.target.x, xm = (x0 + x1) / 2;
      const d = `M${x0},${l.y0}C${xm},${l.y0} ${xm},${l.y1} ${x1},${l.y1}L${x1},${l.y1 + l.h}C${xm},${l.y1 + l.h} ${xm},${l.y0 + l.h} ${x0},${l.y0 + l.h}Z`;
      ribbons.append(svg('path', { d, fill: l.group.color, class: 'ribbon' },
        svg('title', {}, document.createTextNode(`${l.group.name}: ${l.source.name} → ${l.target.name}, ${plural(l.value, 'application', 'applications')}`))));
    }
    out.append(ribbons);
    for (const col of flow.cols) for (const n of col) {
      const g = svg('g', { class: 'snode' });
      g.append(svg('rect', { x: n.x, y: n.y, width: NODE, height: n.h, rx: 2, fill: n.color },
        svg('title', {}, document.createTextNode(`${n.name}: ${n.value}`))));
      const left = n.col === 0;
      const t = svg('text', { x: left ? n.x - 8 : n.x + NODE + 8, y: n.y + n.h / 2, 'text-anchor': left ? 'end' : 'start', 'dominant-baseline': 'middle', class: 'slabel-svg' });
      t.append(svg('tspan', {}, document.createTextNode(n.name.length > 22 ? `${n.name.slice(0, 21)}…` : n.name)),
        svg('tspan', { class: 'svalue', dx: 6 }, document.createTextNode(String(n.value))));
      g.append(t);
      out.append(g);
    }
    return out;
  }

  function flowTable(groups) {
    const heads = ['Applied', 'OA / Screen', 'Technical round', 'Offer', 'Rejected', 'No response'];
    return el('table', { className: 'sr-only' },
      el('caption', { textContent: `Applications by ${flowDim} and stage` }),
      el('thead', {}, el('tr', {}, el('th', { scope: 'col', textContent: label(flowDim) }), ...heads.map((h) => el('th', { scope: 'col', textContent: h })))),
      el('tbody', {}, ...groups.map((g) => {
        const t = flowTotals([g]);
        return el('tr', {}, el('th', { scope: 'row', textContent: g.name }),
          ...[t.applied, t.screen, t.technical, t.offer, t.rejected, t.noResponse].map((v) => el('td', { textContent: String(v) })));
      })));
  }

  function renderFlow(data = lastInsights) {
    const root = $('flowBody');
    if (!root) return;
    const funnel = data && data.funnel;
    const raw = funnel && Array.isArray(funnel[flowDim]) ? funnel[flowDim] : null;
    $('flow').hidden = !raw;
    if (!raw) return;
    for (const b of document.querySelectorAll('#flowDims button')) b.setAttribute('aria-pressed', String(b.dataset.dim === flowDim));
    let slot = 0;
    const groups = raw.map((g, i) => ({
      ...g, i,
      color: /^(other|unspecified|unknown company|other roles)$/i.test(g.name) ? NEUTRAL : SERIES[slot++] || NEUTRAL,
    }));
    const t = flowTotals(groups);
    if (!t.applied) {
      root.replaceChildren(el('p', { className: 'muted center', textContent: 'No applications yet — the flow appears once you track one.' }));
      return;
    }
    const summary = el('p', { className: 'flow-summary' }, ...[
      ['Total applied', t.applied], ['No response', t.noResponse], ['OA / Screen', t.screen],
      ['Rejected', t.rejected], ['Technical round', t.technical], ['Offer', t.offer],
    ].map(([k, v]) => el('span', {}, el('b', { textContent: String(v) }), document.createTextNode(` ${k}`))));
    const legend = groups.length > 1 ? el('ul', { className: 'flow-legend' }, ...groups.map((g) => {
      const chip = el('span', { className: 'chip' }); chip.style.background = g.color;
      return el('li', {}, chip, document.createTextNode(`${g.name} ${g.total}`));
    })) : null;
    const hint = flowDim === 'industry' && groups.length === 1 && /unspecified/i.test(groups[0].name)
      ? el('p', { className: 'muted small', textContent: 'Set an industry on your applications below to split this by industry.' }) : null;
    const wrap = el('div', { className: 'sankey-wrap' }, sankeySvg(buildFlow(groups), t.applied));
    root.replaceChildren(summary, ...[legend, hint].filter(Boolean), wrap, flowTable(groups));
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
      lastInsights = data;
      renderFlow(data);
      insightsLoaded = true;
    } catch (e) {
      if (seq !== insightsSeq || e.message === 'Signed out') return;
      root.setAttribute('aria-busy', 'false');
      // Keep the last good numbers on a failed refresh; only replace the loading text.
      if (!insightsLoaded) root.replaceChildren(el('p', { className: 'muted', textContent: `Insights could not be loaded: ${e.message}` }));
      if (!insightsLoaded) $('flowBody').replaceChildren(el('p', { className: 'muted', textContent: `The flow could not be loaded: ${e.message}` }));
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
      if ('status' in fields || 'industry' in fields) refreshInsights();
      error('');
    } catch (e) { error(e.message); }
  }

  function row(it) {
    const status = el('select', { 'aria-label': `Status for ${it.company}` },
      ...STATUSES.map((s) => el('option', { value: s, textContent: label(s), selected: s === it.status })));
    status.addEventListener('change', () => patch(it, { status: status.value }));

    const industry = el('input', { value: it.industry || '', maxLength: 60, placeholder: 'Add', className: 'industry' });
    industry.setAttribute('list', 'industryList');
    industry.setAttribute('aria-label', `Industry for ${it.company}`);
    industry.addEventListener('change', () => patch(it, { industry: industry.value.trim() }));

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
      el('td', {}, industry),
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
    for (const b of document.querySelectorAll('#flowDims button')) {
      b.addEventListener('click', () => { flowDim = b.dataset.dim; sessionStorage.setItem('ba.flowDim', flowDim); renderFlow(); });
    }
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
