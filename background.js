// Open the side panel when the toolbar icon is clicked.
// Unlike a popup, the side panel stays open while the user interacts with the page.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('Workday Autofill: sidePanel setup failed', err));

/**
 * OPT-IN JOB SITES (Greenhouse, iCIMS)
 *
 * Each site's access is an optional host permission the user grants from the
 * side panel (Settings > Job sites). Its content scripts are registered
 * dynamically only after the permission is granted, and unregistered if the
 * user revokes it. This keeps the extension least-privilege: installing it
 * never requests access to these sites, and updates never disable the
 * extension for existing users.
 *
 * allFrames is required because companies embed these forms in an iframe on
 * their own careers page; the iframe still loads from the site's own domain,
 * so the granted origin covers it.
 */
const PORTALS = [
    {
        name: 'Greenhouse',
        origins: ['*://boards.greenhouse.io/*', '*://job-boards.greenhouse.io/*'],
        // greenhouse.js (isolated world: chrome APIs, messaging, text fields) and
        // greenhouse-main.js (MAIN world: drives react-select components on
        // job-boards.greenhouse.io via React internals, invisible from the
        // isolated world). They talk over window.postMessage.
        scripts: [
            { id: 'greenhouse-autofill', js: ['greenhouse.js', 'cloud-library.js', 'ai-assist.js'] },
            { id: 'greenhouse-autofill-main', js: ['greenhouse-main.js'], world: 'MAIN' }
        ]
    },
    {
        name: 'iCIMS',
        origins: ['*://*.icims.com/*'],
        // form-filler.js is the shared label-based filler; icims.js decides
        // which frame fills and leaves iCIMS sign-in pages alone.
        scripts: [
            { id: 'icims-autofill', js: ['form-filler.js', 'icims.js', 'cloud-library.js', 'ai-assist.js'] }
        ]
    }
];

const registrationFor = (portal) => portal.scripts.map((s) => ({
    id: s.id, matches: portal.origins, js: s.js, runAt: 'document_end', allFrames: true, ...(s.world ? { world: s.world } : {})
}));

async function syncPortalRegistration(portal) {
    try {
        const scripts = registrationFor(portal);
        const granted = await chrome.permissions.contains({ origins: portal.origins });
        const registered = await chrome.scripting.getRegisteredContentScripts({ ids: scripts.map((s) => s.id) });

        if (granted && registered.length < scripts.length) {
            const missing = scripts.filter((s) => !registered.some((r) => r.id === s.id));
            await chrome.scripting.registerContentScripts(missing);
            console.log(`Better Autofill: ${portal.name} content scripts registered.`);
        }
        // Registrations survive extension updates with their OLD file lists, so
        // bring existing ones up to date (e.g. ai-assist.js added in 2.0).
        if (granted && registered.length > 0) {
            const existing = scripts.filter((s) => registered.some((r) => r.id === s.id));
            await chrome.scripting.updateContentScripts(existing);
        } else if (!granted && registered.length > 0) {
            await chrome.scripting.unregisterContentScripts({ ids: registered.map((r) => r.id) });
            console.log(`Better Autofill: ${portal.name} content scripts unregistered.`);
        }
    } catch (err) {
        console.error(`Better Autofill: ${portal.name} registration sync failed`, err);
    }
}

// When the user grants a permission, also inject into that site's tabs that are
// already open, so autofill works without a manual refresh. (Every script is a
// no-op if already present: each guards with a window flag.)
async function injectIntoOpenTabs(portal) {
    try {
        const granted = await chrome.permissions.contains({ origins: portal.origins });
        if (!granted) return;
        const tabs = await chrome.tabs.query({ url: portal.origins });
        for (const tab of tabs) {
            for (const s of portal.scripts) {
                try {
                    await chrome.scripting.executeScript({
                        target: { tabId: tab.id, allFrames: true },
                        files: s.js,
                        ...(s.world ? { world: s.world } : {})
                    });
                } catch (e) { /* tab may be discarded or navigating */ }
            }
        }
    } catch (err) {
        console.error(`Better Autofill: injection into open ${portal.name} tabs failed`, err);
    }
}

