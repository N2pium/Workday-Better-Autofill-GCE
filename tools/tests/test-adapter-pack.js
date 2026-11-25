// Remote adapter packs (plan/Phase 3 Contracts.md §1): content.js reads its
// Workday tunables from adapters/workday-pack.js, a stored newer signed pack
// overrides them, and anything malformed falls back to the bundled values.
const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { pathToFileURL } = require('url');
const { load } = require('./harness');
const verify = require('../../adapters/verify-pack.js');

const ROOT = path.resolve(__dirname, '..', '..');
let failures = 0, passes = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (ok) passes++; else failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

function bundled() {
  const ctx = { }; ctx.self = ctx;
  vm.runInNewContext(fs.readFileSync(path.join(ROOT, 'adapters', 'workday-pack.js'), 'utf8'), ctx);
  return JSON.parse(JSON.stringify(ctx.EASYAPPLY_ADAPTER_BUNDLED));
}
const BUNDLED = bundled();
const PUBLIC_KEY = /'([A-Za-z0-9+/=]+)'/.exec(fs.readFileSync(path.join(ROOT, 'adapters', 'public-key.js'), 'utf8'))[1];

// A newer pack whose only change is a renamed delete-button automation id.
function newer(patch = {}, dataPatch = {}) {
  const p = JSON.parse(JSON.stringify(BUNDLED));
  Object.assign(p, { version: BUNDLED.version + 1 }, patch);
  Object.assign(p.data, { panelDeleteButtonIds: ['panel-remove-button'] }, dataPatch);
  return p;
}

// Work Experience panels whose delete button Workday "renamed": the bundled
// pack doesn't know the id, and the text ("Remove") doesn't say Delete.
function panel(n) {
  return `<div role="group" class="panel"><h4>Work Experience ${n}</h4>
    <div data-automation-id="formField-t"><label for="t${n}">Job Title*</label><input id="t${n}" class="title"></div>
    <div data-automation-id="formField-c"><label for="c${n}">Company*</label><input id="c${n}"></div>
    <button data-automation-id="panel-remove-button" class="del">Remove</button></div>`;
}
const PAGE = `<section><h3>Work Experience</h3><div id="panels">${[1, 2, 3].map(panel).join('')}</div>
  <button data-automation-id="add-button" id="add">Add Another</button></section>`;
const JOBS = [{ company: 'AWS', title: 'Builder' }];

async function fill(storage, version) {
  const { w } = load(PAGE, 'window.__ev = (s) => eval(s);', { storage, version });
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  w.document.querySelectorAll('.del').forEach(b => b.addEventListener('click', () => b.closest('.panel').remove()));
  await w.__ev('adapterReady');
  await w.__ev(`handleWorkExperience(${JSON.stringify(JOBS)})`);
  return { w, panels: w.document.querySelectorAll('.panel').length, pack: w.__ev('ADAPTER_VERSION') };
}

