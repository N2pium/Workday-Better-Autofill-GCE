// Better Autofill - content script for opt-in job sites filled by form-filler.js
/**
 * JOB SITE ADAPTER: iCIMS and Paylocity
 *
 * Registered dynamically (background.js) only after the person turns the site
 * on under Settings > Job sites and grants its optional host permission:
 *  - iCIMS      *://*.icims.com/*        (all frames: companies embed the
 *                                          application in an iframe, ?in_iframe=1)
 *  - Paylocity  *.paylocity.com recruiting pages only (/Recruiting/ and
 *               /recruiting/ paths; never Paylocity's payroll or employee sites)
 *
 * The filling itself is form-filler.js, which matches fields by their labels.
 * This file decides which frame acts, leaves sign-in and account pages alone
 * (passwords and captchas are always the person's), and reports back to the
 * side panel the same way content.js does. A multi-page application is filled
 * one page at a time, when the person presses Autofill on it.
 */
(function () {
    if (window.__jobSiteAutofillLoaded) return;
    window.__jobSiteAutofillLoaded = true;

    const Filler = self.EasyApplyFormFiller;
    const SITE = /(^|\.)icims\.com$/i.test(location.hostname) ? 'icims'
        : /(^|\.)paylocity\.com$/i.test(location.hostname) ? 'paylocity' : 'other';
    const SITE_NAME = { icims: 'iCIMS', paylocity: 'Paylocity' }[SITE] || 'this site';
    const PROFILE_KEYS = ['personalInfo', 'address', 'education', 'workExperience', 'skills', 'language',
        'jobPreferences', 'demographics', 'resume', 'resumeMeta'];
    let filling = false;

    const visibleFields = () => Array.from(document.querySelectorAll('input, select, textarea, [role="combobox"]'))
        .filter((el) => Filler.isVisible(el) && !/^(hidden|submit|button|search)$/i.test(el.type || ''));

    /** The frame that holds a form worth filling: a sign-in gate, or two or more fields. */
    const hasForm = () => Filler.isSignInPage(document) || visibleFields().length >= 2;

    chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
        if (request.action !== 'fill_form') return;
        if (!hasForm()) return; // another frame answers
        chrome.storage.local.get(PROFILE_KEYS, (profile) => {
            sendResponse({ status: 'started' });
            run(profile);
        });
        return true;
    });

    async function run(profile) {
        if (filling) return;
        filling = true;
        let report;
        try {
            if (Filler.isSignInPage(document)) {
                report = {
                    site: SITE, page: 'Sign in', build: Filler.BUILD, at: new Date().toISOString(),
                    counts: { filled: 0, failed: 0, emptyRequired: 0 },
                    steps: [{ status: 'skipped', section: SITE_NAME, field: 'Sign-in page',
                        detail: `Sign in or create your ${SITE_NAME} account, then press Autofill on the next page.` }],
                    empty: []
                };
            } else {
                report = await Filler.fill(document, profile, { site: SITE, page: pageName() });
            }
        } catch (e) {
            console.error(`Better Autofill (${SITE_NAME}): fill failed`, e);
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
        const heading = SITE === 'paylocity'
            ? document.querySelector('.job-preview-title, .job-title, [class*="job-title"], h1')
            : document.querySelector('.iCIMS_Header h1, .iCIMS_JobHeader h1, h1.iCIMS_Header, h1');
        return {
            site: SITE,
            url: location.href,
            title: text(heading).slice(0, 200),
            company: '',
            pageTitle: (document.title || '').slice(0, 300)
        };
    }
})();
