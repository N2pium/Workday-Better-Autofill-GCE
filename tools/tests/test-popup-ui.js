// Loads the real popup.html + scripts into jsdom with a fake `chrome` and API,
// and clicks through the side panel.  Usage: node tools/tests/test-popup-ui.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const SCRIPTS = ['cloud-config.js', 'cloud-auth.js', 'cloud-sync.js', 'cloud-tracker.js', 'popup.js'];
const DUKE = 'https://dukeenergy.wd1.myworkdayjobs.com/en-US/search/job/Charlotte%2C-NC/Data-Analyst_R40863/apply';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(5); };

function fakeJwt(claims) {
  const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
  return `${b({ alg: 'none' })}.${b(claims)}.x`;
}

async function openPanel({ local = {}, signedIn = false, apps = [], activeUrl = DUKE } = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://panel.test/popup.html' });
  const w = dom.window;

  const stores = { local: new Map(Object.entries(structuredClone(local))), session: new Map() };
  if (signedIn) {
    stores.local.set('cloudAuth', { refreshToken: 'r', email: 'ada@example.com', sub: 'u1' });
    stores.session.set('cloudSession', { accessToken: 'a', idToken: fakeJwt({ email: 'ada@example.com' }), expiresAt: Date.now() + 3600e3 });
    if (!('cloudChoice' in local)) stores.local.set('cloudChoice', 'signedin');
  }
  const area = (m) => ({
    get(keys, cb) {
      const out = {};
      const list = keys === null ? [...m.keys()] : [].concat(keys);
      for (const k of list) if (m.has(k)) out[k] = structuredClone(m.get(k));
      if (cb) setTimeout(() => cb(out)); return Promise.resolve(out);
    },
    set(obj, cb) { for (const [k, v] of Object.entries(obj)) m.set(k, structuredClone(v)); if (cb) setTimeout(cb); return Promise.resolve(); },
    remove(keys, cb) { for (const k of [].concat(keys)) m.delete(k); if (cb) setTimeout(cb); return Promise.resolve(); },
    clear(cb) { m.clear(); if (cb) setTimeout(cb); return Promise.resolve(); }
  });
  const listeners = { message: [] };
  const evt = () => ({ addListener() {} });
  w.chrome = {
    runtime: { onMessage: { addListener: (f) => listeners.message.push(f) }, lastError: null, sendMessage() {} },
    storage: { local: area(stores.local), session: area(stores.session), onChanged: { addListener() {} } },
    tabs: {
      query(_q, cb) { const t = [{ id: 1, active: true, url: activeUrl }]; if (cb) setTimeout(() => cb(t)); return Promise.resolve(t); },
      sendMessage(_id, _m, cb) { if (cb) setTimeout(() => cb({ ok: true })); },
      onActivated: evt(), onUpdated: evt()
    },
    permissions: { contains(_o, cb) { const r = true; if (cb) setTimeout(() => cb(r)); return Promise.resolve(r); }, request: () => Promise.resolve(true), remove: (_o, cb) => cb && cb(true) },
    identity: { getRedirectURL: () => 'https://test.chromiumapp.org/', launchWebAuthFlow: () => Promise.reject(new Error('n/a')) }
  };

  const api = { calls: [], apps: structuredClone(apps), parsed: null };
  w.fetch = async (input, init = {}) => {
    const u = new URL(String(input));
    const body = init.body ? JSON.parse(init.body) : undefined;
    api.calls.push({ method: init.method || 'GET', path: u.pathname + u.search, body });
    const res = (status, data) => ({ ok: status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)), json: async () => data });
    if (u.pathname === '/profiles') return res(200, { items: [] });
    if (u.pathname === '/applications' && (init.method || 'GET') === 'GET') return res(200, { items: api.apps });
    if (u.pathname === '/applications' && init.method === 'POST') return res(201, { id: '20261122T120000Z-0000abcd', ...body, appliedAt: '2026-11-22T12:00:00Z' });
    if (u.pathname.startsWith('/applications/')) return res(init.method === 'DELETE' ? 204 : 200, init.method === 'DELETE' ? undefined : { ...body });
    if (u.pathname === '/resumes/parse') return res(200, { profile: api.parsed });
    return res(404, { error: 'not found' });
  };
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};

  for (const f of SCRIPTS) w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  // jsdom fires DOMContentLoaded itself, after this synchronous setup, exactly once (like Chrome).
  await settle();
  const $ = (sel) => w.document.querySelector(sel);
  const visibleTab = () => [...w.document.querySelectorAll('.tab-panel')].filter((p) => !p.hidden).map((p) => p.id);
  const send = (msg) => listeners.message.forEach((f) => f(msg));
  return { w, $, stores, api, visibleTab, send };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('first run shows only the welcome screen; guest goes to Home and is remembered', async () => {
  const p = await openPanel();
  assert.equal(p.$('#welcome').hidden, false);
  assert.ok(p.w.document.body.classList.contains('show-welcome'));
  p.$('#welcomeGuestBtn').click();
  await settle();
  assert.equal(p.$('#welcome').hidden, true);
  assert.deepEqual(p.visibleTab(), ['tab-home']);
  assert.equal(p.stores.local.get('cloudChoice'), 'guest');
  const again = await openPanel({ local: { cloudChoice: 'guest' } });
  assert.equal(again.$('#welcome').hidden, true, 'not shown again');
});

