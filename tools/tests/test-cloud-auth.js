// Runs the real cloud-auth.js against a fake `chrome` and `fetch`.
// Usage: node tools/tests/test-cloud-auth.js
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

const ROOT = path.resolve(__dirname, '..', '..');
const EXT_ID = 'jhndpohagnfomchdcfnfecdhmdaepgcd';
const REDIRECT = `https://${EXT_ID}.chromiumapp.org/`;

const b64url = (buf) => Buffer.from(buf).toString('base64url');
const plain = (v) => JSON.parse(JSON.stringify(v)); // sandbox objects have other-realm prototypes
const fakeJwt = (claims) => `${b64url('{"alg":"none"}')}.${b64url(JSON.stringify(claims))}.sig`;

function makeWorld() {
  const stores = { session: new Map(), local: new Map() };
  const area = (m) => ({
    async get(key) { return m.has(key) ? { [key]: structuredClone(m.get(key)) } : {}; },
    async set(obj) { for (const [k, v] of Object.entries(obj)) m.set(k, structuredClone(v)); },
    async remove(keys) { for (const k of [].concat(keys)) m.delete(k); }
  });
  const log = { authFlows: [], tokenCalls: [], apiCalls: [], revokes: [] };
  const world = {
    stores, log,
    // test knobs
    authResponse: (url) => {                    // default: echo state, return a code
      const p = new URL(url).searchParams;
      return `${REDIRECT}?code=CODE123&state=${p.get('state')}`;
    },
    tokenResponder: null,
    apiResponder: null
  };

  const chrome = {
    storage: { session: area(stores.session), local: area(stores.local) },
    identity: {
      getRedirectURL: () => REDIRECT,
      async launchWebAuthFlow({ url, interactive }) {
        log.authFlows.push({ url, interactive });
        if (url.includes('/logout')) return REDIRECT;
        return world.authResponse(url);
      }
    },
    permissions: { async contains() { return true; }, async request() { return true; } }
  };

  let tokenSeq = 0;
  async function fetch(input, init = {}) {
    const url = new URL(String(input));
    const json = (status, body) => ({
      ok: status >= 200 && status < 300, status,
      async json() { return body; }, async text() { return body === undefined ? '' : JSON.stringify(body); }
    });
    if (url.pathname === '/oauth2/token') {
      const params = Object.fromEntries(new URLSearchParams(String(init.body)));
      log.tokenCalls.push(params);
      if (world.tokenResponder) return world.tokenResponder(params, json);
      tokenSeq++;
      return json(200, {
        access_token: `access-${tokenSeq}`,
        id_token: fakeJwt({ sub: 'user-1', email: 'ada@example.com' }),
        ...(params.grant_type === 'authorization_code' ? { refresh_token: 'refresh-1' } : {}),
        expires_in: 3600, token_type: 'Bearer'
      });
    }
    if (url.pathname === '/oauth2/revoke') {
      log.revokes.push(Object.fromEntries(new URLSearchParams(String(init.body))));
      return json(200, {});
    }
    log.apiCalls.push({ path: url.pathname, method: init.method, auth: init.headers?.Authorization });
    if (world.apiResponder) return world.apiResponder(url, init, json);
    return json(200, { items: [] });
  }

  const sandbox = {
    chrome, fetch, crypto: globalThis.crypto, btoa, atob, TextEncoder, TextDecoder, URL, URLSearchParams,
    console, setTimeout
  };
  sandbox.self = sandbox;
  vm.createContext(sandbox);
  for (const f of ['cloud-config.js', 'cloud-auth.js']) {
    vm.runInContext(fs.readFileSync(path.join(ROOT, f), 'utf8'), sandbox, { filename: f });
  }
  world.Cloud = sandbox.EasyApplyCloud;
  return world;
}

const tests = [];
const test = (name, fn) => tests.push({ name, fn });

test('sign-in uses code + PKCE (S256) with the extension redirect, and stores tokens in the right places', async () => {
  const w = makeWorld();
  const s = await w.Cloud.signIn();
  assert.deepEqual({ ...s }, { signedIn: true, email: 'ada@example.com' });

  const auth = new URL(w.log.authFlows[0].url);
  assert.equal(auth.origin + auth.pathname, 'https://better-autofill.auth.us-east-2.amazoncognito.com/oauth2/authorize');
  const q = auth.searchParams;
  assert.equal(q.get('response_type'), 'code');
  assert.equal(q.get('redirect_uri'), REDIRECT);
  assert.equal(q.get('code_challenge_method'), 'S256');
  assert.equal(q.get('scope'), 'openid email profile');
  assert.equal(w.log.authFlows[0].interactive, true);

  const tokenCall = w.log.tokenCalls[0];
  assert.equal(tokenCall.grant_type, 'authorization_code');
  assert.equal(tokenCall.code, 'CODE123');
  assert.equal(tokenCall.redirect_uri, REDIRECT);
  assert.ok(!('client_secret' in tokenCall), 'public client must not send a secret');
  const expected = b64url(crypto.createHash('sha256').update(tokenCall.code_verifier).digest());
  assert.equal(q.get('code_challenge'), expected, 'challenge must be SHA-256 of the verifier');
  assert.ok(tokenCall.code_verifier.length >= 43, 'verifier must be at least 43 chars (RFC 7636)');

  assert.equal(w.stores.session.get('cloudSession').accessToken, 'access-1');
  assert.equal(w.stores.local.get('cloudAuth').refreshToken, 'refresh-1');
  assert.equal(w.stores.local.get('cloudAuth').accessToken, undefined, 'access token must not be in storage.local');
});

