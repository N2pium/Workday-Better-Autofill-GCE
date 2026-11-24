// Resume Vault client (cloud-vault.js): presigned upload, confirm, use-for-autofill, delete.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert/strict');

const ROOT = path.resolve(__dirname, '..', '..');

function world() {
  const store = {};
  const calls = [];
  const sandbox = {
    chrome: {
      storage: {
        local: {
          async get(k) { const keys = [].concat(k); return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, store[x]])); },
          async set(o) { Object.assign(store, o); },
          async remove(k) { for (const x of [].concat(k)) delete store[x]; }
        }
      }
    },
    fetch: async () => { throw new Error('no network in tests'); }, FormData, Blob, FileReader: class {
      readAsDataURL(blob) { blob.arrayBuffer().then((b) => { this.result = `data:${blob.type};base64,${Buffer.from(b).toString('base64')}`; this.onload(); }); }
    }
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(fs.readFileSync(path.join(ROOT, 'cloud-vault.js'), 'utf8'), sandbox);
  const Cloud = {
    async api(p, opts = {}) {
      calls.push([opts.method || 'GET', p, opts.body]);
      if (p === '/resumes' && opts.method === 'POST') {
        return { resume: { id: 'R1' }, upload: { url: 'https://bucket.s3.us-east-2.amazonaws.com/', fields: { key: 'users/u/resumes/R1', Policy: 'p', 'Content-Type': opts.body.contentType } } };
      }
      if (p === '/resumes/R1/confirm') return { id: 'R1', status: 'ready' };
      if (p === '/resumes/R1/download') return { url: 'https://signed', fileName: 'cv.pdf', contentType: 'application/pdf' };
      return null;
    }
  };
  return { V: sandbox.EasyApplyVault, Cloud, calls, store };
}

const tests = [];
const test = (n, f) => tests.push([n, f]);
const pdf = (size = 10) => Object.assign(new Blob([Buffer.alloc(size, 1)], { type: 'application/pdf' }), { name: 'cv.pdf' });

test('add: create -> S3 POST (file last) -> confirm', async () => {
  const w = world();
  let posted;
  const out = await w.V.add(w.Cloud, pdf(), 'Data Analyst', async (url, init) => { posted = { url, keys: [...init.body.keys()] }; return { ok: true, status: 204 }; });
  assert.equal(out.status, 'ready');
  assert.deepEqual(w.calls.map((c) => c.slice(0, 2)), [['POST', '/resumes'], ['POST', '/resumes/R1/confirm']]);
  assert.deepEqual(JSON.parse(JSON.stringify(w.calls[0][2])), { name: 'Data Analyst', fileName: 'cv.pdf', contentType: 'application/pdf', size: 10 });
  assert.equal(posted.url, 'https://bucket.s3.us-east-2.amazonaws.com/');
  assert.equal(posted.keys[posted.keys.length - 1], 'file', 'S3 requires the file field last');
});

test('add: failed S3 upload removes the pending record', async () => {
  const w = world();
  await assert.rejects(() => w.V.add(w.Cloud, pdf(), 'x', async () => ({ ok: false, status: 403 })), /Upload failed \(403\)/);
  assert.deepEqual(w.calls.at(-1).slice(0, 2), ['DELETE', '/resumes/R1']);
});

test('add: refuses non-PDF/DOCX and files over 3 MB before any request', async () => {
  const w = world();
  const exe = Object.assign(new Blob(['x'], { type: 'application/x-msdownload' }), { name: 'a.exe' });
  await assert.rejects(() => w.V.add(w.Cloud, exe, 'x'), /PDF or Word/);
  await assert.rejects(() => w.V.add(w.Cloud, pdf(3 * 1024 * 1024 + 1), 'x'), /over 3 MB/);
  assert.equal(w.calls.length, 0);
});

test('use: stores the file where autofill reads it and marks it active', async () => {
  const w = world();
  await w.V.use(w.Cloud, { id: 'R1', name: 'Data Analyst' }, async () => ({ ok: true, blob: async () => new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }) }));
  assert.match(w.store.resume, /^data:application\/pdf;base64,/);
  assert.equal(w.store.resumeMeta.name, 'cv.pdf');
  assert.deepEqual({ ...w.store.cloudVaultActive }, { id: 'R1', name: 'Data Analyst' });
});

test('remove: clears the active marker but keeps the local copy', async () => {
  const w = world();
  w.store.cloudVaultActive = { id: 'R1' };
  w.store.resume = 'data:application/pdf;base64,AA==';
  await w.V.remove(w.Cloud, { id: 'R1' });
  assert.equal(w.store.cloudVaultActive, undefined);
  assert.equal(w.store.resume, 'data:application/pdf;base64,AA==');
});

(async () => {
  let pass = 0;
  for (const [n, f] of tests) {
    try { await f(); pass++; console.log(`  ok   ${n}`); } catch (e) { console.log(`  FAIL ${n}\n       ${e.message}`); }
  }
  console.log(`\n${pass}/${tests.length} passed`);
  process.exit(pass === tests.length ? 0 : 1);
})();
