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
            ghFillEducationTextFields();
            ghFillCheckboxGroups();
            await ghFillComboboxes();
        } catch (e) {
            console.error('Greenhouse Autofill: Error during fill', e);
        }

        console.log('Greenhouse Autofill: Scan completed.');
        ghIsFilling = false;

        try {
            chrome.runtime.sendMessage({ action: 'fill_complete', job: ghJobInfo() }, () => {
                void chrome.runtime.lastError;
            });
        } catch (e) { /* panel closed */ }
    }

    // What the page says about the job, for the application tracker (cloud-tracker.js).
    function ghJobInfo() {
        const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
        const heading = document.querySelector('.app-title, .job__title h1, .job-title, h1');
        const company = document.querySelector('.company-name, .job__company, [class*="company-name"]');
        return {
            site: 'greenhouse',
            url: location.href,
            title: text(heading).slice(0, 200),
            company: text(company).replace(/^at\s+/i, '').slice(0, 200),
            pageTitle: (document.title || '').slice(0, 300)
        };
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

        // LinkedIn and the personal website are separate profile fields. The
        // website box used to be given the LinkedIn URL unconditionally; the
        // fallback below keeps that behaviour only when no website is stored.
        if (info.linkedinUrl) ghFillTextField([], ['linkedin'], info.linkedinUrl);
        const siteUrl = info.websiteUrl || info.linkedinUrl;
        if (siteUrl) ghFillTextField([], ['website', 'portfolio'], siteUrl);
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
            if (edu.degree) ghFillSelectSpec(document.getElementById('education_degree_0'), ghDegreeSpec(edu.degree));
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
     * 3b. EDUCATION YEARS (and a free-text GPA)
     * Greenhouse renders the year fields as plain text inputs, so neither the
     * <select> pass nor the combobox pass reaches them.
     */
    function ghFillEducationTextFields() {
        const edu = (ghProfile.education && ghProfile.education[0]) || {};
        if (!edu.startDate && !edu.endDate && !edu.gpa) return;

        const inputs = document.querySelectorAll(
            'input[type="text"], input[type="number"], input:not([type])'
        );

        inputs.forEach(input => {
            if (input.value) return;                                        // never overwrite
            if (input.getAttribute('role') === 'combobox') return;
            if (input.getAttribute('aria-autocomplete') === 'list') return;

            const label = ghLabelTextForElement(input).toLowerCase();
            if (!label) return;
            const has = (...k) => k.some(s => label.includes(s));

            // Don't let school dates leak into an employment-history section
            if (has('employment', 'work experience', 'employer', 'company', 'position')) return;

            const wantsEnd = has('graduat') || has('end', 'completion', 'finish');
            const wantsStart = has('start', 'began');

            let value = '';
            if (has('year')) {
                if (wantsEnd) value = edu.endDate && edu.endDate.year;
                else if (wantsStart) value = edu.startDate && edu.startDate.year;
            } else if (has('month')) {
                // A text month box takes the numeric form the profile stores;
                // only dropdowns need the month name.
                if (wantsEnd) value = edu.endDate && edu.endDate.month;
                else if (wantsStart) value = edu.startDate && edu.startDate.month;
            } else if (has('gpa', 'grade point')) {
                value = edu.gpa;                                            // banded dropdowns go through the combobox pass
            }

            if (value) {
                ghSetNativeValue(input, String(value));
                console.log(`Greenhouse Autofill: "${label.slice(0, 40)}" -> ${value}`);
            }
        });
    }

    /**
     * 3c. "How did you hear about <company>?" is a select-all-that-apply
     * checkbox group, not a dropdown, so the combobox pass never sees it.
     * Tick only the box matching the user's configured referral source.
     */
    function ghFillCheckboxGroups() {
        const prefs = ghProfile.jobPreferences || {};
        const source = prefs.sourceReferral;
        if (!source) return;

        const boxes = Array.from(document.querySelectorAll('input[type="checkbox"]'));
        if (!boxes.length) return;

        const groups = new Map();
        boxes.forEach(box => {
            const q = ghQuestionTextForElement(box);
            if (!groups.has(q)) groups.set(q, []);
            groups.get(q).push(box);
        });

        groups.forEach((items, question) => {
            if (!/hear about/i.test(question)) return;
            if (items.some(b => b.checked)) return;   // already answered

            const s = ghNorm(source);
            const target =
                items.find(b => ghNorm(ghLabelTextForElement(b)) === s) ||
                items.find(b => {
                    const l = ghNorm(ghLabelTextForElement(b));
                    return l && s && (l.includes(s) || s.includes(l));
                }) ||
                items.find(b => /other/i.test(ghLabelTextForElement(b)));

            if (target && !target.checked) {
                target.click();   // click() so React's onChange handler runs
                console.log(`Greenhouse Autofill: checked "${ghLabelTextForElement(target).trim()}"`);
            }
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

        // Authorization is tested FIRST, and a question that asks about both is
        // an authorization question. Workday and Greenhouse alike ask them in
        // one sentence -- "Are you legally authorized to work in the US without
        // requiring sponsorship?" -- and with the sponsorship test first that
        // block answered No, which is the "legally authorized ... mysteriously
        // No" the user reported on 2026-08-24. content.js carries the same fix.
        const asksAuth = has('authoriz', 'eligible to work', 'right to work', 'lawfully');
        const asksSponsor = has('sponsor', 'visa', 'immigration');

        if (asksAuth) {
            // Compound question: Yes only when both halves hold. Answering Yes
            // while sponsorship is still needed is a false statement.
            const yes = asksSponsor
                ? (prefs.authorizedToWork !== false && !prefs.requiresSponsorship)
                : prefs.authorizedToWork !== false;
            return { values: [yes ? 'Yes' : 'No'] };
        }
        if (asksSponsor)
            return { values: [prefs.requiresSponsorship ? 'Yes' : 'No'] };
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
        // --- Education dates / GPA -------------------------------------
        // Only claim a date field if it clearly belongs to education. A form
        // that also asks for employment dates would otherwise get the school
        // dates written into it.
        const isEmploymentDate = has('employment', 'work experience', 'job title', 'employer', 'company', 'position');
        if (!isEmploymentDate) {
            // Deliberately narrow. A miss just means the user fills that one
            // field by hand; a false positive puts wrong dates on a real job
            // application, so loose matches like "to"/"from" are not used.
            const graduation = has('graduat');
            const wantsEnd = graduation || has('end', 'completion', 'finish');
            const wantsStart = has('start', 'began');

            if (has('month')) {
                if (wantsEnd) {
                    const c = ghMonthCandidates(edu.endDate && edu.endDate.month);
                    if (c.length) return { values: c };
                }
                if (wantsStart) {
                    const c = ghMonthCandidates(edu.startDate && edu.startDate.month);
                    if (c.length) return { values: c };
                }
            }
            // Years are usually plain text boxes (handled in
            // ghFillEducationTextFields) but some boards use a dropdown.
            if (has('year')) {
                if (wantsEnd && edu.endDate && edu.endDate.year)
                    return { values: [String(edu.endDate.year)] };
                if (wantsStart && edu.startDate && edu.startDate.year)
                    return { values: [String(edu.startDate.year)] };
            }
        }
        if (has('gpa', 'grade point')) {
            const c = ghGpaCandidates(edu.gpa);
            if (c.length) return { values: c };
            return null;
        }

        if (has('school', 'university', 'institution'))
            return edu.school ? { values: [edu.school], acceptFirst: true } : null;
        // Boards label this "Degree", but just as often "Highest Level of
        // Education" or "Education Level", which the old check never matched.
        if (has('degree', 'level of education', 'education level', 'highest level', 'qualification'))
            return ghDegreeSpec(edu.degree);
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

    const GH_MONTH_NAMES = ['January', 'February', 'March', 'April', 'May', 'June',
        'July', 'August', 'September', 'October', 'November', 'December'];

    /**
     * Greenhouse renders month pickers as dropdowns of month NAMES, but the
     * profile stores a numeric month ("09"). Return name-first candidates so a
     * name dropdown matches exactly, with the numeric forms kept as fallbacks
     * for boards that list "01".."12" instead.
     */
    function ghMonthCandidates(month) {
        if (!month) return [];
        const raw = String(month).trim();
        const n = parseInt(raw.replace(/\D/g, ''), 10);
        if (n >= 1 && n <= 12) {
            const name = GH_MONTH_NAMES[n - 1];
            return [name, name.slice(0, 3), String(n).padStart(2, '0'), String(n)];
        }
        const byName = GH_MONTH_NAMES.find(m => ghNorm(m) === ghNorm(raw) || ghNorm(m).startsWith(ghNorm(raw)));
        return byName ? [byName, byName.slice(0, 3)] : [];
    }

    /**
     * The profile stores verbose degree names ("Bachelor of Science") but most
     * boards list coarse ones ("Bachelors", "Bachelors Degree"). Map the
     * profile value to a level, then offer that level's common spellings.
     *
     * Order is significant: pickOption returns on the first candidate that
     * matches anything, so canonical names go first and the user's verbose
     * original goes LAST. Leading with the verbose name lets its prefix
     * collide -- "Doctor of Philosophy" shares 9 characters with "Doctor of
     * Medicine" but only 6 with "Doctorate", so a PhD would land on MD.
     *
     * More specific levels are tested before the general ones they contain
     * (JD/MD before doctorate, MBA before master).
     *
     * `reject` drops options that merely CONTAIN a generic candidate but mean
     * something narrower -- "Accelerated Masters" contains "Masters", so a
     * plain MA would otherwise land on a programme the user was never in. If
     * rejecting leaves nothing, the field stays blank, which is the intended
     * outcome: the board simply has no option for this degree.
     */
    const GH_DEGREE_LEVELS = [
        { test: /high school|secondary|\bged\b/i,
          values: ['High School Diploma', 'High School', 'High School or equivalent', 'Secondary School', 'GED'] },
        { test: /juris doctor|\bjd\b|law degree/i,
          values: ['Juris Doctor', 'JD', 'Juris Doctor (JD)', 'Law Degree', 'Doctorate'] },
        { test: /doctor of medicine|\bmd\b/i,
          values: ['MD', 'Doctor of Medicine', 'Doctorate'] },
        { test: /master of business|\bmba\b/i,
          values: ['MBA', 'Master of Business Administration', 'Masters Degree', "Master's Degree", 'Masters'],
          reject: 'accelerated|dual|joint|combined' },
        { test: /doctor|doctorate|phd|ph\.d/i,
          values: ['Doctorate', 'Doctorate Degree', 'Doctoral Degree', 'PhD', 'Doctor of Philosophy'],
          reject: 'accelerated|dual|joint|combined' },
        { test: /master/i,
          values: ['Masters Degree', "Master's Degree", 'Masters', 'Master', 'Graduate Degree'],
          reject: 'accelerated|dual|joint|combined' },
        { test: /bachelor|\bba\b|\bbs\b/i,
          values: ['Bachelors Degree', "Bachelor's Degree", 'Bachelors', 'Bachelor', 'Undergraduate Degree'],
          reject: 'accelerated|dual|joint|combined' },
        { test: /associate|\baa\b|\bas\b/i,
          values: ['Associates Degree', "Associate's Degree", 'Associates', 'Associate'],
          reject: 'accelerated|dual|joint|combined' },
        { test: /certificate|certification/i,
          values: ['Certificate', 'Certification'],
          reject: 'advanced' },
    ];

    // Returns { values, reject? } or null.
    function ghDegreeSpec(degree) {
        if (!degree) return null;
        const level = GH_DEGREE_LEVELS.find(l => l.test.test(degree));
        const values = level ? level.values.slice() : [];
        if (!values.some(v => ghNorm(v) === ghNorm(degree))) values.push(degree);
        if (!values.length) return null;
        // Never reject on a word the user's own degree contains.
        const reject = level && level.reject && !new RegExp(level.reject, 'i').test(degree)
            ? level.reject : undefined;
        return reject ? { values, reject } : { values };
    }

    /**
     * GPA questions are a banded dropdown on a 4.0 scale, not a free number.
     * Returns [] for anything outside 0-4.0 (e.g. a 5.0- or 100-scale GPA)
     * rather than guessing a band, since a wrong GPA on a real application is
     * worse than an unanswered one.
     */
    function ghGpaCandidates(gpa) {
        if (!gpa) return [];
        const v = parseFloat(String(gpa).replace(/[^0-9.]/g, ''));
        if (!isFinite(v) || v <= 0 || v > 4.0) return [];
        if (v >= 3.6) return ['3.6-4.0', '3.6 - 4.0', '3.6+'];
        if (v >= 3.3) return ['3.3-3.59', '3.3 - 3.59'];
        if (v >= 3.0) return ['3.0-3.29', '3.0 - 3.29'];
        return ['2.99 or below', '2.99 and below', 'Below 3.0'];
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

    function ghFillSelectFuzzy(select, desired, reject) {
        if (!select || select.tagName !== 'SELECT' || !desired) return false;

        let options = Array.from(select.options);
        if (reject) {
            const re = new RegExp(reject, 'i');
            options = options.filter(o => !re.test(o.textContent || ''));
        }
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

    // The group-level question for a checkbox/radio, as opposed to the label
    // of the individual option.
    function ghQuestionTextForElement(el) {
        const fs = el.closest('fieldset');
        if (fs) {
            const legend = fs.querySelector('legend');
            if (legend && legend.innerText) return legend.innerText;
        }
        const grp = el.closest('[role="group"], fieldset');
        if (grp) {
            const aria = grp.getAttribute('aria-label');
            if (aria) return aria;
            const by = grp.getAttribute('aria-labelledby');
            if (by) {
                const ref = document.getElementById(by.split(' ')[0]);
                if (ref && ref.innerText) return ref.innerText;
            }
        }
        let node = el.parentElement;
        for (let i = 0; i < 5 && node; i++, node = node.parentElement) {
            const cand = node.querySelector('legend, label, h2, h3, h4');
            if (cand && !cand.contains(el) && cand.innerText) return cand.innerText;
        }
        return '';
    }

    // Try each spelling in order, stopping at the first that matches an option.
    function ghFillSelectSpec(select, spec) {
        if (!select || !spec || !spec.values) return false;
        for (const c of spec.values) {
            if (ghFillSelectFuzzy(select, c, spec.reject)) return true;
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
