// Runs the real cloud-tracker.js against fake storage and a fake API.
// Usage: node tools/tests/test-cloud-tracker.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const plain = (v) => JSON.parse(JSON.stringify(v));
// The real URL from tools/captures/my-information.json
const DUKE = 'https://dukeenergy.wd1.myworkdayjobs.com/en-US/search/job/Charlotte%2C-NC/Asc-Cybersecurity-Gov-Risk-Analyst---Intern-Co-op-Conversion-2027--Souza-_R40863/apply';

function makeWorld({ signedIn = true } = {}) {
  const store = new Map();
  const chrome = {
    storage: {
      local: {
        async get(k) { return store.has(k) ? { [k]: structuredClone(store.get(k)) } : {}; },
        async set(o) { for (const [k, v] of Object.entries(o)) store.set(k, structuredClone(v)); },
        async remove(keys) { for (const k of [].concat(keys)) store.delete(k); }
      }
    }
  };
  const calls = [];
  let n = 0;
  const Cloud = {
    async status() { return { signedIn }; },
    async api(p, { method = 'GET', body } = {}) {
      calls.push({ p, method, body: body && structuredClone(body) });
      if (method === 'POST') return { id: `20261122T120000Z-0000000${++n}`, ...body };
      return {};
    }
  };
  const sandbox = { chrome, console, URL, URLSearchParams };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'cloud-tracker.js'), 'utf8'), sandbox, { filename: 'cloud-tracker.js' });
  return { T: sandbox.EasyApplyCloudTracker, Cloud, calls, store };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('Workday: page heading wins; link points at the posting, not the apply step', () => {
  const { T } = makeWorld();
  const job = plain(T.normalizeJob({ site: 'workday', url: DUKE, title: 'Asc Cybersecurity Gov Risk Analyst - Intern', company: 'Duke Energy' }));
  assert.deepEqual(job, {
    key: 'workday:dukeenergy.wd1.myworkdayjobs.com:r40863',
    site: 'workday',
    company: 'Duke Energy',
    role: 'Asc Cybersecurity Gov Risk Analyst - Intern',
    url: 'https://dukeenergy.wd1.myworkdayjobs.com/en-US/search/job/Charlotte%2C-NC/Asc-Cybersecurity-Gov-Risk-Analyst---Intern-Co-op-Conversion-2027--Souza-_R40863'
  });
});

test('Workday: falls back to the URL when the page has no heading or logo text', () => {
  const { T } = makeWorld();
  const job = T.normalizeJob({ url: DUKE, title: '', company: 'Logo' });
  assert.equal(job.company, 'Dukeenergy');
  assert.equal(job.role, 'Asc Cybersecurity Gov Risk Analyst – Intern Co op Conversion 2027 Souza');
});

test('Workday: every step of one application maps to the same key', () => {
  const { T } = makeWorld();
  const a = T.normalizeJob({ url: DUKE + '/autofillWithResume?source=x' });
  const b = T.normalizeJob({ url: DUKE + '/applyManually' });
  assert.equal(a.key, b.key);
});

test('Greenhouse: board URL and embedded form both work', () => {
  const { T } = makeWorld();
  const a = T.normalizeJob({ url: 'https://job-boards.greenhouse.io/acme/jobs/4012345?gh_src=x', title: 'Data Analyst', company: '' });
  assert.equal(a.key, 'greenhouse:acme:4012345');
  assert.equal(a.company, 'Acme');
  assert.equal(a.url, 'https://job-boards.greenhouse.io/acme/jobs/4012345');
  const b = T.normalizeJob({ url: 'https://boards.greenhouse.io/embed/job_app?for=globex-corp&token=777', title: 'Engineer' });
  assert.equal(b.key, 'greenhouse:globex-corp:777');
  assert.equal(b.company, 'Globex Corp');
});

test('pages that are not job postings are ignored', () => {
  const { T } = makeWorld();
  for (const url of ['https://dukeenergy.wd1.myworkdayjobs.com/en-US/search', 'https://example.com/jobs/1',
    'http://acme.wd1.myworkdayjobs.com/x/job/y_R1', 'not a url', '']) {
    assert.equal(T.normalizeJob({ url }), null, url);
  }
});

test('track logs once per posting and sends only job fields', async () => {
  const w = makeWorld();
  const first = await w.T.track(w.Cloud, { url: DUKE, title: 'Analyst', company: 'Duke Energy' });
  assert.equal(first.result, 'tracked');
  assert.deepEqual(plain(w.calls[0]), {
    p: '/applications', method: 'POST',
    body: { company: 'Duke Energy', role: 'Analyst', url: first.job.url, site: 'workday', status: 'applied' }
  });
  const again = await w.T.track(w.Cloud, { url: DUKE + '/autofillWithResume', title: 'Analyst', company: 'Duke Energy' });
  assert.equal(again.result, 'duplicate');
  assert.equal(w.calls.length, 1);
});

test('signed out: nothing is sent', async () => {
  const w = makeWorld({ signedIn: false });
  assert.equal((await w.T.track(w.Cloud, { url: DUKE })).result, 'signed-out');
  assert.equal(w.calls.length, 0);
});

test('undo deletes the record and lets the posting be logged again', async () => {
  const w = makeWorld();
  const t = await w.T.track(w.Cloud, { url: DUKE, title: 'Analyst' });
  await w.T.untrack(w.Cloud, t.job, t.application);
  assert.deepEqual(plain(w.calls.at(-1)), { p: `/applications/${t.application.id}`, method: 'DELETE' });
  assert.equal((await w.T.track(w.Cloud, { url: DUKE, title: 'Analyst' })).result, 'tracked');
});

test('the remembered list is capped', async () => {
  const w = makeWorld();
  for (let i = 0; i < 505; i++) {
    await w.T.track(w.Cloud, { url: `https://acme.wd1.myworkdayjobs.com/en-US/x/job/Role_R${i}` });
  }
  assert.equal(Object.keys(w.store.get('cloudTracked')).length, 500);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message.split('\n').slice(0, 8).join('\n       ')}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
