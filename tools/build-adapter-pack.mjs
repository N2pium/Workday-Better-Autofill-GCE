#!/usr/bin/env node
/**
 * Builds and signs the remote Workday adapter pack (plan/Phase 3 Contracts.md §1).
 *
 *   node tools/build-adapter-pack.mjs --gen-key   one-time: new Ed25519 key pair
 *   node tools/build-adapter-pack.mjs             sign adapters/workday-pack.js
 *
 * --gen-key writes the PRIVATE key to ~/.easyapply/adapter-signing-key.pem
 * (outside the repo; refuses to overwrite) and the raw public key, base64, to
 * adapters/public-key.js, which ships in the extension.
 *
 * The default mode evaluates adapters/workday-pack.js in an empty vm sandbox
 * (it may only set self.EASYAPPLY_ADAPTER_BUNDLED to plain data), writes the
 * canonical JSON (sorted keys, no whitespace, UTF-8) to adapters/dist/workday.json
 * and the base64 Ed25519 signature of exactly those bytes to workday.json.sig.
 * It refuses to sign with a key that does not match adapters/public-key.js.
 *
 * No dependencies. EASYAPPLY_ADAPTER_KEY=<path> overrides the private key path.
 */
import crypto from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PACK_SRC = path.join(REPO, 'adapters', 'workday-pack.js');
const PUBLIC_KEY_JS = path.join(REPO, 'adapters', 'public-key.js');
const DIST = path.join(REPO, 'adapters', 'dist');
const KEY_PATH = process.env.EASYAPPLY_ADAPTER_KEY || path.join(os.homedir(), '.easyapply', 'adapter-signing-key.pem');

/** Sorted-key, whitespace-free JSON. Throws on anything that is not plain data. */
export function canonicalJson(v) {
    if (v === null || typeof v === 'boolean' || typeof v === 'string') return JSON.stringify(v);
    if (typeof v === 'number') {
        if (!Number.isFinite(v)) throw new Error('non-finite number in pack');
        return JSON.stringify(v);
    }
    if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`;
    if (typeof v === 'object') {
        const proto = Object.getPrototypeOf(v);
        // Objects from the vm realm have that realm's Object.prototype.
        if (proto !== null && Object.getPrototypeOf(proto) !== null) throw new Error('pack holds a non-plain object (RegExp? Date?)');
        return `{${Object.keys(v).sort().map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`;
    }
    throw new Error(`pack holds a ${typeof v}: data only`);
}

/** The pack object adapters/workday-pack.js defines, evaluated with nothing but `self`. */
export function loadPackSource(file = PACK_SRC) {
    const ctx = vm.createContext(Object.create(null));
    vm.runInContext('var self = this;', ctx);
    vm.runInContext(fs.readFileSync(file, 'utf8'), ctx, { filename: file, timeout: 1000 });
    const pack = ctx.EASYAPPLY_ADAPTER_BUNDLED;
    if (!pack) throw new Error(`${file} did not set self.EASYAPPLY_ADAPTER_BUNDLED`);
    if (pack.schema !== 1 || pack.ats !== 'workday' || !Number.isInteger(pack.version) || pack.version < 1
        || typeof pack.minExtension !== 'string' || !/^\d+(\.\d+){0,3}$/.test(pack.minExtension)
        || !pack.data || typeof pack.data !== 'object') {
        throw new Error('pack header must be { schema: 1, ats: "workday", version: <int >= 1>, minExtension: "x.y.z", data: {...} }');
    }
    return pack;
}

export function publicKeyFromFile(file = PUBLIC_KEY_JS) {
    const m = /EASYAPPLY_ADAPTER_PUBLIC_KEY\s*=\s*'([A-Za-z0-9+/=]+)'/.exec(fs.readFileSync(file, 'utf8'));
    return m ? m[1] : '';
}

export function rawPublicKeyB64(keyObject) {
    const jwk = keyObject.export({ format: 'jwk' });
    return Buffer.from(jwk.x, 'base64url').toString('base64');
}

function writePublicKeyJs(b64) {
    fs.writeFileSync(PUBLIC_KEY_JS, [
        '// Ed25519 public key (raw 32 bytes, base64) that remote adapter packs must be',
        '// signed with. Written by `node tools/build-adapter-pack.mjs --gen-key`; the',
        '// private key lives outside the repo (~/.easyapply/adapter-signing-key.pem).',
        `self.EASYAPPLY_ADAPTER_PUBLIC_KEY = '${b64}';`,
        ''
    ].join('\n'));
}

function genKey() {
    const rel = path.relative(REPO, path.resolve(KEY_PATH));
    if (!rel.startsWith('..') && !path.isAbsolute(rel)) throw new Error(`refusing to put the private key inside the repo: ${KEY_PATH}`);
    if (fs.existsSync(KEY_PATH)) throw new Error(`${KEY_PATH} already exists; refusing to overwrite it`);
    fs.mkdirSync(path.dirname(KEY_PATH), { recursive: true, mode: 0o700 });
    const { privateKey, publicKey } = crypto.generateKeyPairSync('ed25519');
    fs.writeFileSync(KEY_PATH, privateKey.export({ format: 'pem', type: 'pkcs8' }), { mode: 0o600, flag: 'wx' });
    const b64 = rawPublicKeyB64(publicKey);
    writePublicKeyJs(b64);
    console.log(`private key: ${KEY_PATH}  (keep it safe, never commit it)`);
    console.log(`public key:  ${b64}  -> adapters/public-key.js`);
}

function build() {
    if (!fs.existsSync(KEY_PATH)) throw new Error(`no signing key at ${KEY_PATH}; run with --gen-key first`);
    const privateKey = crypto.createPrivateKey(fs.readFileSync(KEY_PATH));
    const pub = rawPublicKeyB64(crypto.createPublicKey(privateKey));
    if (pub !== publicKeyFromFile()) throw new Error('signing key does not match adapters/public-key.js; the extension would reject this pack');

    const pack = loadPackSource();
    const bytes = Buffer.from(canonicalJson(pack), 'utf8');
    const sig = crypto.sign(null, bytes, privateKey).toString('base64');
    if (!crypto.verify(null, bytes, crypto.createPublicKey(privateKey), Buffer.from(sig, 'base64'))) throw new Error('self-check of the signature failed');

    fs.mkdirSync(DIST, { recursive: true });
    fs.writeFileSync(path.join(DIST, 'workday.json'), bytes);
    fs.writeFileSync(path.join(DIST, 'workday.json.sig'), sig);
    console.log(`adapters/dist/workday.json      v${pack.version}, ${bytes.length} bytes`);
    console.log('adapters/dist/workday.json.sig  Ed25519, base64');
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
    try {
        if (process.argv.includes('--gen-key')) genKey();
        else build();
    } catch (e) {
        console.error(`build-adapter-pack: ${e.message}`);
        process.exit(1);
    }
}
