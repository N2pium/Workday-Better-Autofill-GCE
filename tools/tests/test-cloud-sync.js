// Runs the real cloud-sync.js against fake storage and a fake API that applies
// the same version rules as cloud/src/functions/profiles/handler.ts:
//   PUT without expectedVersion -> create only if absent, else 409
//   PUT with expectedVersion    -> update only if it matches, else 409
// Usage: node tools/tests/test-cloud-sync.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const plain = (v) => JSON.parse(JSON.stringify(v));

const LOCAL_PROFILE = {
  personalInfo: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com' },
  workExperience: [{ company: 'Acme', title: 'Engineer' }],
  skills: ['TypeScript'],
  jobPreferences: { authorizedToWork: true },
  demographics: { gender: 'female' }, // must never be uploaded
  resume: 'JVBERi0x',                  // must never be uploaded
  resumeMeta: { name: 'cv.pdf' }
};

function makeWorld({ local = {}, remote = null } = {}) {
  const store = new Map(Object.entries(structuredClone(local)));
  const chrome = {
    storage: {
      local: {
        async get(keys) {
          const out = {};
          for (const k of [].concat(keys)) if (store.has(k)) out[k] = structuredClone(store.get(k));
          return out;
        },
        async set(obj) { for (const [k, v] of Object.entries(obj)) store.set(k, structuredClone(v)); },
        async remove(keys) { for (const k of [].concat(keys)) store.delete(k); }
      }
    }
  };

  const server = { profile: remote && structuredClone(remote), puts: [], offline: false, failStatus: 0 };
  const Cloud = {
    async api(p, { method = 'GET', body } = {}) {
      assert.equal(p, '/profiles/default');
      if (server.offline) throw Object.assign(new Error('Failed to fetch'), {});
      if (server.failStatus) throw Object.assign(new Error('nope'), { status: server.failStatus });
      if (method === 'GET') {
        if (!server.profile) throw Object.assign(new Error('Profile not found'), { status: 404 });
        return structuredClone(server.profile);
      }
      server.puts.push(structuredClone(body));
      const cur = server.profile;
      if (body.expectedVersion === undefined ? cur : !cur || cur.version !== body.expectedVersion) {
        throw Object.assign(new Error('conflict'), { status: 409 });
      }
      const version = (body.expectedVersion || 0) + 1;
      server.profile = { id: 'default', name: body.name, data: body.data, version, updatedAt: '2026-11-22T12:00:00.000Z' };
      return { id: 'default', name: body.name, version, updatedAt: server.profile.updatedAt };
    }
  };

  const asks = [];
  const ask = { answer: null, chooseCopy(info) { asks.push(info); return ask.answer; } };

  const sandbox = { chrome, console };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'cloud-sync.js'), 'utf8'), sandbox, { filename: 'cloud-sync.js' });
  return { Sync: sandbox.EasyApplyCloudSync, store, server, Cloud, ask, asks };
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('enable with no synced profile uploads this device, without self-ID or resume', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  assert.equal(await w.Sync.enable(w.Cloud, w.ask), 'uploaded');
  const sent = w.server.puts[0];
  assert.equal(sent.expectedVersion, undefined);
  assert.deepEqual(Object.keys(sent.data).sort(), ['jobPreferences', 'personalInfo', 'skills', 'workExperience']);
  assert.equal(JSON.stringify(sent).includes('female'), false);
  assert.equal(JSON.stringify(sent).includes('JVBERi0x'), false);
  assert.deepEqual(plain(await w.Sync.state()).version, 1);
  assert.equal(w.asks.length, 0);
});

test('enable on an empty device downloads the synced profile without asking', async () => {
  const w = makeWorld({ remote: { data: { personalInfo: { firstName: 'Cloud' } }, version: 4 } });
  assert.equal(await w.Sync.enable(w.Cloud, w.ask), 'downloaded');
  assert.equal(w.store.get('personalInfo').firstName, 'Cloud');
  assert.equal((await w.Sync.state()).version, 4);
  assert.equal(w.asks.length, 0);
});

test('enable when both exist asks; "cloud" replaces this device but keeps self-ID local', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE, remote: { data: { personalInfo: { firstName: 'Cloud' } }, version: 2 } });
  w.ask.answer = 'cloud';
  assert.equal(await w.Sync.enable(w.Cloud, w.ask), 'downloaded');
  assert.equal(w.asks[0].conflict, false);
  assert.equal(w.store.get('personalInfo').firstName, 'Cloud');
  assert.equal(w.store.has('workExperience'), false, 'sections missing from the synced copy are cleared');
  assert.deepEqual(plain(w.store.get('demographics')), { gender: 'female' }, 'self-ID stays on the device');
  assert.equal(w.store.get('resume'), 'JVBERi0x', 'resume stays on the device');
});

