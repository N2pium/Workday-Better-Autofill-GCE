// Anonymous fill-failure telemetry (cloud-telemetry.js + the Settings toggle in popup.js).
// Usage: node tools/tests/test-telemetry.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const API = 'https://cfswo4fym6.execute-api.us-east-2.amazonaws.com';
const DUKE = 'https://dukeenergy.wd1.myworkdayjobs.com/en-US/search/job/Charlotte%2C-NC/Data-Analyst_R40863/apply';
const tick = (ms = 0) => new Promise((r) => setTimeout(r, ms));
const settle = async () => { for (let i = 0; i < 8; i++) await tick(5); };

function loadModule() {
  const ctx = { console, URL };
  ctx.self = ctx;
  vm.createContext(ctx);
  for (const f of ['cloud-config.js', 'cloud-telemetry.js']) vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx);
  return ctx.EasyApplyTelemetry;
}
const T = loadModule();
const plain = (v) => JSON.parse(JSON.stringify(v));

// A realistic report, shaped like content.js buildFillReport().
const REPORT = {
  build: '2026-11-24e',
  page: 'My Experience',
  path: '/en-US/search/job/Charlotte%2C-NC/Data-Analyst_R40863/apply/applyManually',
  at: '2026-11-24T15:00:00.000Z',
  counts: { filled: 3, failed: 3, skipped: 2, emptyRequired: 3, empty: 4 },
  steps: [
    { section: 'My Information', field: 'First name', status: 'filled', detail: '' },
    { section: 'Work Experience', field: 'Work experience', status: 'failed', detail: 'wrote "jobTitle" but the box did not keep it' },
    { section: 'Education', field: 'Education', status: 'failed', detail: 'no Add button for education 2' },
    { section: 'Websites', field: 'Website', status: 'skipped', detail: 'the field is here but nothing is saved for it in your profile' },
    { section: 'Languages', field: 'Language', status: 'failed', detail: '"Klingon" is not in the Language list' },
    // A profile question: its "field" is the question text. Must never be sent.
    { section: 'Application Questions', field: 'Have you ever worked for Jane Doe Holdings?', status: 'failed', detail: 'no matching option for Have you ever worked (options: Yes, No)' },
    // Self-ID steps are not in the allowlist.
    { section: 'Voluntary Disclosures', field: 'Gender', status: 'skipped', detail: 'the field is here but nothing is saved for it in your profile' },
    { section: 'Unknown Section', field: 'Work experience', status: 'failed', detail: 'x' }
  ],
  empty: [
    { kind: 'text', label: 'Job Title at Acme for Jane', field: 'jobTitle', required: true },
    { kind: 'picker', label: 'Degree', field: 'degree', required: true },
    { kind: 'dropdown', label: 'Some question', field: '3f2504e0-4f89-11d3-9a0c-0305e82c3301', required: true },
    { kind: 'text', label: 'Middle name', field: 'middleName', required: false },
    { kind: 'checkbox', label: 'I agree', field: '', required: true }
  ]
};

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('buildPayload keeps only allowlisted steps and ids, with reason codes and the host name', () => {
  const p = plain(T.buildPayload(REPORT, { tenant: DUKE }));
  assert.deepEqual(p, {
    v: 1, ats: 'workday', tenant: 'dukeenergy.wd1.myworkdayjobs.com', build: '2026-11-24e',
    events: [
      { type: 'step', section: 'Work Experience', field: 'Work experience', status: 'failed', reason: 'did_not_change' },
      { type: 'step', section: 'Education', field: 'Education', status: 'failed', reason: 'no_add_button' },
      { type: 'step', section: 'Websites', field: 'Website', status: 'skipped', reason: 'not_saved' },
      { type: 'step', section: 'Languages', field: 'Language', status: 'failed', reason: 'no_option' },
      { type: 'empty_required', fieldId: 'jobTitle', kind: 'text' },
      { type: 'empty_required', fieldId: 'degree', kind: 'dropdown' }
    ]
  });
});

