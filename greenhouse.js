// Greenhouse Autofill - Content Script (isolated world)
/**
 * GREENHOUSE JOB BOARD ADAPTER
 *
 * Registered dynamically (see background.js) only after the user opts in to
 * Greenhouse support and grants the optional host permission.
 *
 * Two Greenhouse generations are supported:
 *  - Legacy boards:  boards.greenhouse.io — plain HTML form, native <select>
 *    elements with stable IDs (e.g. #job_application_gender). Filled directly
 *    from this script.
 *  - New boards:     job-boards.greenhouse.io — React (Remix) app where every
 *    dropdown is a react-select combobox that ignores synthetic DOM events.
 *    Those are filled by greenhouse-main.js, which runs in the page's MAIN
 *    world and drives react-select's own selectOption() API via React fiber
 *    internals. This script talks to it with window.postMessage.
 *
 * Also runs inside iframes (allFrames: true) because many companies embed the
 * Greenhouse form on their own careers page.
 */
(function () {
    if (window.__ghAutofillLoaded) return;
    window.__ghAutofillLoaded = true;
    console.log('Greenhouse Autofill: content script loaded on', location.hostname);

    let ghProfile = {};
    let ghIsFilling = false;

    chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
        if (request.action === 'fill_form') {
            // Only act in the frame that actually contains the application form
            if (!document.querySelector('form input, form select, form textarea')) return;

            console.log('Greenhouse Autofill: Received fill_form request.');
            chrome.storage.local.get(
                ['personalInfo', 'address', 'education', 'workExperience', 'skills', 'language', 'jobPreferences', 'demographics', 'resume', 'resumeMeta'],
                (result) => {
                    ghProfile = result;
                    ghFillAll();
                    sendResponse({ status: 'started' });
                }
            );
            return true; // Keep channel open for async response
        }
    });

    async function ghFillAll() {
        if (ghIsFilling) return;
        ghIsFilling = true;
        console.log('Greenhouse Autofill: Scanning page...');

        try {
            ghFillPersonalInfo();
            ghFillLocation();
            ghUploadResume();
            ghFillLegacySelects();
            await ghFillComboboxes();
        } catch (e) {
            console.error('Greenhouse Autofill: Error during fill', e);
        }

        console.log('Greenhouse Autofill: Scan completed.');
        ghIsFilling = false;

        try {
            chrome.runtime.sendMessage({ action: 'fill_complete' }, () => {
                void chrome.runtime.lastError;
            });
        } catch (e) { /* panel closed */ }
    }

    /**
     * 1. TEXT FIELDS
     * Both board generations use stable ids: #first_name, #last_name, #email, #phone
     */
    function ghFillPersonalInfo() {
        const info = ghProfile.personalInfo;
        if (!info) return;

        ghFillTextField(['first_name'], ['first name'], info.firstName);
        ghFillTextField(['last_name'], ['last name'], info.lastName);
        ghFillTextField(['email'], ['email'], info.email);
        ghFillTextField(['phone'], ['phone'], info.phone);

        if (info.linkedinUrl) {
            ghFillTextField([], ['linkedin'], info.linkedinUrl);
            ghFillTextField([], ['website', 'portfolio'], info.linkedinUrl);
        }
    }

    function ghFillLocation() {
        const addr = ghProfile.address;
        if (!addr || !addr.city) return;
        const locationStr = [addr.city, addr.state].filter(Boolean).join(', ');
        ghFillTextField(['job_application_location', 'candidate-location'], ['location (city)', 'location', 'city'], locationStr);
    }

    /**
     * 2. RESUME UPLOAD
     */
    function ghUploadResume() {
        if (!ghProfile.resume || !ghProfile.resumeMeta) return;

        const fileInputs = Array.from(document.querySelectorAll('input[type="file"]'));
        if (fileInputs.length === 0) return;

        // Prefer an input explicitly tied to the resume (not the cover letter)
        let target = fileInputs.find(input => {
            const idName = `${input.id} ${input.name} ${input.getAttribute('aria-label') || ''}`.toLowerCase();
            return /resume|cv/.test(idName);
        });
        if (!target) target = fileInputs[0];
        if (target.files.length > 0) return; // Already has a file

        try {
            const byteString = atob(ghProfile.resume.split(',')[1]);
            const mimeString = ghProfile.resume.split(',')[0].split(':')[1].split(';')[0];
            const ia = new Uint8Array(byteString.length);
            for (let i = 0; i < byteString.length; i++) ia[i] = byteString.charCodeAt(i);
            const file = new File([ia], ghProfile.resumeMeta.name, {
                type: mimeString,
                lastModified: ghProfile.resumeMeta.lastModified
            });

            const list = new DataTransfer();
            list.items.add(file);
            target.files = list.files;
            target.dispatchEvent(new Event('change', { bubbles: true }));
            target.dispatchEvent(new Event('input', { bubbles: true }));
            console.log('Greenhouse Autofill: Uploaded resume', ghProfile.resumeMeta.name);
        } catch (e) {
            console.error('Greenhouse Autofill: Failed to upload resume', e);
        }
    }

    /**
     * 3. LEGACY BOARDS: native <select> elements and radio groups
     */
    function ghFillLegacySelects() {
        if (document.querySelectorAll('select').length === 0) return; // New boards have none

        const demo = ghProfile.demographics || {};
        const prefs = ghProfile.jobPreferences || {};
        const decline = !!prefs.autoDisclosures;

        const fill = (id, labelKeys, value) => {
            if (!value) return;
            let select = document.getElementById(id);
            if (!select) select = ghFindSelectByLabel(labelKeys);
            if (select) ghFillSelectFuzzy(select, value);
        };

        fill('job_application_gender', ['gender'], demo.gender || (decline ? 'Decline To Self Identify' : ''));
        fill('job_application_hispanic_ethnicity', ['hispanic'], demo.hispanicLatino || (decline ? 'Decline To Self Identify' : ''));
        fill('job_application_race', ['race', 'ethnicity'], demo.race || (decline ? 'Decline To Self Identify' : ''));
        if (decline) {
            fill('job_application_veteran_status', ['veteran'], "I don't wish to answer");
            fill('job_application_disability_status', ['disability'], 'I do not want to answer');
        }

        // Education static selects (legacy)
        const edu = ghProfile.education && ghProfile.education[0];
        if (edu) {
            if (edu.degree) ghFillSelectFuzzy(document.getElementById('education_degree_0'), edu.degree);
            if (edu.fieldOfStudy) ghFillSelectFuzzy(document.getElementById('education_discipline_0'), edu.fieldOfStudy);
            if (edu.startDate) {
                ghFillSelectFuzzy(document.getElementById('education_start_month_0'), edu.startDate.month);
                ghFillSelectFuzzy(document.getElementById('education_start_year_0'), edu.startDate.year);
            }
            if (edu.endDate) {
                ghFillSelectFuzzy(document.getElementById('education_end_month_0'), edu.endDate.month);
                ghFillSelectFuzzy(document.getElementById('education_end_year_0'), edu.endDate.year);
            }
        }

        // Custom-question selects answered by label keywords
        document.querySelectorAll('select').forEach(select => {
            if (select.value) return; // Don't overwrite
            const label = ghLabelTextForElement(select).toLowerCase();
            const spec = ghDesiredValueForLabel(label);
            if (spec) ghFillSelectFuzzy(select, spec.values[0]);
        });
    }

    /**
     * 4. NEW BOARDS: react-select comboboxes, delegated to the MAIN world
     * helper (greenhouse-main.js) which calls react-select's selectOption().
     */
    async function ghFillComboboxes() {
        const inputs = document.querySelectorAll('input[role="combobox"], input[aria-autocomplete="list"]');
        if (inputs.length === 0) return;

        const items = [];
        inputs.forEach((input, index) => {
            if (input.type === 'search') return; // intl-tel-input's internal search box
            const label = ghLabelTextForElement(input).toLowerCase();
            const spec = ghDesiredValueForLabel(label);
            if (spec) items.push({ id: input.id || null, index, label: label.slice(0, 60), ...spec });
        });

        if (items.length === 0) return;
        console.log(`Greenhouse Autofill: Sending ${items.length} dropdown(s) to main-world helper...`, items.map(i => i.label));

        const results = await ghRunMainWorldSelects(items);
        if (results === null) {
            console.warn('Greenhouse Autofill: main-world helper did not respond — dropdowns were not filled. Try refreshing the page.');
        } else {
            results.forEach(r => {
                if (!r.ok) console.warn(`Greenhouse Autofill: dropdown "${r.label}" not filled — ${r.reason}`);
            });
        }
    }

    function ghRunMainWorldSelects(items) {
        return new Promise((resolve) => {
            const timeout = setTimeout(() => {
                window.removeEventListener('message', handler);
                resolve(null);
            }, 25000);
            const handler = (ev) => {
                if (ev.source !== window || !ev.data || ev.data.type !== 'GH_AUTOFILL_SELECT_RESULT') return;
                clearTimeout(timeout);
                window.removeEventListener('message', handler);
                resolve(ev.data.results);
            };
            window.addEventListener('message', handler);
            window.postMessage({ type: 'GH_AUTOFILL_SELECT', items }, '*');
        });
    }

    /**
     * Map a question label to the user's configured answer.
     * Returns { values: [candidates...], declineOk?, acceptFirst? } or null.
     * Never invents answers: demographic questions are only filled when the
     * user configured them (or enabled the decline-all master toggle).
     */
    function ghDesiredValueForLabel(label) {
        if (!label) return null;
        const prefs = ghProfile.jobPreferences || {};
        const demo = ghProfile.demographics || {};
        const addr = ghProfile.address || {};
        const edu = (ghProfile.education && ghProfile.education[0]) || {};
        const decline = !!prefs.autoDisclosures;
        const declineValues = ['Decline To Self Identify', "I don't wish to answer", 'I do not want to answer', 'Prefer not to say'];

        const has = (...keys) => keys.some(k => label.includes(k));

        if (has('sponsor', 'visa', 'immigration'))
            return { values: [prefs.requiresSponsorship ? 'Yes' : 'No'] };
        if (has('authoriz', 'eligible to work', 'right to work', 'lawfully'))
            return { values: [prefs.authorizedToWork !== false ? 'Yes' : 'No'] };
        if (has('18 years', 'age or older'))
            return { values: ['Yes'] };
        if (has('former employee', 'previously employed', 'worked here', 'previously worked'))
            return { values: [prefs.formerEmployee ? 'Yes' : 'No'] };
        if (has('hear about'))
            return prefs.sourceReferral ? { values: [prefs.sourceReferral, 'Other'] } : null;
        if (has('hispanic', 'latino'))
            return (demo.hispanicLatino || decline) ? { values: [demo.hispanicLatino || ''].filter(Boolean).concat(decline ? declineValues : []), declineOk: decline } : null;
        if (has('gender')) {
            if (!demo.gender && !decline) return null;
            const alts = demo.gender === 'Male' ? ['Male', 'Man'] : demo.gender === 'Female' ? ['Female', 'Woman'] : [demo.gender].filter(Boolean);
            return { values: alts.concat(decline && !demo.gender ? declineValues : []), declineOk: decline && !demo.gender };
        }
        if (has('veteran'))
            return decline ? { values: declineValues.concat(['I am not a veteran']), declineOk: true } : null;
        if (has('disab'))
            return decline ? { values: declineValues, declineOk: true } : null;
        if (has('race', 'ethnic'))
            return (demo.race || decline) ? { values: [demo.race || ''].filter(Boolean).concat(decline ? declineValues : []), declineOk: decline } : null;
        if (has('school', 'university', 'institution'))
            return edu.school ? { values: [edu.school], acceptFirst: true } : null;
        if (has('degree'))
            return edu.degree ? { values: [edu.degree] } : null;
        if (has('discipline', 'field of study', 'major'))
            return edu.fieldOfStudy ? { values: [edu.fieldOfStudy], acceptFirst: true } : null;
        if (has('country'))
            return addr.country ? { values: [addr.country] } : null;

        return null;
    }

    /* ============================ HELPERS ============================ */

    function ghNorm(s) {
        return (s || '').toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    function ghIsDeclineIntent(value) {
        return /decline|do not wish|don'?t wish|do not want|prefer not/i.test(value);
    }

    // React-compatible value setter: the _valueTracker reset is required or
    // React dedupes the input event and ignores the new value.
    function ghSetNativeValue(element, value) {
        const lastValue = element.value;
        const proto = element instanceof HTMLTextAreaElement ? window.HTMLTextAreaElement.prototype
            : element instanceof HTMLSelectElement ? window.HTMLSelectElement.prototype
                : window.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        if (setter) setter.call(element, value);
        else element.value = value;

        const tracker = element._valueTracker;
        if (tracker) tracker.setValue(lastValue);

        element.dispatchEvent(new Event('input', { bubbles: true }));
        element.dispatchEvent(new Event('change', { bubbles: true }));
    }

    function ghLabelTextForElement(el) {
        if (el.id) {
            const label = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
            if (label) return label.innerText || '';
        }
        const labelledBy = el.getAttribute('aria-labelledby');
        if (labelledBy) {
            const ref = document.getElementById(labelledBy.split(' ')[0]);
            if (ref) return ref.innerText || '';
        }
        const aria = el.getAttribute('aria-label');
        if (aria) return aria;
        const wrapped = el.closest('label');
        if (wrapped) return wrapped.innerText || '';
        const container = el.closest('div.field, fieldset, div');
        if (container) {
            const label = container.querySelector('label');
            if (label) return label.innerText || '';
        }
        return '';
    }

    function ghFillTextField(ids, labelKeys, value) {
        if (!value) return;

        for (const id of ids) {
            const el = document.getElementById(id);
            if (el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.getAttribute('role') !== 'combobox') {
                if (el.value !== value) ghSetNativeValue(el, value);
                return;
            }
        }

        if (labelKeys.length === 0) return;
        const inputs = document.querySelectorAll('input:not([type="file"]):not([type="checkbox"]):not([type="radio"]):not([type="hidden"]):not([role="combobox"]), textarea');
        for (const input of inputs) {
            const label = ghLabelTextForElement(input).toLowerCase();
            if (labelKeys.some(k => label.includes(k))) {
                if (input.value !== value) ghSetNativeValue(input, value);
                return;
            }
        }
    }

    function ghFillSelectFuzzy(select, desired) {
        if (!select || select.tagName !== 'SELECT' || !desired) return false;

        const options = Array.from(select.options);
        const target = ghNorm(desired);

        let match = options.find(o => ghNorm(o.textContent) === target || ghNorm(o.value) === target);
        if (!match) {
            match = options.find(o => {
                const t = ghNorm(o.textContent);
                return t && o.value && (t.includes(target) || target.includes(t));
            });
        }
        if (!match) {
            const keyword = (desired.match(/bachelor|master|associate|doctor|phd|high school|mba|juris/i) || [])[0];
            if (keyword) match = options.find(o => o.textContent.toLowerCase().includes(keyword.toLowerCase()));
        }
        if (!match && ghIsDeclineIntent(desired)) {
            match = options.find(o => ghIsDeclineIntent(o.textContent));
        }

        if (match) {
            if (select.value !== match.value) ghSetNativeValue(select, match.value);
            console.log(`Greenhouse Autofill: Selected "${match.textContent.trim()}" for`, select.id || select.name);
            return true;
        }
        return false;
    }

    function ghFindSelectByLabel(labelKeys) {
        for (const select of document.querySelectorAll('select')) {
            const label = ghLabelTextForElement(select).toLowerCase();
            if (labelKeys.some(k => label.includes(k))) return select;
        }
        return null;
    }
})();