(async () => {
  // 1. Bundled pack.
  {
    const { w, panels, pack } = await fill({});
    check('no stored pack: bundled v1 in use', pack, 1);
    check('bundled: an unknown delete-button id is not clicked', panels, 3);
    const r = JSON.parse(w.__ev('JSON.stringify(buildFillReport())'));
    check('fill report carries build and pack version', [r.build, r.pack], ['2026-11-24f', 1]);
    check('bundled regexes compile to the original ones',
      [w.__ev('WORK_PANEL_HEADING.source'), w.__ev('SECTION_TITLE.flags'), w.__ev('DISABILITY_OPTION.decline.test("I do not wish to answer")')],
      ['^\\s*work experience\\s*\\d+\\s*$', 'i', true]);
  }

  // 2. A stored, newer, valid pack overrides a value.
  {
    const { w, panels, pack } = await fill({ adapterPack: newer() });
    check('stored v2: in use', pack, 2);
    check('stored v2: its delete-button id is clicked (2 untitled extras deleted)', panels, 1);
    check('stored v2: fill report says pack 2', JSON.parse(w.__ev('JSON.stringify(buildFillReport())')).pack, 2);
  }

  // 3. Packs that must be ignored.
  const ignored = [
    ['older/equal version', newer({ version: BUNDLED.version })],
    ['wrong ats', newer({ ats: 'greenhouse' })],
    ['too-new minExtension', newer({ minExtension: '9.0' })],
    ['unsupported schema', newer({ schema: 2 })],
    ['non-integer version', newer({ version: 2.5 })],
    ['no data', (() => { const p = newer(); delete p.data; return p; })()],
    ['not an object', 'hello']
  ];
  for (const [why, p] of ignored) {
    const { panels, pack } = await fill({ adapterPack: p });
    check(`ignored (${why}): bundled v1, nothing deleted`, [pack, panels], [1, 3]);
  }
  {
    const { pack } = await fill({ adapterPack: newer({ minExtension: '2.0.1' }) }, '2.0');
    check('minExtension 2.0.1 on extension 2.0: ignored', pack, 1);
  }

  // 4. Bad values in an otherwise valid pack fall back per key, never throw.
  {
    const p = newer({}, {
      workPanelHeading: { source: '(', flags: 'i' },          // does not compile
      sectionTitle: { source: 'x', flags: 'g' },              // stateful flag refused
      educationPanelHeading: 'not a regex',
      addButtonIds: 'add-button',                             // not a list
      datePickerTodayId: 'x"] , body [x="',                   // would break out of the selector
      dateSectionSelectors: { Month: 'input[[[', Year: 'input' },
      labels: { workCompany: ['employer name'], workTitle: [42] }
    });
    const { w, panels, pack } = await fill({ adapterPack: p });
    check('bad keys: pack v2 still in use and its good key applies', [pack, panels], [2, 1]);
    check('bad regex source falls back to bundled', w.__ev('WORK_PANEL_HEADING.source'), BUNDLED.data.workPanelHeading.source);
    check('g flag refused, bundled used', w.__ev('SECTION_TITLE.flags'), 'i');
    check('wrong types fall back', [w.__ev('EDU_PANEL_HEADING instanceof RegExp'), JSON.parse(w.__ev('JSON.stringify(ADD_BUTTON_IDS)'))], [true, BUNDLED.data.addButtonIds]);
    check('unsafe id falls back', w.__ev('DATE_PICKER_TODAY_ID'), 'datePickerSelectedToday');
    check('bad selector falls back, good one applies', JSON.parse(w.__ev('JSON.stringify(DATE_SECTION_SELECTORS)')), { Month: BUNDLED.data.dateSectionSelectors.Month, Year: 'input' });
    check('label lists resolve per key', JSON.parse(w.__ev('JSON.stringify([LABELS.workCompany, LABELS.workTitle, LABELS.city])')),
      [['employer name'], BUNDLED.data.labels.workTitle, BUNDLED.data.labels.city]);
  }

  // 5. The committed signed artifacts.
  const distBytes = fs.readFileSync(path.join(ROOT, 'adapters', 'dist', 'workday.json'));
  const distSig = fs.readFileSync(path.join(ROOT, 'adapters', 'dist', 'workday.json.sig'), 'utf8');
  const pubKey = crypto.createPublicKey({ key: { kty: 'OKP', crv: 'Ed25519', x: Buffer.from(PUBLIC_KEY, 'base64').toString('base64url') }, format: 'jwk' });
  check('dist/workday.json verifies against adapters/public-key.js (node:crypto)', crypto.verify(null, distBytes, pubKey, Buffer.from(distSig, 'base64')), true);
  const build = await import(pathToFileURL(path.join(ROOT, 'tools', 'build-adapter-pack.mjs')).href);
  check('dist/workday.json is the canonical build of adapters/workday-pack.js (rebuild after editing)',
    distBytes.toString('utf8'), build.canonicalJson(build.loadPackSource()));
  let threw = false;
  try { build.canonicalJson({ a: /x/ }); } catch (e) { threw = true; }
  check('build refuses a RegExp object (data only)', threw, true);

  // 6. The verify function background.js uses (WebCrypto Ed25519).
  check('verifySignature: dist bytes pass', await verify.verifySignature(new Uint8Array(distBytes), distSig, PUBLIC_KEY), true);
  const tampered = new Uint8Array(distBytes); tampered[10] ^= 1;
  check('verifySignature: one flipped byte fails', await verify.verifySignature(tampered, distSig, PUBLIC_KEY), false);
  check('verifySignature: garbage signature fails, does not throw', await verify.verifySignature(new Uint8Array(distBytes), '!!', PUBLIC_KEY), false);

  const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
  const tmpPub = Buffer.from(publicKey.export({ format: 'jwk' }).x, 'base64url').toString('base64');
  const v2 = Buffer.from(build.canonicalJson(newer()), 'utf8');
  const v2sig = crypto.sign(null, v2, privateKey).toString('base64');
  const opts = { ats: 'workday', bundledVersion: 1, extensionVersion: '2.0.1', publicKey: tmpPub };
  check('acceptPackBytes: signed newer pack accepted', ((await verify.acceptPackBytes(v2, v2sig, opts)).pack || {}).version, 2);
  const v2t = Buffer.from(v2); v2t[v2t.length - 3] ^= 1;
  check('acceptPackBytes: tampered byte -> bad signature', (await verify.acceptPackBytes(v2t, v2sig, opts)).error, 'bad signature');
  check('acceptPackBytes: right bytes, other key -> bad signature', (await verify.acceptPackBytes(v2, v2sig, { ...opts, publicKey: PUBLIC_KEY })).error, 'bad signature');
  check('acceptPackBytes: an HTML 200 (CloudFront SPA fallback) -> bad signature',
    (await verify.acceptPackBytes(Buffer.from('<!doctype html><html></html>'), v2sig, opts)).error, 'bad signature');
  const old = Buffer.from(build.canonicalJson(BUNDLED), 'utf8');
  check('acceptPackBytes: validly signed but not newer -> rejected',
    (await verify.acceptPackBytes(old, crypto.sign(null, old, privateKey).toString('base64'), opts)).error, 'not newer than bundled');
  check('compareVersions', [verify.compareVersions('2.0', '2.0.0'), verify.compareVersions('2.0', '2.0.1'), verify.compareVersions('2.10', '2.9')], [0, -1, 1]);

  // 7. background.js end to end: fetch, verify, store; failures keep the old pack.
  async function runBackground(responses, stored) {
    const store = { ...(stored ? { adapterPack: stored } : {}) };
    const listeners = { startup: [], installed: [], alarm: [] };
    const ev = (arr) => ({ addListener: (f) => arr && arr.push(f) });
    const chrome = {
      sidePanel: { setPanelBehavior: () => Promise.resolve() },
      runtime: { id: 'x', getManifest: () => ({ version: '2.0.1' }), onInstalled: ev(listeners.installed), onStartup: ev(listeners.startup), onMessage: ev() },
      permissions: { onAdded: ev(), onRemoved: ev(), contains: async () => false },
      scripting: { getRegisteredContentScripts: async () => [] },
      alarms: { get: async () => null, create: async () => {}, onAlarm: ev(listeners.alarm) },
      storage: {
        local: {
          get: async (k) => (typeof k === 'string' ? (k in store ? { [k]: store[k] } : {}) : { ...store }),
          set: async (o) => Object.assign(store, o), remove: async (k) => { delete store[k]; }
        },
        session: { get: async () => ({}), set: async () => {}, remove: async () => {} }
      },
      identity: {}
    };
    const fetched = [];
    const ctx = {
      chrome, console: { log() {}, error() {}, warn() {} }, crypto: globalThis.crypto, TextDecoder, TextEncoder, atob, btoa, URL, setTimeout, clearTimeout,
      fetch: async (u, init) => {
        fetched.push([u, init && init.credentials]);
        const body = u.endsWith('.sig') ? responses.sig : responses.pack;
        return { ok: true, status: 200, arrayBuffer: async () => new Uint8Array(Buffer.from(body)).buffer, text: async () => String(body) };
      }
    };
    ctx.self = ctx; ctx.globalThis = ctx;
    ctx.importScripts = (...files) => files.forEach(f => vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), ctx, { filename: f }));
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(ROOT, 'background.js'), 'utf8'), ctx, { filename: 'background.js' });
    // The background worker trusts only the bundled key: sign test packs with it.
    ctx.EASYAPPLY_ADAPTER_PUBLIC_KEY = responses.key || ctx.EASYAPPLY_ADAPTER_PUBLIC_KEY;
    await ctx.refreshAdapterPack();
    return { store, fetched, listeners };
  }
  {
    const r = await runBackground({ pack: v2, sig: v2sig, key: tmpPub });
    check('background: signed v2 stored as adapterPack', (r.store.adapterPack || {}).version, 2);
    check('background: fetches pack + .sig from adapterPackUrl, no credentials',
      r.fetched, [['https://d3sun3zkns70tc.cloudfront.net/adapters/workday.json', 'omit'], ['https://d3sun3zkns70tc.cloudfront.net/adapters/workday.json.sig', 'omit']]);
    check('background: runs on startup, install and its alarm', [r.listeners.startup.length >= 2, r.listeners.installed.length >= 2, r.listeners.alarm.length], [true, true, 2]);
    const keep = newer({ version: 3 });
    const t = await runBackground({ pack: v2t, sig: v2sig, key: tmpPub }, keep);
    check('background: tampered download keeps the previous pack', t.store.adapterPack.version, 3);
    const h = await runBackground({ pack: '<!doctype html>', sig: '<!doctype html>', key: tmpPub }, keep);
    check('background: HTML fallback keeps the previous pack', h.store.adapterPack.version, 3);
    const d = await runBackground({ pack: v2, sig: v2sig, key: tmpPub }, keep);
    check('background: never steps back to an older signed pack', d.store.adapterPack.version, 3);
    const s = await runBackground({ pack: v2, sig: v2sig, key: tmpPub }, newer({ version: 1 }));
    check('background: a stored pack the bundled one caught up with is replaced', s.store.adapterPack.version, 2);
  }

  console.log(failures ? `\n${failures} FAILED, ${passes} passed` : `\nall ${passes} passed`);
  process.exit(failures ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(1); });
