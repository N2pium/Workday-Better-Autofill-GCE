// Adapter pack acceptance rules and signature check (plan/Phase 3 Contracts.md §1).
//
// Pure functions, no chrome.* calls, so the same code runs in the background
// worker (signature + rules before storing), in content.js (rules again before
// using a stored pack) and in the Node tests.
(function (root) {
    'use strict';

    const SUPPORTED_SCHEMA = 1;
    const MAX_PACK_BYTES = 256 * 1024;

    /** -1 / 0 / 1 comparing dotted numeric versions ("2.0" == "2.0.0" < "2.0.1"). */
    function compareVersions(a, b) {
        const pa = String(a).split('.').map(Number);
        const pb = String(b).split('.').map(Number);
        for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
            const x = pa[i] || 0, y = pb[i] || 0;
            if (x !== y) return x < y ? -1 : 1;
        }
        return 0;
    }

    const VERSION_RE = /^\d{1,5}(\.\d{1,5}){0,3}$/;

    /**
     * Why `pack` may not be used, or '' if it may. `opts`:
     *   ats              'workday'
     *   bundledVersion   the version shipped inside the extension
     *   extensionVersion chrome.runtime.getManifest().version
     */
    function checkPack(pack, opts) {
        if (!pack || typeof pack !== 'object' || Array.isArray(pack)) return 'not an object';
        if (pack.schema !== SUPPORTED_SCHEMA) return 'unsupported schema';
        if (pack.ats !== opts.ats) return 'wrong ats';
        if (!Number.isInteger(pack.version) || pack.version < 1) return 'bad version';
        if (!(pack.version > opts.bundledVersion)) return 'not newer than bundled';
        if (typeof pack.minExtension !== 'string' || !VERSION_RE.test(pack.minExtension)) return 'bad minExtension';
        if (!VERSION_RE.test(String(opts.extensionVersion || ''))) return 'unknown extension version';
        if (compareVersions(pack.minExtension, opts.extensionVersion) > 0) return 'needs a newer extension';
        if (!pack.data || typeof pack.data !== 'object' || Array.isArray(pack.data)) return 'no data';
        return '';
    }

    function base64ToBytes(b64) {
        const bin = atob(String(b64).trim());
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
        return out;
    }

    /** Ed25519 check of `sigB64` over exactly `bytes`. Never throws: false on any error. */
    async function verifySignature(bytes, sigB64, publicKeyB64, subtle) {
        try {
            const s = subtle || (root.crypto && root.crypto.subtle);
            const key = await s.importKey('raw', base64ToBytes(publicKeyB64), { name: 'Ed25519' }, false, ['verify']);
            return await s.verify({ name: 'Ed25519' }, key, base64ToBytes(sigB64), bytes);
        } catch (e) {
            return false;
        }
    }

    /**
     * The whole download check: size, signature over the exact bytes, JSON,
     * then checkPack. Resolves { pack } or { error }. Never throws.
     */
    async function acceptPackBytes(bytes, sigB64, opts) {
        try {
            bytes = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
            if (!bytes.length || bytes.length > MAX_PACK_BYTES) return { error: 'bad size' };
            if (!(await verifySignature(bytes, sigB64, opts.publicKey, opts.subtle))) return { error: 'bad signature' };
            const pack = JSON.parse(new TextDecoder().decode(bytes));
            const why = checkPack(pack, opts);
            return why ? { error: why } : { pack };
        } catch (e) {
            return { error: 'unreadable' };
        }
    }

    const api = { SUPPORTED_SCHEMA, MAX_PACK_BYTES, compareVersions, checkPack, verifySignature, acceptPackBytes, base64ToBytes };
    if (typeof module === 'object' && module.exports) module.exports = api;
    else root.EasyApplyAdapterVerify = api;
})(typeof self !== 'undefined' ? self : globalThis);