test('enable when both exist; "device" overwrites the synced copy using its version', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE, remote: { data: { personalInfo: { firstName: 'Cloud' } }, version: 2 } });
  w.ask.answer = 'device';
  assert.equal(await w.Sync.enable(w.Cloud, w.ask), 'uploaded');
  assert.equal(w.server.puts[0].expectedVersion, 2);
  assert.equal(w.server.profile.data.personalInfo.firstName, 'Ada');
});

test('enable cancelled leaves sync off and changes nothing', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE, remote: { data: { personalInfo: { firstName: 'Cloud' } }, version: 2 } });
  w.ask.answer = null;
  assert.equal(await w.Sync.enable(w.Cloud, w.ask), 'cancelled');
  assert.equal((await w.Sync.state()).enabled, false);
  assert.equal(w.server.puts.length, 0);
  assert.equal(w.store.get('personalInfo').firstName, 'Ada');
});

test('save pushes with the last-seen version', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  await w.Sync.enable(w.Cloud, w.ask);
  w.store.set('skills', ['TypeScript', 'AWS']);
  assert.equal(await w.Sync.afterLocalSave(w.Cloud, w.ask), 'uploaded');
  assert.equal(w.server.puts.at(-1).expectedVersion, 1);
  assert.deepEqual(plain(w.server.profile.data.skills), ['TypeScript', 'AWS']);
  assert.equal((await w.Sync.state()).version, 2);
});

test('save does nothing when sync is off', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  assert.equal(await w.Sync.afterLocalSave(w.Cloud, w.ask), 'off');
  assert.equal(w.server.puts.length, 0);
});

test('save after another device changed the profile asks instead of overwriting', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  await w.Sync.enable(w.Cloud, w.ask);
  w.server.profile = { ...w.server.profile, data: { personalInfo: { firstName: 'Laptop' } }, version: 5 };
  w.ask.answer = 'cloud';
  assert.equal(await w.Sync.afterLocalSave(w.Cloud, w.ask), 'downloaded');
  assert.equal(w.asks[0].conflict, true);
  assert.equal(w.store.get('personalInfo').firstName, 'Laptop');
  assert.equal((await w.Sync.state()).version, 5);
});

test('a cancelled conflict is kept pending and asked again on next open', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  await w.Sync.enable(w.Cloud, w.ask);
  w.server.profile = { ...w.server.profile, version: 5 };
  w.ask.answer = null;
  assert.equal(await w.Sync.afterLocalSave(w.Cloud, w.ask), 'cancelled');
  assert.equal((await w.Sync.state()).pending, true);
  w.ask.answer = 'device';
  assert.equal(await w.Sync.onOpen(w.Cloud, w.ask), 'uploaded');
  assert.equal(w.server.puts.at(-1).expectedVersion, 5);
  assert.equal((await w.Sync.state()).pending, false);
});

test('offline save is kept pending, then pushed when the panel opens', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  await w.Sync.enable(w.Cloud, w.ask);
  w.server.offline = true;
  assert.equal(await w.Sync.afterLocalSave(w.Cloud, w.ask), 'pending');
  w.server.offline = false;
  assert.equal(await w.Sync.onOpen(w.Cloud, w.ask), 'uploaded');
});

test('a validation error is reported, not retried forever', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  await w.Sync.enable(w.Cloud, w.ask);
  w.server.failStatus = 422;
  await assert.rejects(w.Sync.afterLocalSave(w.Cloud, w.ask), (e) => e.status === 422);
  assert.equal((await w.Sync.state()).pending, false);
});

test('open pulls a newer synced profile and is quiet when up to date', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  await w.Sync.enable(w.Cloud, w.ask);
  assert.equal(await w.Sync.onOpen(w.Cloud, w.ask), 'up-to-date');
  w.server.profile = { ...w.server.profile, data: { personalInfo: { firstName: 'Phone' } }, version: 7 };
  assert.equal(await w.Sync.onOpen(w.Cloud, w.ask), 'downloaded');
  assert.equal(w.store.get('personalInfo').firstName, 'Phone');
  assert.equal(await w.Sync.onOpen(w.Cloud, w.ask), 'up-to-date', 'no reload loop after downloading');
});

test('old string-encoded card lists are uploaded as arrays', async () => {
  const w = makeWorld({ local: { ...LOCAL_PROFILE, education: JSON.stringify([{ school: 'MIT' }]), skills: 'a, b' } });
  await w.Sync.enable(w.Cloud, w.ask);
  assert.deepEqual(plain(w.server.puts[0].data.education), [{ school: 'MIT' }]);
  assert.deepEqual(plain(w.server.puts[0].data.skills), ['a', 'b']);
});

test('import marks pending only when sync is on', async () => {
  const w = makeWorld({ local: LOCAL_PROFILE });
  await w.Sync.markPending();
  assert.equal((await w.Sync.state()).enabled, false);
  await w.Sync.enable(w.Cloud, w.ask);
  await w.Sync.markPending();
  assert.equal((await w.Sync.state()).pending, true);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.stack.split('\n').slice(0, 3).join('\n       ')}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