test('no label, detail, value, page, path or free text ever reaches the payload', () => {
  const text = JSON.stringify(T.buildPayload(REPORT, { tenant: DUKE }));
  for (const bad of ['Jane', 'Acme', 'Klingon', 'Have you ever', 'box did not keep', 'My Experience', 'Charlotte',
    'Data-Analyst', 'applyManually', 'Gender', 'Unknown Section', '3f2504e0', 'Middle', 'label', 'detail', 'path', 'page', 'at"']) {
    assert.ok(!text.includes(bad), `"${bad}" must not be sent`);
  }
});

test('reason codes come from the detail text, never the text itself', () => {
  const cases = {
    'the field is here but nothing is saved for it in your profile': 'not_saved',
    'proficiency level is not in your profile (only answered for a native speaker)': 'not_saved',
    'Add did not open work experience 2.': 'no_add_button',
    'Add Language button not found': 'no_add_button',
    'clicked the disability answer but it did not change': 'did_not_change',
    'Selected Yes for State but it did not commit — field left as-is.': 'did_not_change',
    'chose an option for Country but the dropdown still shows "nothing"': 'did_not_change',
    'no matching disability option on this form': 'no_option',
    'Option Ohio not found for State': 'no_option',
    'No options appeared for Country': 'no_option',
    'no "LinkedIn" option under "How did you hear about us" (looked in: Social)': 'no_option',
    'typed the school but no suggestion was chosen': 'no_option',
    'Language dropdown button not found after waiting': 'not_found',
    'could not find a website URL input for https://x.dev': 'not_found',
    'the How did you hear about us menu did not open': 'not_found',
    'could not delete an extra, empty work experience entry Workday added': 'other',
    '': 'other'
  };
  for (const [detail, code] of Object.entries(cases)) assert.equal(T.reasonFor(detail), code, detail);
});

test('tenant must be a Workday or Greenhouse host; anything else sends nothing', () => {
  assert.equal(T.buildPayload(REPORT, { tenant: 'https://evil.example.com/apply' }), null);
  assert.equal(T.buildPayload(REPORT, { tenant: 'https://myworkdayjobs.com.evil.io/x' }), null);
  assert.equal(T.buildPayload(REPORT, {}), null);
  assert.equal(T.buildPayload(REPORT, { tenant: 'hub.wd1.myworkdayjobs.com' }).tenant, 'hub.wd1.myworkdayjobs.com');
  const gh = T.buildPayload(REPORT, { tenant: 'https://job-boards.greenhouse.io/acme/jobs/123?gh_src=x' });
  assert.equal(gh.ats, 'greenhouse');
  assert.equal(gh.tenant, 'job-boards.greenhouse.io');
});

test('returns null when there is nothing to report, or the report is malformed', () => {
  const clean = { ...REPORT, steps: [REPORT.steps[0]], empty: [REPORT.empty[3]] };
  assert.equal(T.buildPayload(clean, { tenant: DUKE }), null);
  assert.equal(T.buildPayload(null, { tenant: DUKE }), null);
  assert.equal(T.buildPayload({ ...REPORT, build: 'Jane Doe' }, { tenant: DUKE }), null);
});

test('adds the adapter pack version when known; caps at 50 events and dedupes', () => {
  assert.equal(T.buildPayload({ ...REPORT, pack: 3 }, { tenant: DUKE }).pack, 3);
  assert.equal(T.buildPayload({ ...REPORT, pack: { version: 4, ats: 'workday' } }, { tenant: DUKE }).pack, 4);
  assert.equal(T.buildPayload(REPORT, { tenant: DUKE, packVersion: 7 }).pack, 7);
  assert.equal('pack' in T.buildPayload({ ...REPORT, pack: 'x' }, { tenant: DUKE }), false);
  const many = { ...REPORT, steps: [], empty: Array.from({ length: 80 }, (_, i) => ({ kind: 'text', field: `field${i}`, required: true })) };
  assert.equal(T.buildPayload(many, { tenant: DUKE }).events.length, 50);
  const dup = { ...REPORT, steps: [REPORT.steps[1], REPORT.steps[1]], empty: [] };
  assert.equal(T.buildPayload(dup, { tenant: DUKE }).events.length, 1);
  assert.ok(JSON.stringify(T.buildPayload(many, { tenant: DUKE })).length <= 8192);
});

