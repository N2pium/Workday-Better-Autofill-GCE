/*
 * Profile sync (plan/Features/F01 Accounts and Profile Sync.md). Always on
 * while signed in: the first open/save after sign-in turns it on, and signing
 * out (cloud-auth.js clearCredentials) is the only way to stop it.
 *
 * One synced profile per account for now ("default"). The server keeps a
 * version number; every write sends the version this device last saw, so two
 * devices can never silently overwrite each other (the API answers 409).
 *
 * What syncs: the sections below. Self-identification answers (`demographics`)
 * and the resume file never leave the device (PRIVACY_POLICY.md); the API
 * refuses them too.
 *
 * Decisions that need the user ("which copy wins?") go through `ask`, so this
 * file has no UI and can be tested on its own.
 */
(function (global) {
    'use strict';

    const SYNC_KEY = 'cloudSync'; // { enabled, version, pending, lastSyncedAt, downloadedAt? } — a cloud* key: never exported
    const PROFILE_ID = 'default';
    const PROFILE_NAME = 'My profile';
    const SYNCED_KEYS = ['personalInfo', 'address', 'education', 'workExperience', 'skills', 'language', 'jobPreferences'];

    // Older versions stored the card lists as JSON strings.
    function asArray(v) {
        if (Array.isArray(v)) return v;
        if (typeof v === 'string') {
            try { const p = JSON.parse(v); return Array.isArray(p) ? p : []; } catch (e) { return []; }
        }
        return [];
    }

    async function readLocalProfile() {
        const stored = await chrome.storage.local.get(SYNCED_KEYS);
        const out = {};
        for (const k of SYNCED_KEYS) if (stored[k] !== undefined && stored[k] !== null) out[k] = stored[k];
        if ('education' in out) out.education = asArray(out.education);
        if ('workExperience' in out) out.workExperience = asArray(out.workExperience);
        if ('skills' in out && !Array.isArray(out.skills)) {
            out.skills = String(out.skills).split(',').map((s) => s.trim()).filter(Boolean);
        }
        return out;
    }

    /** True when the profile has something a person typed, not just blank fields. */
    function hasContent(p) {
        const info = p.personalInfo || {};
        return Boolean(
            info.firstName || info.lastName || info.email || info.phone ||
            (p.education && p.education.length) || (p.workExperience && p.workExperience.length) ||
            (p.skills && p.skills.length)
        );
    }

    async function writeLocalProfile(data) {
        const set = {};
        const remove = [];
        for (const k of SYNCED_KEYS) {
            if (data && data[k] !== undefined) set[k] = data[k];
            else remove.push(k);
        }
        await chrome.storage.local.set(set);
        if (remove.length) await chrome.storage.local.remove(remove);
    }

    async function state() {
        const { [SYNC_KEY]: s } = await chrome.storage.local.get(SYNC_KEY);
        return s && s.enabled ? s : { enabled: false };
    }

    const saveState = (s) => chrome.storage.local.set({ [SYNC_KEY]: s });
    // downloadedAt tells an open panel that the profile on this device was replaced (popup.js).
    const synced = (version, extra) => saveState({ enabled: true, version, pending: false, lastSyncedAt: new Date().toISOString(), ...extra });

    async function fetchRemote(Cloud) {
        try {
            return await Cloud.api(`/profiles/${PROFILE_ID}`);
        } catch (e) {
            if (e.status === 404) return null;
            throw e;
        }
    }

    async function upload(Cloud, expectedVersion) {
        const body = { name: PROFILE_NAME, data: await readLocalProfile() };
        if (expectedVersion) body.expectedVersion = expectedVersion;
        const res = await Cloud.api(`/profiles/${PROFILE_ID}`, { method: 'PUT', body });
        await synced(res.version);
        return 'uploaded';
    }

    async function download(remote) {
        await writeLocalProfile(remote.data);
        await synced(remote.version, { downloadedAt: new Date().toISOString() });
        return 'downloaded';
    }

    /** Both copies changed (or both exist on first enable): the user picks one. */
    async function resolve(Cloud, ask, conflict) {
        const remote = await fetchRemote(Cloud);
        if (!remote) return upload(Cloud);
        const choice = await ask.chooseCopy({ remoteUpdatedAt: remote.updatedAt, conflict });
        if (choice === 'cloud') return download(remote);
        if (choice === 'device') return upload(Cloud, remote.version);
        return 'cancelled';
    }

    /** Uploads this device's profile, handling a conflict if another device got there first. */
    async function pushOrResolve(Cloud, ask, s) {
        try {
            return await upload(Cloud, s.version);
        } catch (e) {
            if (e.status === 409) {
                const result = await resolve(Cloud, ask, true);
                if (result === 'cancelled') await saveState({ ...s, pending: true });
                return result;
            }
            if (e.status >= 400 && e.status < 500) throw e; // e.g. validation: tell the user, don't retry forever
            await saveState({ ...s, pending: true }); // offline or server error: retry next time the panel opens
            return 'pending';
        }
    }

    /** Turn sync on. Returns 'uploaded' | 'downloaded' | 'cancelled'. */
    async function enable(Cloud, ask) {
        const remote = await fetchRemote(Cloud);
        if (!remote) return upload(Cloud);
        if (!hasContent(await readLocalProfile())) return download(remote);
        const result = await resolve(Cloud, ask, false);
        return result;
    }

    /** After "Save Profile". Returns 'uploaded' | 'downloaded' | 'pending' | 'cancelled'. */
    async function afterLocalSave(Cloud, ask) {
        const s = await state();
        if (!s.enabled) return enable(Cloud, ask);
        return pushOrResolve(Cloud, ask, s);
    }

    /** When the panel opens. Returns 'up-to-date' | 'uploaded' | 'downloaded' | 'pending' | 'cancelled'. */
    async function onOpen(Cloud, ask) {
        const s = await state();
        if (!s.enabled) return enable(Cloud, ask);
        if (s.pending) return pushOrResolve(Cloud, ask, s);
        const remote = await fetchRemote(Cloud);
        if (!remote) return upload(Cloud);
        if (remote.version > (s.version || 0)) return download(remote);
        return 'up-to-date';
    }

    /**
     * Background check (background.js alarm): download a newer synced profile.
     * Never asks and never uploads, so it can't overwrite anything: it skips
     * when sync isn't on yet or this device has changes waiting to go up.
     * Returns 'skipped' | 'up-to-date' | 'downloaded'.
     */
    async function pullIfNewer(Cloud) {
        const s = await state();
        if (!s.enabled || s.pending) return 'skipped';
        const remote = await fetchRemote(Cloud);
        if (!remote || !(remote.version > (s.version || 0))) return 'up-to-date';
        return download(remote);
    }

    /** Local data changed outside "Save Profile" (e.g. Import): push it next time. */
    async function markPending() {
        const s = await state();
        if (s.enabled) await saveState({ ...s, pending: true });
    }

    global.EasyApplyCloudSync = Object.freeze({
        SYNCED_KEYS, state, enable, afterLocalSave, onOpen, pullIfNewer, markPending,
        _test: { readLocalProfile, hasContent }
    });
})(self);
