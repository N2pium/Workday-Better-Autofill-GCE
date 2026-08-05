// Open the side panel when the toolbar icon is clicked.
// Unlike a popup, the side panel stays open while the user interacts with the page.
chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true })
    .catch((err) => console.error('Workday Autofill: sidePanel setup failed', err));

/**
 * GREENHOUSE SUPPORT (opt-in)
 *
 * Greenhouse access is an optional host permission the user grants from the
 * side panel ("Supported Portals" section). The content script is registered
 * dynamically only after the permission is granted, and unregistered if the
 * user revokes it. This keeps the extension least-privilege: installing it
 * never requests Greenhouse access, and updates never disable the extension
 * for existing users.
 *
 * allFrames is required because many companies embed the Greenhouse form in
 * an iframe on their own careers page — the iframe still loads from
 * greenhouse.io, so the granted origin covers it.
 */
const GREENHOUSE_ORIGINS = [
    '*://boards.greenhouse.io/*',
    '*://job-boards.greenhouse.io/*'
];

// Two scripts: greenhouse.js (isolated world — chrome APIs, messaging, text
// fields) and greenhouse-main.js (MAIN world — drives react-select components
// on job-boards.greenhouse.io via React internals, which are invisible from
// the isolated world). They communicate over window.postMessage.
const GREENHOUSE_SCRIPTS = [
    {
        id: 'greenhouse-autofill',
        matches: GREENHOUSE_ORIGINS,
        js: ['greenhouse.js'],
        runAt: 'document_end',
        allFrames: true
    },
    {
        id: 'greenhouse-autofill-main',
        matches: GREENHOUSE_ORIGINS,
        js: ['greenhouse-main.js'],
        runAt: 'document_end',
        allFrames: true,
        world: 'MAIN'
    }
];

async function syncGreenhouseRegistration() {
    try {
        const granted = await chrome.permissions.contains({ origins: GREENHOUSE_ORIGINS });
        const ids = GREENHOUSE_SCRIPTS.map(s => s.id);
        const registered = await chrome.scripting.getRegisteredContentScripts({ ids });

        if (granted && registered.length < GREENHOUSE_SCRIPTS.length) {
            const missing = GREENHOUSE_SCRIPTS.filter(s => !registered.some(r => r.id === s.id));
            await chrome.scripting.registerContentScripts(missing);
            console.log('Workday Autofill: Greenhouse content scripts registered.');
        } else if (!granted && registered.length > 0) {
            await chrome.scripting.unregisterContentScripts({ ids: registered.map(r => r.id) });
            console.log('Workday Autofill: Greenhouse content scripts unregistered.');
        }
    } catch (err) {
        console.error('Workday Autofill: Greenhouse registration sync failed', err);
    }
}

// When the user grants the permission, also inject into Greenhouse tabs that
// are already open, so autofill works immediately without a manual refresh.
// (Both scripts are no-ops if already present — they guard with a window flag.)
async function injectIntoOpenGreenhouseTabs() {
    try {
        const granted = await chrome.permissions.contains({ origins: GREENHOUSE_ORIGINS });
        if (!granted) return;

        const tabs = await chrome.tabs.query({ url: GREENHOUSE_ORIGINS });
        for (const tab of tabs) {
            try {
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    files: ['greenhouse.js']
                });
                await chrome.scripting.executeScript({
                    target: { tabId: tab.id, allFrames: true },
                    files: ['greenhouse-main.js'],
                    world: 'MAIN'
                });
            } catch (e) { /* tab may be discarded or navigating */ }
        }
    } catch (err) {
        console.error('Workday Autofill: injection into open tabs failed', err);
    }
}

async function onPermissionsChanged() {
    await syncGreenhouseRegistration();
    await injectIntoOpenGreenhouseTabs();
}

chrome.runtime.onInstalled.addListener(onPermissionsChanged);
chrome.runtime.onStartup.addListener(syncGreenhouseRegistration);
chrome.permissions.onAdded.addListener(onPermissionsChanged);
chrome.permissions.onRemoved.addListener(syncGreenhouseRegistration);