test('send posts to /telemetry with no token, cookie or referrer', async () => {
  const calls = [];
  const ok = await T.send({ v: 1 }, { fetchImpl: async (url, init) => { calls.push({ url, init }); return { ok: true, status: 202 }; } });
  assert.equal(ok, true);
  assert.equal(calls[0].url, `${API}/telemetry`);
  assert.equal(calls[0].init.method, 'POST');
  assert.deepEqual(plain(calls[0].init.headers), { 'content-type': 'application/json' });
  assert.equal(calls[0].init.credentials, 'omit');
  assert.equal(calls[0].init.referrerPolicy, 'no-referrer');
  assert.equal(await T.send({ v: 1 }, { fetchImpl: async () => { throw new Error('offline'); } }), false, 'never throws');
});

test('the allowlist covers only real content.js step names and sections', () => {
  const src = fs.readFileSync(path.join(ROOT, 'content.js'), 'utf8');
  const names = new Set([...src.matchAll(/step\('([^']+)'/g)].map((m) => m[1]));
  const sections = new Set([...src.matchAll(/traceSection = '([^']+)'/g)].map((m) => m[1]));
  for (const [section, fields] of Object.entries(T.STEPS)) {
    assert.ok(sections.has(section), `section "${section}" is set in content.js`);
    for (const f of fields) assert.ok(names.has(f), `step "${f}" exists in content.js`);
  }
  for (const selfId of ['Gender', 'Hispanic or Latino', 'Race / ethnicity', 'Veteran status', 'Disability']) {
    assert.ok(!Object.values(T.STEPS).flat().includes(selfId), `${selfId} is never reported`);
  }
});

// ---------------------------------------------------------------- side panel
async function openPanel({ local = {}, signedIn = false, grant = true } = {}) {
  const html = fs.readFileSync(path.join(ROOT, 'popup.html'), 'utf8').replace(/<script[^>]*><\/script>/g, '');
  const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://panel.test/popup.html' });
  const w = dom.window;
  const stores = { local: new Map(Object.entries(structuredClone(local))), session: new Map() };
  if (signedIn) {
    const b = (o) => Buffer.from(JSON.stringify(o)).toString('base64url');
    stores.local.set('cloudAuth', { refreshToken: 'r', email: 'ada@example.com', sub: 'u1' });
    stores.local.set('cloudChoice', 'signedin');
    stores.session.set('cloudSession', { accessToken: 'secret-access-token', idToken: `${b({})}.${b({ email: 'ada@example.com' })}.x`, expiresAt: Date.now() + 3600e3 });
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
  const permissionRequests = [];
  w.chrome = {
    runtime: { onMessage: { addListener: (f) => listeners.message.push(f) }, lastError: null, sendMessage() {} },
    storage: { local: area(stores.local), session: area(stores.session), onChanged: { addListener() {} } },
    tabs: {
      query(_q, cb) { const t = [{ id: 1, active: true, url: DUKE }]; if (cb) setTimeout(() => cb(t)); return Promise.resolve(t); },
      sendMessage(_id, _m, cb) { if (cb) setTimeout(() => cb({ ok: true })); },
      onActivated: evt(), onUpdated: evt()
    },
    permissions: {
      contains(_o, cb) { if (cb) setTimeout(() => cb(true)); return Promise.resolve(true); },
      request: (o) => { permissionRequests.push(o); return Promise.resolve(grant); },
      remove: (_o, cb) => cb && cb(true)
    },
    identity: { getRedirectURL: () => 'https://test.chromiumapp.org/', launchWebAuthFlow: () => Promise.reject(new Error('n/a')) }
  };
  const calls = [];
  w.fetch = async (input, init = {}) => {
    const u = new URL(String(input));
    calls.push({ method: init.method || 'GET', path: u.pathname, headers: init.headers || {}, body: init.body ? JSON.parse(init.body) : undefined });
    const res = (status, data) => ({ ok: status < 300, status, text: async () => (data === undefined ? '' : JSON.stringify(data)), json: async () => data });
    if (u.pathname === '/telemetry') return res(202, { accepted: 1 });
    if (u.pathname === '/profiles' || u.pathname === '/applications') return res(200, { items: [] });
    return res(404, { error: 'not found' });
  };
  w.confirm = () => true;
  w.HTMLElement.prototype.scrollIntoView = () => {};
  for (const f of ['cloud-config.js', 'cloud-auth.js', 'cloud-sync.js', 'cloud-tracker.js', 'cloud-telemetry.js', 'popup.js']) {
    w.eval(fs.readFileSync(path.join(ROOT, f), 'utf8'));
  }
  await settle();
  const $ = (sel) => w.document.querySelector(sel);
  const send = (msg) => listeners.message.forEach((f) => f(msg, { tab: { id: 1, url: DUKE } }));
  const telemetryCalls = () => calls.filter((c) => c.path === '/telemetry');
  const toggle = async (on) => {
    $('#telemetryToggle').checked = on;
    $('#telemetryToggle').dispatchEvent(new w.Event('change'));
    await settle();
  };
  return { w, $, stores, calls, send, telemetryCalls, toggle, permissionRequests };
}

const FILL = { action: 'fill_complete', report: REPORT, job: { site: 'workday', url: DUKE, title: 'Data Analyst', company: 'Duke Energy' } };

test('the Settings toggle exists, explains what is sent, and is OFF by default', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest' } });
  assert.ok(p.$('#tab-settings #telemetryToggle'));
  assert.equal(p.$('#telemetryToggle').checked, false);
  assert.match(p.$('label[for="telemetryToggle"]').textContent, /Send anonymous fill-failure reports/);
  assert.match(p.$('#telemetryHelp').textContent, /Never sent/);
  assert.equal(p.stores.local.has('telemetryOptIn'), false);
});

test('nothing is sent while the toggle is off', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest' } });
  p.send(FILL);
  await settle();
  assert.equal(p.telemetryCalls().length, 0);
});

test('turning it on asks for the API host only; then one report is sent once, without a token', async () => {
  const p = await openPanel({ signedIn: true });
  await p.toggle(true);
  assert.deepEqual(plain(p.permissionRequests), [{ origins: [`${API}/*`] }]);
  assert.equal(p.stores.local.get('telemetryOptIn'), true);

  p.send(FILL);
  p.send(FILL); // the same report again (e.g. a duplicate message)
  await settle();
  const sent = p.telemetryCalls();
  assert.equal(sent.length, 1, 'at most once per report');
  assert.equal(sent[0].method, 'POST');
  assert.deepEqual(plain(sent[0].headers), { 'content-type': 'application/json' }, 'no Authorization header');
  assert.equal(sent[0].body.tenant, 'dukeenergy.wd1.myworkdayjobs.com');
  assert.ok(!JSON.stringify(sent[0]).includes('secret-access-token'));
  assert.ok(!JSON.stringify(sent[0].body).includes('Duke Energy'), 'job info stays out');

  p.send({ ...FILL, report: { ...REPORT, at: '2026-11-24T15:05:00.000Z' } });
  await settle();
  assert.equal(p.telemetryCalls().length, 2, 'a new report is sent');
});

test('declining the Chrome permission turns the toggle back off and sends nothing', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest' }, grant: false });
  await p.toggle(true);
  assert.equal(p.$('#telemetryToggle').checked, false);
  assert.equal(p.stores.local.get('telemetryOptIn'), false);
  p.send(FILL);
  await settle();
  assert.equal(p.telemetryCalls().length, 0);
});

test('works for guests, remembers the choice, and can be turned off again', async () => {
  const p = await openPanel({ local: { cloudChoice: 'guest', telemetryOptIn: true } });
  assert.equal(p.$('#telemetryToggle').checked, true);
  p.send(FILL);
  await settle();
  assert.equal(p.telemetryCalls().length, 1);
  await p.toggle(false);
  assert.equal(p.stores.local.get('telemetryOptIn'), false);
  p.send({ ...FILL, report: { ...REPORT, at: '2026-11-24T16:00:00.000Z' } });
  await settle();
  assert.equal(p.telemetryCalls().length, 1);
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