test('Create account opens the /signup page with the same PKCE parameters', async () => {
  const w = makeWorld();
  await w.Cloud.signIn({ signUp: true });
  const u = new URL(w.log.authFlows[0].url);
  assert.equal(u.pathname, '/signup');
  assert.equal(u.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(u.searchParams.get('redirect_uri'), REDIRECT);
  assert.equal(w.log.tokenCalls[0].grant_type, 'authorization_code');
});

test('sign-out also switches sync off on this device', async () => {
  const w = makeWorld();
  await w.Cloud.signIn();
  w.stores.local.set('cloudSync', { enabled: true, version: 3 });
  await w.Cloud.signOut();
  assert.equal(w.stores.local.has('cloudSync'), false);
});

test('a response with the wrong state is rejected and nothing is stored', async () => {
  const w = makeWorld();
  w.authResponse = () => `${REDIRECT}?code=EVIL&state=attacker`;
  await assert.rejects(w.Cloud.signIn(), /did not match/);
  assert.equal(w.log.tokenCalls.length, 0, 'must not exchange a code from a mismatched response');
  assert.equal(w.stores.local.size + w.stores.session.size, 0);
});

test('an error returned by the sign-in page is surfaced', async () => {
  const w = makeWorld();
  w.authResponse = () => `${REDIRECT}?error=access_denied&error_description=User%20cancelled`;
  await assert.rejects(w.Cloud.signIn(), /User cancelled/);
});

test('api() sends the bearer token and refreshes an expired session first', async () => {
  const w = makeWorld();
  await w.Cloud.signIn();
  w.stores.session.set('cloudSession', { ...w.stores.session.get('cloudSession'), expiresAt: Date.now() - 1 });
  await w.Cloud.api('/profiles');
  assert.equal(w.log.tokenCalls.at(-1).grant_type, 'refresh_token');
  assert.equal(w.log.tokenCalls.at(-1).refresh_token, 'refresh-1');
  assert.equal(w.log.apiCalls.at(-1).auth, 'Bearer access-2');
  assert.equal(w.stores.local.get('cloudAuth').refreshToken, 'refresh-1', 'keeps the refresh token when Cognito does not rotate it');
});

test('api() retries once with a fresh token after a 401', async () => {
  const w = makeWorld();
  await w.Cloud.signIn();
  let calls = 0;
  w.apiResponder = (_u, _i, json) => (++calls === 1 ? json(401, { message: 'Unauthorized' }) : json(200, { items: [1] }));
  const out = await w.Cloud.api('/profiles');
  assert.deepEqual(plain(out.items), [1]);
  assert.deepEqual(w.log.apiCalls.map((c) => c.auth), ['Bearer access-1', 'Bearer access-2']);
});

test('concurrent calls share one refresh', async () => {
  const w = makeWorld();
  await w.Cloud.signIn();
  w.stores.session.delete('cloudSession');
  const before = w.log.tokenCalls.length;
  await Promise.all([w.Cloud.api('/a'), w.Cloud.api('/b'), w.Cloud.api('/c')]);
  assert.equal(w.log.tokenCalls.length - before, 1);
});

test('a revoked refresh token signs the user out cleanly', async () => {
  const w = makeWorld();
  await w.Cloud.signIn();
  w.stores.session.delete('cloudSession');
  w.tokenResponder = (_p, json) => json(400, { error: 'invalid_grant' });
  await assert.rejects(w.Cloud.api('/profiles'), (e) => e.notSignedIn === true && /sign in again/.test(e.message));
  assert.deepEqual({ ...(await w.Cloud.status()) }, { signedIn: false });
});

test('API errors carry the server message and status', async () => {
  const w = makeWorld();
  await w.Cloud.signIn();
  w.apiResponder = (_u, _i, json) => json(422, { error: 'Self-identification answers are never synced' });
  await assert.rejects(w.Cloud.api('/profiles/x', { method: 'PUT', body: {} }), (e) => e.status === 422 && /never synced/.test(e.message));
});

test('sign-out clears credentials first, revokes the refresh token, and ends the Cognito session', async () => {
  const w = makeWorld();
  await w.Cloud.signIn();
  await w.Cloud.signOut();
  assert.equal(w.stores.local.has('cloudAuth'), false);
  assert.equal(w.stores.session.has('cloudSession'), false);
  assert.deepEqual(w.log.revokes[0], { token: 'refresh-1', client_id: '43qdd554clva7dugdetl1evlea' });
  const logout = w.log.authFlows.at(-1);
  assert.match(logout.url, /\/logout\?/);
  assert.equal(logout.interactive, false);
});

test('delete account calls DELETE /account with confirmation, then signs out', async () => {
  const w = makeWorld();
  await w.Cloud.signIn();
  w.apiResponder = (_u, init, json) => json(200, { deleted: true, received: JSON.parse(init.body) });
  const out = await w.Cloud.deleteAccount();
  assert.deepEqual(plain(out.received), { confirm: 'DELETE' });
  assert.equal(w.log.apiCalls.at(-1).method, 'DELETE');
  assert.deepEqual({ ...(await w.Cloud.status()) }, { signedIn: false });
});

test('isCloudKey marks only credential keys (used by export/import filters)', () => {
  const w = makeWorld();
  assert.equal(w.Cloud.isCloudKey('cloudAuth'), true);
  assert.equal(w.Cloud.isCloudKey('cloudSession'), true);
  for (const k of ['personalInfo', 'demographics', 'resume', 'jobPreferences']) assert.equal(w.Cloud.isCloudKey(k), false);
});

(async () => {
  let failed = 0;
  for (const { name, fn } of tests) {
    try { await fn(); console.log(`  ok   ${name}`); }
    catch (e) { failed++; console.log(`  FAIL ${name}\n       ${e.message}`); }
  }
  console.log(`\n${tests.length - failed}/${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