const syncAllPortals = () => Promise.all(PORTALS.map(syncPortalRegistration));

async function onPermissionsChanged() {
    await syncAllPortals();
    await Promise.all(PORTALS.map(injectIntoOpenTabs));
}

chrome.runtime.onInstalled.addListener(onPermissionsChanged);
chrome.runtime.onStartup.addListener(syncAllPortals);
chrome.permissions.onAdded.addListener(onPermissionsChanged);
chrome.permissions.onRemoved.addListener(syncAllPortals);

/**
 * CLOUD RELAY for the on-page Draft button (ai-assist.js).
 *
 * Content scripts can't read the sign-in session (chrome.storage.session) and
 * shouldn't: they run on job sites. So they ask here, and only for the actions
 * below. The profile sent to the AI is read here from storage (work, education,
 * skills only) rather than taken from the page.
 */
importScripts('cloud-config.js', 'cloud-auth.js', 'cloud-sync.js');

const ID_RE = /^\d{8}T\d{6}Z-[0-9a-f]{8}$/;

async function aiProfile() {
    const d = await chrome.storage.local.get(['workExperience', 'education', 'skills']);
    const arr = (v) => (Array.isArray(v) ? v : []);
    const skills = Array.isArray(d.skills) ? d.skills : String(d.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
    return { workExperience: arr(d.workExperience).slice(0, 30), education: arr(d.education).slice(0, 20), skills: skills.slice(0, 200) };
}

const RELAY = {
    async status() {
        const s = await EasyApplyCloud.status();
        return { signedIn: s.signedIn && (await EasyApplyCloud.hasPermission()) };
    },
    listAnswers: () => EasyApplyCloud.api('/answers?limit=300'),
    saveAnswer: ({ category, question, text }) =>
        EasyApplyCloud.api('/answers', { method: 'POST', body: { category, question, text } }),
    useAnswer: ({ id }) => {
        if (!ID_RE.test(String(id))) throw new Error('Bad answer id');
        return EasyApplyCloud.api(`/answers/${id}/use`, { method: 'POST', body: {} });
    },
    categorise: ({ question }) => EasyApplyCloud.api('/ai/categorise', { method: 'POST', body: { question } }),
    draft: async ({ question, maxChars, job }) =>
        EasyApplyCloud.api('/ai/answer', { method: 'POST', body: { question, maxChars, job, profile: await aiProfile() } }),
    adapt: ({ question, savedAnswer, maxChars, job }) =>
        EasyApplyCloud.api('/ai/adapt', { method: 'POST', body: { question, savedAnswer, maxChars, job } })
};

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (!msg || msg.action !== 'cloud_relay') return false;
    // Only this extension's own content scripts (which always have a tab).
    if (sender.id !== chrome.runtime.id || !sender.tab) return false;
    const fn = Object.prototype.hasOwnProperty.call(RELAY, msg.op) ? RELAY[msg.op] : null;
    if (!fn) { sendResponse({ ok: false, error: 'Unknown request' }); return false; }
    Promise.resolve()
        .then(() => fn(msg.args || {}))
        .then((data) => sendResponse({ ok: true, data }))
        .catch((e) => sendResponse({ ok: false, error: e.message, status: e.status, notSignedIn: !!e.notSignedIn }));
    return true; // async response
});

/**
 * PROFILE SYNC in the background (cloud-sync.js pullIfNewer).
 *
 * Saving pushes at once (popup.js). This pulls another device's changes every
 * few minutes and at browser start, so autofill uses the latest profile even
 * when the side panel isn't open. Download-only: it never asks or uploads.
 * Signed out or no permission: nothing is sent.
 */
const SYNC_ALARM = 'profile-sync';
const SYNC_EVERY_MINUTES = 2;

