// Better Autofill - iCIMS content script (isolated world)
/**
 * ICIMS JOB PORTAL ADAPTER
 *
 * Registered dynamically (background.js) only after the user turns iCIMS on
 * under Settings > Job sites and grants the optional host permission
 * *://*.icims.com/*. Runs in every frame, because companies usually embed the
 * iCIMS application in an iframe (?in_iframe=1) on their own careers site.
 *
 * The filling itself is form-filler.js, which matches fields by their labels.
 * This file decides which frame acts, leaves iCIMS's sign-in and account pages
 * alone (passwords and hCaptcha are always the person's), and reports back to
 * the side panel the same way content.js does.
 *
 * An iCIMS application is several pages behind an iCIMS sign-in. Each page is
 * filled when the person presses Autofill on it.
 */
(function () {
    if (window.__icimsAutofillLoaded) return;
    window.__icimsAutofillLoaded = true;

    const Filler = self.EasyApplyFormFiller;
    const PROFILE_KEYS = ['personalInfo', 'address', 'education', 'workExperience', 'skills', 'language',
        'jobPreferences', 'demographics', 'resume', 'resumeMeta'];
    let filling = false;

    const visibleFields = () => Array.from(document.querySelectorAll('input, select, textarea'))
        .filter((el) => Filler.isVisible(el) && !/^(hidden|submit|button|search)$/i.test(el.type));

    /** The frame that holds a form worth filling: a sign-in gate, or two or more fields. */
    const hasForm = () => Filler.isSignInPage(document) || visibleFields().length >= 2;

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (request.action !== 'fill_form') return;
        if (!hasForm()) return; // another frame answers
        chrome.storage.local.get(PROFILE_KEYS, (profile) => {
            run(profile);
            sendResponse({ status: 'started' });
        });
        return true;
    });

    function run(profile) {
        if (filling) return;
        filling = true;
        let report;
        try {
            if (Filler.isSignInPage(document)) {
                report = {
                    site: 'icims', page: 'Sign in', build: Filler.BUILD, at: new Date().toISOString(),
                    counts: { filled: 0, failed: 0, emptyRequired: 0 },
                    steps: [{ status: 'skipped', section: 'iCIMS', field: 'Sign-in page',
                        detail: 'Sign in or create your iCIMS account, then press Autofill on the next page.' }],
                    empty: []
                };
            } else {
                report = Filler.fill(document, profile, { site: 'icims', page: pageName() });
            }
        } catch (e) {
            console.error('Better Autofill (iCIMS): fill failed', e);
        } finally {
            filling = false;
        }
        try {
            const job = report && report.page !== 'Sign in' ? jobInfo() : null;
            chrome.runtime.sendMessage({ action: 'fill_complete', report, job }, () => void chrome.runtime.lastError);
        } catch (e) { /* the side panel is closed */ }
    }

    const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');

    function pageName() {
        const h = document.querySelector('h1, h2, .iCIMS_Header, [class*="PageTitle"]');
        return text(h).slice(0, 80);
    }

    /** What the page says about the job, for the tracker (cloud-tracker.js). */
    function jobInfo() {
        const heading = document.querySelector('.iCIMS_Header h1, .iCIMS_JobHeader h1, h1.iCIMS_Header, h1');
        return {
            site: 'icims',
            url: location.href,
            title: text(heading).slice(0, 200),
            company: '',
            pageTitle: (document.title || '').slice(0, 300)
        };
    }
})();