test('tabs switch panels and mark the current one', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest' } });
  for (const name of ['profile', 'apps', 'settings', 'home']) {
    p.$(`.tab[data-tab="${name}"]`).click();
    await settle();
    assert.deepEqual(p.visibleTab(), [`tab-${name}`]);
    assert.equal(p.$(`.tab[data-tab="${name}"]`).getAttribute('aria-current'), 'page');
  }
  p.$('[data-goto="profile"]').click();
  assert.deepEqual(p.visibleTab(), ['tab-profile']);
});

test('every field autofill reads still exists inside the profile form', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest' } });
  for (const id of ['firstName', 'lastName', 'email', 'phone', 'street', 'city', 'state', 'zip', 'country', 'skills',
    'languageInput', 'gender', 'race', 'hispanicLatino', 'isAtLeast18', 'authorizedToWork', 'requiresSponsorship',
    'sourceReferral', 'autoDisclosures', 'resume', 'education-container', 'work-container', 'saveBtn']) {
    assert.ok(p.$(`#profileForm #${id}`), `#${id} inside the form`);
  }
  for (const id of ['cloudSignInBtn', 'greenhouseToggle', 'exportBtn', 'importBtn', 'deleteBtn']) {
    assert.ok(p.$(`#tab-settings #${id}`), `#${id} in Settings`);
  }
  assert.ok(p.$('#tab-home #autofillBtn'));
});

test('Home shows the job on the current page and the saved profile', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest', personalInfo: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' }, workExperience: [{}, {}] } });
  assert.equal(p.$('#jobCompany').textContent, 'Dukeenergy');
  assert.equal(p.$('#jobRole').textContent, 'Data Analyst');
  assert.equal(p.$('#homeProfileName').textContent, 'Ada Lovelace');
  assert.match(p.$('#homeProfileStats').textContent, /2 jobs/);
});

test('Applications lists tracked jobs as text (page content is never rendered as HTML)', async () => {
  const evil = '<img src=x onerror="window.pwned=1">';
  const p = await openPanel({ signedIn: true, apps: [
    { id: '20261122T120000Z-00000001', company: evil, role: 'Analyst', url: 'https://a.myworkdayjobs.com/x', status: 'interview', appliedAt: '2026-11-20T00:00:00Z' }
  ] });
  p.$('.tab[data-tab="apps"]').click();
  await settle();
  const item = p.$('#appsList .app-item');
  assert.ok(item, 'listed');
  assert.equal(item.querySelector('.app-company').textContent, evil);
  assert.equal(p.$('#appsList img'), null, 'no element injected');
  assert.equal(item.querySelector('select').value, 'interview');
  assert.equal(item.querySelector('a').getAttribute('href'), 'https://a.myworkdayjobs.com/x');
  item.querySelector('select').value = 'offer';
  item.querySelector('select').dispatchEvent(new p.w.Event('change'));
  await settle();
  assert.deepEqual(p.api.calls.at(-1), { method: 'PATCH', path: '/applications/20261122T120000Z-00000001', body: { status: 'offer' } });
});

test('signed in, Applications links to the dashboard application flow', async () => {
  const p = await openPanel({ signedIn: true });
  p.$('.tab[data-tab="apps"]').click();
  await settle();
  const link = p.$('#appsDashboard');
  assert.equal(link.hidden, false);
  assert.equal(link.getAttribute('href'), 'https://d3sun3zkns70tc.cloudfront.net/');
  assert.equal(link.getAttribute('target'), '_blank');
  assert.match(link.getAttribute('rel'), /noopener/);
});

test('signed out, Applications explains how to start tracking', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest' } });
  p.$('.tab[data-tab="apps"]').click();
  await settle();
  assert.equal(p.$('#appsSignedOut').hidden, false);
  assert.equal(p.$('#appsDashboard').hidden, true, 'no dashboard link for guests');
  assert.equal(p.api.calls.length, 0, 'no network calls for guests');
});