async function backgroundPull() {
    try {
        const s = await EasyApplyCloud.status();
        if (!s.signedIn || !(await EasyApplyCloud.hasPermission())) return;
        await EasyApplyCloudSync.pullIfNewer(EasyApplyCloud);
    } catch (e) {
        // Offline or signed out mid-way: the next alarm or panel open tries again.
    }
}

async function ensureSyncAlarm() {
    if (!(await chrome.alarms.get(SYNC_ALARM))) {
        await chrome.alarms.create(SYNC_ALARM, { periodInMinutes: SYNC_EVERY_MINUTES });
    }
}

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === SYNC_ALARM) backgroundPull(); });
chrome.runtime.onStartup.addListener(backgroundPull);
ensureSyncAlarm();

/**
 * ADAPTER PACK (plan/Phase 3 Contracts.md §1). Downloads the signed Workday
 * pack (data only: automation ids, label aliases, regex sources) at browser
 * start, at install/update and every 6 hours. Anonymous GET of a static file:
 * no account, profile or page data is sent. Stored only if the Ed25519
 * signature over the exact bytes checks out against the bundled public key and
 * the pack passes the rules in adapters/verify-pack.js. Any failure keeps the
 * previous pack and is logged to the console only. An HTTP 200 alone means
 * nothing: CloudFront answers a missing file with the dashboard's index.html.
 */
importScripts('adapters/public-key.js', 'adapters/workday-pack.js', 'adapters/verify-pack.js');

const ADAPTER_ALARM = 'adapter-pack';
const ADAPTER_EVERY_MINUTES = 6 * 60;

async function refreshAdapterPack() {
    try {
        const url = EASYAPPLY_CLOUD_CONFIG.adapterPackUrl;
        const bundled = self.EASYAPPLY_ADAPTER_BUNDLED;
        if (!url || !bundled) return;
        const opts = {
            ats: bundled.ats,
            bundledVersion: bundled.version,
            extensionVersion: chrome.runtime.getManifest().version,
            publicKey: self.EASYAPPLY_ADAPTER_PUBLIC_KEY
        };
        const { adapterPack: stored } = await chrome.storage.local.get('adapterPack');
        // A pack the installed extension has caught up with is dead weight.
        if (stored && EasyApplyAdapterVerify.checkPack(stored, opts)) await chrome.storage.local.remove('adapterPack');
        const current = stored && !EasyApplyAdapterVerify.checkPack(stored, opts) ? stored.version : bundled.version;

        const get = (u) => fetch(u, { cache: 'no-cache', credentials: 'omit', redirect: 'error' });
        const [packRes, sigRes] = await Promise.all([get(url), get(`${url}.sig`)]);
        if (!packRes.ok || !sigRes.ok) { console.log(`Workday Autofill: adapter pack not fetched (HTTP ${packRes.status}/${sigRes.status})`); return; }
        const bytes = new Uint8Array(await packRes.arrayBuffer());
        const sig = (await sigRes.text()).slice(0, 200);
        const { pack, error } = await EasyApplyAdapterVerify.acceptPackBytes(bytes, sig, opts);
        if (error) { console.log(`Workday Autofill: adapter pack rejected (${error}); keeping v${current}`); return; }
        // Never step back to an older signed pack than the one in use.
        if (pack.version <= current) return;
        await chrome.storage.local.set({ adapterPack: pack });
        console.log(`Workday Autofill: adapter pack v${pack.version} stored (was v${current})`);
    } catch (e) {
        console.log('Workday Autofill: adapter pack refresh failed', e && e.message);
    }
}

async function ensureAdapterAlarm() {
    if (!(await chrome.alarms.get(ADAPTER_ALARM))) {
        await chrome.alarms.create(ADAPTER_ALARM, { periodInMinutes: ADAPTER_EVERY_MINUTES });
    }
}

chrome.alarms.onAlarm.addListener((alarm) => { if (alarm.name === ADAPTER_ALARM) refreshAdapterPack(); });
chrome.runtime.onStartup.addListener(refreshAdapterPack);
chrome.runtime.onInstalled.addListener(refreshAdapterPack);
ensureAdapterAlarm();