test('an autofill while signed in logs the job once and Undo removes it', async () => {
  const p = await openPanel({ signedIn: true });
  p.send({ action: 'fill_complete', job: { site: 'workday', url: DUKE, title: 'Data Analyst', company: 'Duke Energy' } });
  await settle();
  const post = p.api.calls.find((c) => c.method === 'POST');
  assert.deepEqual(post.body, { company: 'Duke Energy', role: 'Data Analyst', url: DUKE.replace('/apply', ''), site: 'workday', status: 'applied' });
  assert.match(p.$('#status').textContent, /Tracked: Duke Energy · Data Analyst/);
  p.send({ action: 'fill_complete', job: { site: 'workday', url: DUKE + '/step2', title: 'Data Analyst' } });
  await settle();
  assert.equal(p.api.calls.filter((c) => c.method === 'POST').length, 1, 'next page of the same form is not logged again');
  p.$('#status button').click();
  await settle();
  assert.ok(p.api.calls.some((c) => c.method === 'DELETE' && c.path === '/applications/20261122T120000Z-0000abcd'), 'Undo deletes it');
  assert.equal(p.stores.local.get('cloudTracked')['workday:dukeenergy.wd1.myworkdayjobs.com:r40863'], undefined, 'and forgets it');
});

test('two frames finishing at the same moment still log the job once', async () => {
  const p = await openPanel({ signedIn: true });
  const job = { site: 'workday', url: DUKE, title: 'Data Analyst', company: 'Duke Energy' };
  p.send({ action: 'fill_complete', job });
  p.send({ action: 'fill_complete', job });
  await settle();
  assert.equal(p.api.calls.filter((c) => c.method === 'POST').length, 1);
});

test('an autofill as a guest sends nothing', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest' } });
  p.send({ action: 'fill_complete', job: { site: 'workday', url: DUKE, title: 'Data Analyst' } });
  await settle();
  assert.equal(p.api.calls.length, 0);
});

test('resume import fills the form for review without saving, and keeps self-ID untouched', async () => {
  const p = await openPanel({ signedIn: true, local: {
    cloudChoice: 'signedin',
    personalInfo: { firstName: 'Old', phone: '555-0000' }, skills: ['Excel'],
    demographics: { gender: 'Female' }, jobPreferences: { requiresSponsorship: true }
  } });
  p.api.parsed = {
    personalInfo: { firstName: 'Jordan', lastName: 'Rivera', phone: '' },
    workExperience: [{ company: 'Acme', title: 'Data Analyst', isCurrentRole: true, startDate: { month: '06', year: '2022' } }],
    education: [{ school: 'Ohio State', degree: 'BS' }],
    skills: ['SQL', 'Excel']
  };
  p.$('.tab[data-tab="profile"]').click();
  const file = new p.w.File([Buffer.from('%PDF-1.4 test')], 'cv.pdf', { type: 'application/pdf' });
  Object.defineProperty(p.$('#resumeImportFile'), 'files', { value: [file], configurable: true });
  p.$('#resumeImportFile').dispatchEvent(new p.w.Event('change'));
  for (let i = 0; i < 20 && !p.api.calls.some((c) => c.path === '/resumes/parse'); i++) await tick(10);
  await settle();

  const parse = p.api.calls.find((c) => c.path === '/resumes/parse');
  assert.equal(parse.body.contentType, 'application/pdf');
  assert.equal(Buffer.from(parse.body.data, 'base64').toString(), '%PDF-1.4 test');
  assert.equal(p.$('#firstName').value, 'Jordan');
  assert.equal(p.$('#phone').value, '555-0000', 'blank parsed values keep what you had');
  assert.equal(p.$('#skills').value, 'Excel, SQL');
  assert.equal(p.w.document.querySelectorAll('#work-container .work-card').length, 1);
  assert.equal(p.$('.work-company').value, 'Acme');
  assert.equal(p.$('#gender').value, 'Female', 'self-ID untouched');
  assert.equal(p.$('#requiresSponsorship').checked, true, 'job preferences untouched');
  assert.equal(p.stores.local.get('personalInfo').firstName, 'Old', 'nothing saved until you press Save');
  assert.match(p.$('#resumeImportStatus').textContent, /Found 1 job, 1 school and 2 skills/);
});

test('resume import as a guest sends nothing and points to sign-in', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest' } });
  p.$('.tab[data-tab="profile"]').click();
  assert.equal(p.$('#resumeImportBtn').textContent, 'Sign in to fill from your resume');
  p.$('#resumeImportBtn').click();
  await settle();
  assert.deepEqual(p.visibleTab(), ['tab-settings']);
  assert.equal(p.api.calls.length, 0);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${String(e.stack || e).split('\n').slice(0, 4).join('\n       ')}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
