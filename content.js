// Workday Autoplay - Content Script
/**
 * WORKDAY CHROME EXTENSION - ENHANCED AUTOMATION
 * 
 * This extension automatically fills Workday job application forms with the following features:
 * 
 * REQUIREMENT 1: Simplified Popup UI (popup.html)
 * - Job Preferences section with toggles for:
 *   • isAuthorized (Legally Authorized to Work)
 *   • needsSponsorship (Require Sponsorship)
 *   • isFormerEmployee (Former Employee status)
 * - Dropdown for referralSource (LinkedIn, Company Website, Indeed, Other)
 * - Master Toggle: declineDisclosures - When enabled, automatically selects
 *   "I decline to self-identify" for all legal disclosure forms
 * 
 * REQUIREMENT 2: Question & Answer Logic
 * - answerYesNo(questionText, userChoice): Helper function that finds question
 *   labels on the page and clicks corresponding "Yes" or "No" radio buttons
 * - Source Dropdown: Automatically locates "How did you hear about us" field
 *   and selects the user's preferred referral source
 * 
 * REQUIREMENT 3: Automated Disclosures
 * When declineDisclosures is TRUE:
 * - Disability: Selects "I DO NOT WISH TO ANSWER" or "No, I Don't Have A Disability"
 * - Veteran Status: Selects "I AM NOT A VETERAN" or "I DECLINE TO SELF-IDENTIFY"
 * - Race/Ethnicity: Selects "Decline to identify"
 * - Uses aria-label matching for highly standardized Workday fields
 * 
 * TECHNICAL NOTES:
 * - All settings stored in chrome.storage.local
 * - Workday uses React, so events must be dispatched properly
 * - MutationObserver ensures script runs on all pages (multi-page forms)
 * - Script re-scans when "Next" button is clicked or new content loads
 */


let userProfile = {};
let isScanning = false; // Guard flag to prevent infinite loops

// Question containers already answered during the current scan. One rule per
// question: whichever rule answers a block first owns it, and no later rule may
// overwrite that answer. Reset at the top of every scan.
let answeredQuestions = new WeakSet();

/*
 * FILL REPORT. Every fill step records how far it got, so a failure on a real
 * page says WHERE it failed (not found / no options / chose it but it didn't
 * stick) instead of silently looking like success. Labels and statuses only:
 * never the values written. Sent to the side panel with fill_complete.
 */
// Bump with every change to fill logic: the fill report carries it.
const FILL_BUILD = '2026-11-24d';
let fillTrace = [];
let traceSection = '';
const ABSENT = null; // a step whose field isn't on this page: not reported

async function step(field, run) {
    const warns = [];
    const orig = console.warn;
    console.warn = (...a) => {
        warns.push(a.filter(x => typeof x !== 'object').join(' ').replace(/^Workday Autoplay:\s*/, ''));
        orig.apply(console, a);
    };
    let result;
    try { result = await run(); }
    catch (e) { result = false; warns.push(e.message); }
    finally { console.warn = orig; }
    if (result === ABSENT || result === undefined && !warns.length) return result;
    // undefined with warnings: the step gave up part-way. That used to be
    // reported as 'filled', which is how Work Experience showed up as filled on
    // pages that have no Work Experience section at all.
    const status = result === false || result === undefined ? 'failed' : result === 'skipped' ? 'skipped' : 'filled';
    const why = warns[warns.length - 1] || (status === 'skipped' ? 'the field is here but nothing is saved for it in your profile' : '');
    fillTrace.push({ section: traceSection, field, status, detail: status === 'filled' ? '' : why.slice(0, 200) });
    return result;
}

/*
 * SCOPE. Lookups inside a repeated panel (Education 2, Work Experience 3) must
 * not find the same-named field in another panel. While a panel is being
 * filled, label/XPath lookups search only inside it. Dropdown option lists are
 * portalled to <body>, so those lookups stay document-wide on purpose.
 */
let SCOPE = document;
async function withScope(root, fn) {
    const prev = SCOPE;
    SCOPE = root || document;
    try { return await fn(); } finally { SCOPE = prev; }
}
let lastScannedUrl = ''; // Track URL to detect navigation
let hasUploadedResume = false; // Track resume upload status

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fill_form") {
        console.log("Workday Autoplay: Received fill_form request.");
        // Reload data to ensure freshness
        chrome.storage.local.get(['personalInfo', 'address', 'education', 'workExperience', 'skills', 'language', 'jobPreferences', 'demographics', 'resume', 'resumeMeta'], (result) => {
            userProfile = result;
            console.log('Workday Autoplay: Profile loaded for filling', userProfile);
            startObserver();
            scanAndFill();
            sendResponse({ status: "started" });
        });
        return true; // Keep channel open for async response
    }
});

async function scanAndFill() {
    // Guard: Prevent re-entry if already scanning
    if (isScanning) {
        console.log('Workday Autoplay: Scan already in progress, skipping.');
        return;
    }
    isScanning = true;

    // Disconnect observer during fill to prevent triggering ourselves
    if (observer) {
        observer.disconnect();
        console.log('Workday Autoplay: Observer paused.');
    }

    console.log('Workday Autoplay: Scanning page (Async Mode)...');

    // Mark this URL as scanned
    lastScannedUrl = window.location.href;

    // Fresh page, fresh set of answered questions.
    answeredQuestions = new WeakSet();
    fillTrace = [];
    traceSection = '';

    if (!userProfile) {
        isScanning = false;
        return;
    }

    // 1. Personal & Address
    traceSection = 'My Information';
    if (userProfile.personalInfo) {
        const p = userProfile.personalInfo;
        await step('First name', () => fillFieldByFuzzyLabel(['first name', 'given name'], p.firstName));
        await step('Last name', () => fillFieldByFuzzyLabel(['last name', 'family name', 'surname'], p.lastName));
        await step('Phone', () => fillFieldByFuzzyLabel(['phone', 'mobile'], p.phone));
        await step('Phone device type', async () => (await selectWorkdayDropdown('Phone Device Type', 'Mobile')) ?? selectWorkdayDropdown('Device Type', 'Mobile'));
        await step('Email', () => fillFieldByFuzzyLabel(['email'], p.email));

        // LinkedIn and the personal website are two different profile fields and
        // have to stay two different fields on the form. With no website stored,
        // a lone "Website" field still gets the LinkedIn URL (shipped behaviour).
        const linkedinUrl = p.linkedinUrl;
        const websiteUrl = p.websiteUrl;
        traceSection = 'Social Network URLs';
        await step('LinkedIn', async () => {
            const byLabel = fillFieldByFuzzyLabel(['linkedin'], linkedinUrl);
            const byId = fillByFieldId(/linked-?in/i, linkedinUrl);
            return byLabel === true || byId > 0 ? true : byLabel === 'skipped' ? 'skipped' : byLabel === false ? false : ABSENT;
        });
        traceSection = 'Websites';
        await step('Website', () => fillFieldByFuzzyLabel(['personal website', 'portfolio', 'website'], websiteUrl || linkedinUrl));
        await step('Websites section', () => handleWebsitesSection([linkedinUrl, websiteUrl]));
    }

    traceSection = 'My Information';
    if (userProfile.address) {
        const a = userProfile.address;
        await step('Address line 1', () => fillFieldByFuzzyLabel(['address line 1', 'street'], a.street));
        await step('City', () => fillFieldByFuzzyLabel(['city', 'town'], a.city));
        await step('Postal code', () => fillFieldByFuzzyLabel(['zip', 'postal code'], a.zip));
        await step('Country', () => handleDropdown(['country', 'region'], a.country));
        if (a.state) {
            await step('State', async () => (await selectWorkdayDropdown('State', a.state)) || selectWorkdayDropdown('Province', a.state));
        }
    }

    // 2. Work Experience. Every job in the profile, one Workday panel each.
    traceSection = 'Work Experience';
    if (userProfile.workExperience && userProfile.workExperience.length > 0) {
        await step('Work experience', () => handleWorkExperience(userProfile.workExperience));
    }

    // 3. Education. Every school, one panel each, opening panels with Education's own Add button.
    traceSection = 'Education';
    if (userProfile.education && userProfile.education.length > 0) {
        await step('Education', () => handleEducation(userProfile.education));
    }

    // 4. Skills (Async Injection)
    traceSection = 'Skills';
    if (userProfile.skills && userProfile.skills.length > 0) {
        await step('Skills', async () => {
            const skillsInput = findElementByFuzzyLabel(['skills', 'competencies']);
            if (!skillsInput) return ABSENT;
            await injectSkills(skillsInput, userProfile.skills);
            return true;
        });
    }

    // 5. Language
    traceSection = 'Languages';
    if (userProfile.language && userProfile.language.name) {
        await step('Language', () => handleLanguages(userProfile.language));
    }

    // 5. Resume Upload
    traceSection = 'Resume';
    if (userProfile.resume && userProfile.resumeMeta) {
        await step('Resume file', () => uploadResume(userProfile.resume, userProfile.resumeMeta));
    }

    // 6. Application Questions & Disclosures (Async)
    traceSection = 'Application Questions';
    await handleJobPreferences();
    await answerProfileQuestions();
    traceSection = 'Voluntary Disclosures';
    await fillDisclosures();

    // 7. Terms & Conditions
    traceSection = 'Terms';
    await step('Terms checkbox', () => handleTerms());

    console.log("Workday Autoplay: Scan completed.");
    isScanning = false;

    // Notify the side panel so it can show live status. `job` lets a signed-in
    // user's panel log the application (cloud-tracker.js); nothing is sent otherwise.
    try {
        chrome.runtime.sendMessage({ action: 'fill_complete', job: workdayJobInfo(), report: buildFillReport() }, () => {
            // Reading lastError prevents "Unchecked runtime.lastError" noise when panel is closed
            void chrome.runtime.lastError;
        });
    } catch (e) { /* panel closed, extension reloaded, etc. */ }

    // Permanently disconnect observer after this scan to prevent loops
    if (observer) {
        observer.disconnect();
        console.log("Workday Autoplay: Observer disconnected. Will not auto-scan again on this page.");
    }
}

// What the page says about the job, for the application tracker. Raw text only;
// cloud-tracker.js turns it into company / role / link and falls back to the URL.
function workdayJobInfo() {
    const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');
    const heading = document.querySelector('[data-automation-id="jobTitleHeading"], [data-automation-id="jobPostingHeader"]');
    const logo = document.querySelector('[data-automation-id="logo"] img, img[data-automation-id="logo"]');
    return {
        site: 'workday',
        url: location.href,
        title: text(heading).slice(0, 200),
        company: ((logo && logo.alt) || '').trim().slice(0, 200),
        pageTitle: (document.title || '').slice(0, 300)
    };
}

/**
 * WORK EXPERIENCE
 *
 * Workday renders one panel per job ("Work Experience 1", "Work Experience 2",
 * ...) plus an Add button. This used to fill only workExperience[0], and with
 * unscoped label lookups, so every panel on the page got the FIRST job's company,
 * title, location and description, and the other jobs never appeared.
 * Reported 2026-11-22. Now each job fills its own panel, adding panels as needed.
 */
const WORK_PANEL_HEADING = /^\s*work experience\s*\d+\s*$/i;

function findWorkPanels() {
    const panels = [];
    for (const h of document.querySelectorAll('h2, h3, h4, h5, h6, [role="heading"], legend')) {
        if (!WORK_PANEL_HEADING.test(h.innerText || '')) continue;
        // The panel is the closest ancestor that holds inputs but no OTHER panel
        // heading; past that we would be scoping to the whole section.
        let el = h.closest('div[role="group"], fieldset') || h.parentElement;
        while (el && !el.querySelector('input, textarea') && el.parentElement) el = el.parentElement;
        if (!el) continue;
        const headings = Array.from(el.querySelectorAll('h2, h3, h4, h5, h6, [role="heading"], legend'))
            .filter(x => WORK_PANEL_HEADING.test(x.innerText || ''));
        if (headings.length > 1) el = h.parentElement;
        if (el && el.offsetParent !== null && !panels.includes(el)) panels.push(el);
    }
    return panels;
}

// Headings of the My Experience sections. Used to stop a search at the edge of
// its own section, so one section's Add button is never clicked for another.
const SECTION_TITLE = /^\s*(work experience|education|websites?|social network urls?|languages?|skills|certifications?|resume\/?cv|links)\s*$/i;
/** Is a section titled `titleRe` ("Education", "Languages") visible on this page? */
function sectionOnPage(titleRe) {
    return Array.from(document.querySelectorAll('h2, h3, h4, h5, h6, [role="heading"], legend'))
        .some(h => titleRe.test(h.innerText || h.textContent || '') && h.offsetParent !== null);
}

/** Does any visible text box carry a label matching `re` ("Company", "School")? A single-entry form's tell. */
// Employer-written questions sit in formField-<32 hex GUID>; Workday's own
// fields have names (formField-school). "School or University Name" on an
// Application Questions page must not pass for an Education section.
const GUID_FIELD = /^formField-[0-9a-f]{32}$/i;
function fieldLabeledOnPage(re) {
    return Array.from(document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"]), textarea'))
        .some(el => {
            if (el.offsetParent === null) return false;
            const f = el.closest('[data-automation-id^="formField"]');
            if (f && GUID_FIELD.test(f.getAttribute('data-automation-id'))) return false;
            return collectLabelTexts(el).some(t => re.test(t || ''));
        });
}

const ADD_BUTTON = (b) => b.getAttribute('data-automation-id') === 'add-button'
    || b.getAttribute('data-automation-id') === 'Add'
    || /^\s*add( another)?\s*$/i.test(b.innerText || b.textContent || '');

/**
 * The Add button of the section titled `titleRe` ("Websites", "Work Experience").
 * Workday marks every section's Add button the same way (data-automation-id
 * "add-button", text "Add"), so the button has to be found inside that
 * section: walk up from the heading, but never into a container that also
 * holds another section's heading.
 */
function findSectionAddButton(titleRe, ariaLabels = []) {
    for (const label of ariaLabels) {
        const direct = document.querySelector(`button[aria-label*="${label}" i]`);
        if (direct) return direct;
    }
    for (const h of document.querySelectorAll('h2, h3, h4, [role="heading"]')) {
        if (!titleRe.test(h.innerText || h.textContent || '')) continue;
        let sec = h.parentElement;
        for (let hops = 0; sec && hops < 5; hops++, sec = sec.parentElement) {
            const others = Array.from(sec.querySelectorAll('h2, h3, h4, [role="heading"]'))
                .some(x => x !== h && SECTION_TITLE.test(x.innerText || x.textContent || '') && !titleRe.test(x.innerText || x.textContent || ''));
            if (others) break; // walked out of this section
            const btn = Array.from(sec.querySelectorAll('button')).find(ADD_BUTTON);
            if (btn) return btn;
        }
    }
    return null;
}

function findAddWorkButton() {
    return findSectionAddButton(/^\s*work experience\s*$/i, ['Add Work Experience', 'Add Another Work Experience']);
}

async function fillWorkPanel(work, root) {
    fillFieldByFuzzyLabel(['company', 'employer'], work.company, root);
    fillFieldByFuzzyLabel(['job title', 'title', 'role'], work.title || work['job title'], root);
    fillFieldByFuzzyLabel(['location'], work.location, root);
    fillFieldByFuzzyLabel(['role description', 'description', 'summary'], work.description || work['role description'], root);

    // Before the dates: ticking "I currently work here" hides the To widget, so
    // filling To first would leave a value the user can neither see nor fix.
    // Set in BOTH directions so the form matches the profile. ('present' is not a
    // key: it is a substring of "represent", common in consent text.)
    if (setCheckbox(['i currently work here', 'current job'], !!work.isCurrentRole, root)) {
        await new Promise(r => setTimeout(r, 200));
    }

    if (work.startDate) await fillDate(['from', 'start date'], work.startDate, root);
    // Skipped for a current role: the To widget is not rendered.
    if (work.endDate && !work.isCurrentRole) await fillDate(['to', 'end date'], work.endDate, root);
}

async function handleWorkExperience(jobs) {
    jobs = (jobs || []).filter(j => j && (j.company || j.title || j['job title']));
    if (!jobs.length) return ABSENT;

    // No numbered panels: a single-entry form (or a tenant we have not seen).
    // Keep the old page-wide fill for the first job -- but only on a page that
    // has a Work Experience section. Without this gate the page-wide fill ran on
    // every Application Questions page and wrote into any "location" or
    // "description" box it found there.
    if (!findWorkPanels().length) {
        const addBtn = findAddWorkButton();
        if (!addBtn && !sectionOnPage(/^\s*work experience\s*$/i) && !fieldLabeledOnPage(/^\s*(company|employer)\b/i)) return ABSENT;
        if (addBtn) {
            addBtn.click();
            await waitForCondition(() => findWorkPanels().length > 0, 2000);
        }
        if (!findWorkPanels().length) {
            await fillWorkPanel(jobs[0], document);
            return true;
        }
    }

    let ok = true;
    for (let i = 0; i < jobs.length; i++) {
        let panels = findWorkPanels();
        if (!panels[i]) {
            const addBtn = findAddWorkButton();
            if (!addBtn) {
                console.log(`Workday Autoplay: no Add button for work experience ${i + 1}; stopping.`);
                break;
            }
            const before = panels.length;
            addBtn.click();
            if (!await waitForCondition(() => findWorkPanels().length > before, 2000)) {
                console.warn(`Workday Autoplay: Add did not open work experience ${i + 1}.`);
                ok = false;
                break;
            }
            panels = findWorkPanels();
        }
        console.log(`Workday Autoplay: filling work experience ${i + 1}`, panels[i]);
        await fillWorkPanel(jobs[i], panels[i]);
    }
    return ok;
}

/**
 * Generic repeated panels: "Education 1", "Education 2", ...
 */
function findPanels(headingRe) {
    const panels = [];
    for (const h of document.querySelectorAll('h2, h3, h4, h5, h6, [role="heading"], legend')) {
        if (!headingRe.test(h.innerText || h.textContent || '')) continue;
        let el = h.closest('div[role="group"], fieldset') || h.parentElement;
        while (el && !el.querySelector('input, textarea, button[aria-haspopup="listbox"]') && el.parentElement) el = el.parentElement;
        if (!el) continue;
        const headings = Array.from(el.querySelectorAll('h2, h3, h4, h5, h6, [role="heading"], legend'))
            .filter(x => headingRe.test(x.innerText || x.textContent || ''));
        if (headings.length > 1) el = h.parentElement;
        if (el && el.offsetParent !== null && !panels.includes(el)) panels.push(el);
    }
    return panels;
}

const EDU_PANEL_HEADING = /^\s*education\s*\d+\s*$/i;

async function fillEducationPanel(edu, root) {
    return withScope(root, async () => {
        let ok = true;
        if (edu.school) {
            const picked = await handleSearchablePicker(['school', 'institution', 'university'], edu.school);
            const landed = ensureSchool(edu.school, root);
            ok = (landed === ABSENT ? picked !== false : landed) && ok;
        }
        if (edu.fieldOfStudy) ok = (await handleSearchablePicker(['field of study', 'major'], edu.fieldOfStudy)) !== false && ok;
        if (edu.degree) {
            const viaDropdown = await handleDropdown(['degree', 'qualification'], edu.degree, matchDegreeOption);
            if (!viaDropdown) ok = (await selectWorkdayDropdown('Degree', edu.degree, matchDegreeOption)) !== false && ok;
        }
        if (edu.startDate) await fillDate('first year attended', edu.startDate, root);
        if (edu.endDate) await fillDate('last year attended', edu.endDate, root);
        // Only a GPA the user actually entered. This used to default to "2.8",
        // which put an invented GPA on real applications.
        if (edu.gpa) fillGPA(edu.gpa);
        return ok;
    });
}

/**
 * Did the school land? The picker never reported failure, so Education read
 * "filled" while a required "School or University" box sat empty (DMA,
 * 2026-11-23: a plain text box, not a search box). Proof is a pill or a value;
 * a plain box that is still empty gets the name typed in.
 */
function ensureSchool(school, root) {
    const field = Array.from(root.querySelectorAll('[data-automation-id^="formField"]')).find(f => {
        if (GUID_FIELD.test(f.getAttribute('data-automation-id'))) return false;
        const l = f.querySelector('label, legend');
        const t = l ? (l.innerText || l.textContent || '') : '';
        return /\b(school|university|institution)\b/i.test(t) && !/high school/i.test(t) && f.offsetParent !== null;
    });
    if (!field) return ABSENT;
    if (field.querySelector('[data-automation-id="selectedItem"]')) return true;
    const input = field.querySelector('input[type="text"], input:not([type]), textarea');
    if (!input) return ABSENT;
    // A search box keeps typed text without a pick, so only the pill counts there.
    if (input.getAttribute('data-automation-id') === 'searchBox') {
        console.warn('Workday Autoplay: typed the school but no suggestion was chosen');
        return false;
    }
    if (input.value) return true;
    setNativeValue(input, school);
    if (input.value === school) return true;
    console.warn('Workday Autoplay: wrote the school but the box did not keep it');
    return false;
}

async function handleEducation(list) {
    const schools = (list || []).filter(e => e && (e.school || e.degree || e.fieldOfStudy || e.gpa || e.startDate || e.endDate));
    if (!schools.length) return ABSENT;

    if (!findPanels(EDU_PANEL_HEADING).length) {
        const addBtn = findSectionAddButton(/^\s*education\s*$/i, ['Add Education']);
        // Same gate as Work Experience: the page-wide fallback is for a
        // single-entry Education form, not for pages with no Education at all.
        if (!addBtn && !sectionOnPage(/^\s*education\s*$/i) && !fieldLabeledOnPage(/^\s*(school|university|institution)\b/i)) return ABSENT;
        if (addBtn) {
            addBtn.click();
            await waitForCondition(() => findPanels(EDU_PANEL_HEADING).length > 0, 2500);
        }
        if (!findPanels(EDU_PANEL_HEADING).length) {
            // A single-entry form (no numbered panels): the old page-wide fill.
            return fillEducationPanel(schools[0], document);
        }
    }

    let ok = true;
    for (let i = 0; i < schools.length; i++) {
        let panels = findPanels(EDU_PANEL_HEADING);
        if (!panels[i]) {
            const addBtn = findSectionAddButton(/^\s*education\s*$/i, ['Add Education']);
            if (!addBtn) { console.warn(`Workday Autoplay: no Add button for education ${i + 1}`); return false; }
            const before = panels.length;
            addBtn.click();
            if (!await waitForCondition(() => findPanels(EDU_PANEL_HEADING).length > before, 2500)) {
                console.warn(`Workday Autoplay: Add did not open education ${i + 1}`);
                return false;
            }
            panels = findPanels(EDU_PANEL_HEADING);
        }
        ok = (await fillEducationPanel(schools[i], panels[i])) && ok;
    }
    return ok;
}

/** The question a control belongs to: legend, then label, never the control's own value text. */
function questionLabelFor(el) {
    const t = (n) => (n ? (n.innerText || n.textContent || '').replace(/\s+/g, ' ').replace(/\*/g, '').trim() : '');
    const fs = el.closest('fieldset');
    if (fs && t(fs.querySelector('legend'))) return t(fs.querySelector('legend'));
    if (el.id) {
        const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
        if (t(l)) return t(l);
    }
    const field = el.closest('[data-automation-id^="formField"]');
    if (field && t(field.querySelector('label, legend'))) return t(field.querySelector('label, legend'));
    if (el.type === 'checkbox' || el.getAttribute('role') === 'checkbox') {
        const wrap = el.closest('label');
        if (t(wrap)) return t(wrap);
    }
    if (el.tagName !== 'BUTTON' && el.getAttribute('aria-label')) return el.getAttribute('aria-label').trim();
    return '';
}

/** What is still empty when autofill finishes: the fields it missed entirely. */
function emptyFieldSweep() {
    const out = [];
    const root = document.querySelector('[data-automation-id="applyFlowPage"]') || document.body;
    const visible = (el) => el.offsetParent !== null;
    const required = (el, label) => el.required || el.getAttribute('aria-required') === 'true'
        || /\bRequired\b/.test(el.getAttribute('aria-label') || '') || /\*\s*$/.test(label);
    const field = (el) => {
        const f = el.closest('[data-automation-id^="formField"]');
        return f ? f.getAttribute('data-automation-id').replace(/^formField-?/, '').slice(0, 60) : '';
    };
    const push = (el, kind) => {
        const label = questionLabelFor(el);
        if (!label && !field(el)) return;
        out.push({ kind, label: label.slice(0, 140), field: field(el), required: required(el, label) });
    };

    root.querySelectorAll('input[type="text"], input[type="email"], input[type="tel"], input[type="url"], input:not([type]), textarea').forEach(el => {
        if (!visible(el) || el.value) return;
        // A multiselect keeps its answer in a pill, not the input. Not every
        // tenant marks the input as searchBox (formField-source doesn't).
        const f = el.closest('[data-automation-id^="formField"]');
        if (f && f.querySelector('[data-automation-id="selectedItem"]')) return;
        if (el.closest('[role="listbox"], [data-automation-id="dateWidget"]')) return;
        push(el, el.getAttribute('data-automation-id') === 'searchBox' ? 'picker' : 'text');
    });
    root.querySelectorAll('button[aria-haspopup="listbox"]').forEach(el => {
        if (!visible(el)) return;
        const shown = (el.innerText || '').trim();
        if (shown && !/^select one$/i.test(shown)) return;
        push(el, 'dropdown');
    });
    root.querySelectorAll('input[type="checkbox"], [role="checkbox"]').forEach(el => {
        if (!visible(el) && !(el.parentElement && visible(el.parentElement))) return;
        const checked = el.checked || el.getAttribute('aria-checked') === 'true';
        if (checked) return;
        const label = questionLabelFor(el);
        if (!required(el, label)) return; // optional boxes are meant to stay as they are
        push(el, 'checkbox');
    });
    return out.slice(0, 60);
}

function buildFillReport() {
    const heading = document.querySelector('[data-automation-id="applyFlowPage"] h2, [data-automation-id="applyFlowPage"] h3, h2');
    const steps = fillTrace.slice(0, 120);
    const empty = emptyFieldSweep();
    return {
        build: FILL_BUILD,
        page: ((heading && heading.innerText) || '').trim().slice(0, 80),
        path: location.pathname.slice(0, 200),
        at: new Date().toISOString(),
        counts: {
            filled: steps.filter(x => x.status === 'filled').length,
            failed: steps.filter(x => x.status === 'failed').length,
            skipped: steps.filter(x => x.status === 'skipped').length,
            emptyRequired: empty.filter(x => x.required).length,
            empty: empty.length
        },
        steps,
        empty
    };
}

function formatDateString(dateObj) {
    if (!dateObj || !dateObj.month || !dateObj.year) return '';
    return `${dateObj.month}/${dateObj.year}`;
}

/**
 * SKILLS INJECTION
 */
async function injectSkills(input, skills) {
    for (const skill of skills) {
        setNativeValue(input, skill);
        // Dispatch Enter
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
        input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

        // Wait briefly for tag to form
        await new Promise(r => setTimeout(r, 100));
    }
}

/**
 * RESUME UPLOAD
 */
/**
 * RESUME UPLOAD
 */
function uploadResume(base64Data, meta) {
    // Idempotency: Only upload once per session
    if (hasUploadedResume) {
        console.log("Workday Autoplay: Resume already uploaded, skipping.");
        return;
    }

    const fileInputs = document.querySelectorAll('input[type="file"]');
    if (fileInputs.length === 0) return;

    try {
        const blob = dataURItoBlob(base64Data);
        const file = new File([blob], meta.name, { type: meta.type, lastModified: meta.lastModified });
        const list = new DataTransfer();
        list.items.add(file);

        fileInputs.forEach(input => {
            if (input.files.length > 0) return; // Already has file

            input.files = list.files;
            input.dispatchEvent(new Event('change', { bubbles: true }));
            input.dispatchEvent(new Event('input', { bubbles: true }));
            hasUploadedResume = true; // Mark as uploaded
            console.log("Workday Autoplay: Uploaded resume", meta.name);
        });
    } catch (e) {
        console.error("Workday Autoplay: Failed to upload resume", e);
    }
}

function dataURItoBlob(dataURI) {
    // convert base64 to raw binary data held in a string
    // doesn't handle URIs without the data:;base64, prefix well if purely raw base64, but we expect DataURI.
    const byteString = atob(dataURI.split(',')[1]);
    const mimeString = dataURI.split(',')[0].split(':')[1].split(';')[0];
    const ab = new ArrayBuffer(byteString.length);
    const ia = new Uint8Array(ab);
    for (let i = 0; i < byteString.length; i++) {
        ia[i] = byteString.charCodeAt(i);
    }
    return new Blob([ab], { type: mimeString });
}

function findElementByFuzzyLabel(keys) {
    let found = null;
    keys.forEach(key => {
        if (found) return;
        const lower = key.toLowerCase();
        // label's own text node, then its full string value (same F7/F12 ladder
        // as findDropdownTrigger/findDateContainer — a label whose text sits
        // inside a nested <span> returns an empty text() node-set), then
        // aria-label as before.
        const xpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following::input[1] | //label[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following::input[1] | //input[contains(@aria-label, "${key}")] | //textarea[contains(@aria-label, "${key}")]`;
        found = getElementByXpath(xpath);
    });
    return found;
}

/**
 * Dropdown Handling (Now Async)
 */
const XPATH_LOWER = "'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'";

/**
 * Locate the button/combobox for a dropdown labelled `key`.
 *
 * Confirmed failure: "No dropdown trigger found for country" on the Duke Energy
 * My Information page, where the field plainly exists (formField-country in
 * tools/captures/my-information.json). Matching only on a <label>'s direct
 * text() is too narrow — a Workday dropdown is a <button>, which takes no
 * <label>, and its accessible name lives in aria-label:
 *
 *   aria-label="Country Uzbekistan Required"
 *
 * selectWorkdayDropdown has always carried the aria-label fallback, which is
 * why Degree works while Country did not. Same ladder here.
 */
function findDropdownTrigger(key) {
    const lower = key.toLowerCase();
    const after = `/following::*[self::button or @role="combobox"][1]`;

    // 1. The label's own text node — original behavior, kept first.
    const byText = getElementByXpath(
        `//label[contains(translate(text(), ${XPATH_LOWER}), "${lower}")]${after}`
    );
    if (byText) return byText;

    // 2. The label's full string value. Workday nests label text inside a span
    //    often enough that text() returns an empty node-set.
    const byString = getElementByXpath(
        `//label[contains(translate(., ${XPATH_LOWER}), "${lower}")]${after}`
    );
    if (byString) return byString;

    // 3. The button's own accessible name.
    return getElementByXpath(
        `//button[@aria-label and contains(translate(@aria-label, ${XPATH_LOWER}), "${lower}")]`
    );
}

async function handleDropdown(keys, value, matcher = null) {
    // Say so out loud. An empty profile field silently skipped the whole
    // dropdown, which is indistinguishable in the console from a dropdown that
    // was attempted and failed. That cost real debugging time on Country, whose
    // popup input carries "United States of America" as a PLACEHOLDER — it
    // looks filled while saving "".
    if (!value) {
        console.log(`Workday Autoplay: No profile value for ${keys[0]}, leaving the field as-is.`);
        return;
    }

    for (const key of keys) {
        try {
            const trigger = findDropdownTrigger(key);

            if (!trigger) {
                console.log(`Workday Autoplay: No dropdown trigger found for ${key}`);
                continue;
            }

            if (trigger.innerText.includes(value) || trigger.value === value) {
                console.log(`Workday Autoplay: ${key} already reads "${trigger.innerText.trim()}", leaving it.`);
                continue;
            }

            console.log(`Workday Autoplay: Found dropdown trigger for ${key} (currently "${trigger.innerText.trim()}")`, trigger);
            scrollIntoViewIfNeeded(trigger);
            trigger.click();

            // Scoped to the open dropdown throughout — see findOpenListbox.
            const hasOptions = await waitForCondition(() => getOpenListboxOptions().length > 0, 3000);

            if (!hasOptions) {
                console.warn(`Workday Autoplay: No options appeared for ${key}`);
                continue;
            }

            // Parity with selectWorkdayDropdown, which has always logged this.
            // The count is what distinguishes "read the wrong listbox" from
            // "read the right one and failed to match" — the exact confusion
            // that made F6 look like an F1 regression.
            console.log(`Workday Autoplay: Found ${getOpenListboxOptions().length} options for ${key}`);

            const pick = () => {
                const opts = getOpenListboxOptions();
                const needle = value.toLowerCase();
                return opts.find(o => o.innerText.trim() === value)
                    || opts.find(o => o.innerText.trim().toLowerCase() === needle)
                    // Ahead of the substring fallback on purpose: where a matcher
                    // is supplied, substring is the path that mis-picks.
                    || (matcher && matcher(opts, value))
                    || opts.find(o => o.innerText.toLowerCase().includes(needle));
            };

            let option = pick();

            if (!option) {
                const searchInput = document.querySelector('input[type="search"], input[aria-label="Search"]');
                if (searchInput) {
                    scrollIntoViewIfNeeded(searchInput);
                    setNativeValue(searchInput, value);
                    await waitForCondition(() => !!pick(), 2000);
                    option = pick();
                }
            }

            if (option) {
                console.log(`Workday Autoplay: Found option ${value}`, option);
                // Honour the result. This used to be discarded, so the console
                // read as a success ("Found option …") even when the click never
                // committed and the field was left on its old value.
                const ok = await commitOptionSelection(option, key);
                if (!ok) {
                    console.warn(`Workday Autoplay: Selected ${value} for ${key} but it did not commit — field left as-is.`);
                }
                await new Promise(r => setTimeout(r, 300));
                return;
            } else {
                console.warn(`Workday Autoplay: Option ${value} not found for ${key}`);
            }
        } catch (e) {
            console.error(`Workday Autoplay: Error handling dropdown for ${key}:`, e);
        }
    }
}

/**
 * Date Helpers (Async)
 *
 * SCOPED, and that is the entire point of this rewrite.
 *
 * The previous implementation resolved a date field with an XPath `following::`
 * walk that began at the first element on the page whose text merely CONTAINED
 * the label key. For the end date that key is "to", which matches something
 * near the top of virtually any document — "Back to Job Posting", "Story",
 * "Total" — and the walk then took the first Month/Year input AFTER it, which
 * is the From widget. So the end date was written into the start date and the
 * To fields were left empty.
 *
 * That is exactly what the user reported on 2026-08-24, and it only surfaced
 * with "I currently work here" unchecked, because that is the only state in
 * which Workday renders the To widget at all.
 *
 * Everything below resolves a CONTAINER first and queries inside it. No
 * `following::`, and only <label>/<legend> elements may name a field —
 * arbitrary page text is not a label.
 */

// Each half of a Workday date is its own spin-button input. The
// data-automation-id is the reliable hook; aria-label and an exact placeholder
// are fallbacks for tenants that render a plain pair of text boxes.
// Placeholder matching is exact on purpose: [placeholder*="MM" i] would also
// match "Summary".
const DATE_SECTION_SELECTORS = {
    Month: 'input[data-automation-id="dateSectionMonth-input"], input[aria-label*="Month" i], input[placeholder="MM"], input[placeholder="mm"]',
    Year: 'input[data-automation-id="dateSectionYear-input"], input[aria-label*="Year" i], input[placeholder="YYYY"], input[placeholder="yyyy"]'
};

const MONTH_NAMES = {
    "01": "January", "02": "February", "03": "March", "04": "April",
    "05": "May", "06": "June", "07": "July", "08": "August",
    "09": "September", "10": "October", "11": "November", "12": "December"
};

function escapeRegExp(text) {
    return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * How well a label names the field we are looking for.
 *   2 = exact, 1 = whole-word, 0 = no match.
 *
 * A plain `includes` is what let "to" claim "Total Compensation"; an exact match
 * alone is too strict for the "To (Year)" / "From Date" wordings tenants use.
 */
function labelMatchScore(labelText, key) {
    const text = normalizeLabel(labelText || '');
    const needle = normalizeLabel(key || '');
    if (!text || !needle) return 0;
    if (text === needle) return 2;
    return new RegExp(`(^|[^a-z0-9])${escapeRegExp(needle)}([^a-z0-9]|$)`).test(text) ? 1 : 0;
}

// The container that owns a label's control. Walks up only far enough to find
// one — past three levels the "container" is the whole form and the scoping this
// function exists to provide has been thrown away.
function controlContainerFor(label) {
    const CONTROL = 'input, button[aria-haspopup="listbox"], [role="combobox"], select';
    let el = label.closest('div[data-automation-id^="formField"], div[data-automation-id="dateWidget"], fieldset, div[role="group"]')
        || label.parentElement;
    let hops = 0;
    while (el && hops < 3 && !el.querySelector(CONTROL)) {
        el = el.parentElement;
        hops++;
    }
    return el && el.querySelector(CONTROL) ? el : null;
}

function findDateContainer(key, root = document) {
    let best = null;
    let bestScore = 0;

    for (const label of root.querySelectorAll('label, legend')) {
        const score = labelMatchScore(label.innerText, key);
        if (!score || score <= bestScore) continue;

        const container = controlContainerFor(label);
        // Hidden means not applicable — the To widget while "I currently work
        // here" is ticked, or a collapsed section.
        if (!container || container.offsetParent === null) continue;

        best = container;
        bestScore = score;
        if (score === 2) break;
    }
    return best;
}

function findDateSectionTrigger(container, type) {
    const triggers = Array.from(container.querySelectorAll('button[aria-haspopup="listbox"], [role="combobox"], select'));
    if (!triggers.length) return null;

    const named = triggers.find(el => new RegExp(type, 'i').test(
        `${el.getAttribute('aria-label') || ''} ${el.getAttribute('title') || ''} ${el.getAttribute('name') || ''}`
    ));
    if (named) return named;

    // An unlabelled pair: Workday renders Month then Year. Trusted only when
    // there are exactly two controls, because past that it is a guess.
    if (triggers.length === 2) return triggers[type === 'Month' ? 0 : 1];
    return null;
}

async function fillDateSection(container, type, value, key) {
    const text = type === 'Month' ? String(value).padStart(2, '0') : String(value);

    // 1. Text / spin-button input — the common Workday rendering.
    const input = container.querySelector(DATE_SECTION_SELECTORS[type]);
    if (input) {
        if (input.value !== text) {
            input.click();
            setNativeValue(input, text);
        }
        return true;
    }

    const trigger = findDateSectionTrigger(container, type);
    if (!trigger) return false;

    const wanted = type === 'Month' ? (MONTH_NAMES[text] || text) : text;

    // 2. Native <select>.
    if (trigger.tagName === 'SELECT') {
        const option = Array.from(trigger.options).find(o => {
            const t = o.text.trim().toLowerCase();
            return t === wanted.toLowerCase() || t === text.toLowerCase();
        });
        if (!option) return false;
        setNativeValue(trigger, option.value);
        return true;
    }

    // 3. Workday listbox.
    if ((trigger.innerText || '').trim() === wanted) return true;

    scrollIntoViewIfNeeded(trigger);
    trigger.click();
    if (!await waitForCondition(() => getOpenListboxOptions().length > 0, 2000)) {
        console.warn(`Workday Autoplay: no ${type} options opened for ${key}`);
        return false;
    }

    const needle = wanted.toLowerCase();
    const opts = getOpenListboxOptions();
    const option = opts.find(o => o.innerText.trim() === wanted)
        || opts.find(o => o.innerText.trim().toLowerCase() === needle)
        || opts.find(o => o.innerText.trim() === text)
        || opts.find(o => o.innerText.toLowerCase().includes(needle));

    if (!option) {
        console.warn(`Workday Autoplay: no ${type} option "${wanted}" for ${key}`);
        return false;
    }

    const ok = await commitOptionSelection(option, `${key}/${type}`);
    await new Promise(r => setTimeout(r, 200));
    return ok;
}

// Some tenants render one MM/YYYY box instead of two sections. Scoped to the
// container, unlike the old fuzzy-label pass this replaces, which wrote
// "05/2023" into every field whose label merely contained "to".
function fillSingleDateInput(container, dateObj) {
    const text = formatDateString(dateObj);
    if (!text) return false;

    const input = Array.from(container.querySelectorAll('input:not([type="hidden"])'))
        .find(i => i.offsetParent !== null && i.type !== 'checkbox' && i.type !== 'radio');
    if (!input) return false;

    setNativeValue(input, text);
    return true;
}

/**
 * Fill the date field named by any of `labelKeys` with { month, year }.
 * Returns whether anything was written.
 */
async function fillDate(labelKeys, dateObj, root = document) {
    if (!dateObj) return false;
    const { month, year } = dateObj;
    if (!month && !year) return false;

    const keys = Array.isArray(labelKeys) ? labelKeys : [labelKeys];

    for (const key of keys) {
        const container = findDateContainer(key, root);
        if (!container) continue;

        console.log(`Workday Autoplay: date field "${key}" resolved to`, container);

        let filled = false;
        if (month) filled = (await fillDateSection(container, 'Month', month, key)) || filled;
        if (year) filled = (await fillDateSection(container, 'Year', year, key)) || filled;
        if (!filled) filled = fillSingleDateInput(container, dateObj);

        if (filled) return true;
        console.warn(`Workday Autoplay: found the "${key}" date field but could not write to it.`);
    }

    console.log(`Workday Autoplay: no date field found for ${keys.join(' / ')}`);
    return ABSENT;
}

/**
 * Standard Fields
 */
// Every label text that could identify this input, in the original priority
// order: aria-label, then label[for], then the enclosing formField's label.
// All three are collected (not just the first that exists) so an input with a
// non-matching aria-label can still be matched by its visible label.
function collectLabelTexts(input) {
    const texts = [];

    const ariaLabel = input.getAttribute('aria-label');
    if (ariaLabel) texts.push(ariaLabel);

    if (input.id) {
        const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
        if (label) texts.push(label.innerText);
    }

    // NOTE: deliberately still an EXACT match on formField, unlike the other
    // four call sites which were widened to [data-automation-id^="formField"].
    //
    // Widening here does not just repair a dead lookup, it enlarges the
    // candidate set that fillFieldByFuzzyLabel writes into. Workday points a
    // multiselect's <label for> at the widget container div rather than at the
    // inner search <input>, so those inputs carry no label text today and are
    // never written to. Give them their container's label and a fuzzy key could
    // setNativeValue raw text straight into a School / Field of Study search
    // box. Needs a full-form capture in tools/captures/ to model against before
    // it is changed — see F3 in SHARED_TASK_NOTES.md.
    const container = input.closest('div[data-automation-id="formField"], div[data-automation-id="dateWidget"]');
    if (container) {
        const labelEl = container.querySelector('label');
        if (labelEl) texts.push(labelEl.innerText);
    }

    return texts;
}

// Workday decorates labels with required-markers and stray whitespace, so
// compare on a normalized form rather than raw text.
function normalizeLabel(text) {
    return text.toLowerCase().replace(/\*/g, '').replace(/\(required\)/g, '').replace(/\s+/g, ' ').trim();
}

function fillFieldByFuzzyLabel(keys, value, root = SCOPE) {
    // Returns ABSENT (no such field here), 'skipped' (field here, no profile
    // value), true (written and read back), or false (written but didn't stick).
    const candidates = [];
    root.querySelectorAll('input:not([type="hidden"]), textarea').forEach(input => {
        const texts = collectLabelTexts(input);
        if (texts.length) candidates.push({ input, texts });
    });

    // `keys` is ordered most-specific-first. Take the first key that matches
    // anything and stop, so a loose trailing key cannot poach a field a more
    // specific key already identified ('role' used to write the job title into
    // "Role Description"). Within the winning key, an exact label match beats
    // substring matches ('to' matched "Total Compensation", "Story", ...).
    // When nothing matches exactly, all substring hits are still filled, which
    // preserves the intended behavior for pairs like Email / Confirm Email.
    for (const key of keys) {
        const needle = key.toLowerCase();
        const hits = candidates.filter(c => c.texts.some(t => t.toLowerCase().includes(needle)));
        if (!hits.length) continue;
        if (!value) return 'skipped';

        const exact = hits.filter(c => c.texts.some(t => normalizeLabel(t) === normalizeLabel(key)));
        const targets = exact.length ? exact : hits;
        let ok = true;
        for (const c of targets) {
            if (c.input.value === value) continue;
            setNativeValue(c.input, value);
            if (c.input.value !== value) {
                ok = false;
                console.warn(`Workday Autoplay: wrote "${key}" but the box did not keep it`);
            }
        }
        return ok;
    }
    return ABSENT;
}

/**
 * Fallback for fields whose visible label isn't linked to the input: match
 * Workday's own field name instead (data-automation-id="formField-linkedInAccount",
 * or an input id/name such as "socialNetworkAccounts--linkedInAccount").
 * Fills only visible, empty text inputs, so it never overwrites anything.
 */
function fillByFieldId(re, value) {
    if (!value) return 0;
    let n = 0;
    document.querySelectorAll('input:not([type="hidden"]):not([type="checkbox"]):not([type="radio"])').forEach(input => {
        if (input.value || input.offsetParent === null) return;
        const field = input.closest('[data-automation-id]');
        const names = [input.id, input.name, input.getAttribute('data-automation-id'), field && field.getAttribute('data-automation-id')];
        if (!names.some(x => x && re.test(x))) return;
        setNativeValue(input, value);
        n++;
    });
    return n;
}

function matchesAny(text, keys) {
    if (!text) return false;
    const t = text.toLowerCase();
    return keys.some(key => t.includes(key.toLowerCase()));
}

/**
 * The names that belong to a checkbox ITSELF.
 *
 * Deliberately not "the text of whatever container it sits in". The old
 * checkCheckbox fell back to `input.closest('div, label')` and matched that
 * element's whole innerText, so a checkbox could be ticked because of wording
 * that belongs to a SIBLING field sharing the same div. Same family of mistake
 * as the date lookup: match the control's own name, never nearby text.
 */
function checkboxLabelTexts(input) {
    const texts = collectLabelTexts(input);

    // A checkbox is often wrapped in its own <label>. That label IS the
    // checkbox's name, unlike an enclosing <div>, so it is safe to read.
    const wrapping = input.closest('label');
    if (wrapping && wrapping.innerText) texts.push(wrapping.innerText);
    const by = input.getAttribute('aria-labelledby');
    if (by) for (const id of by.split(/\s+/)) {
        const n = document.getElementById(id);
        if (n && n.innerText) texts.push(n.innerText);
    }
    const field = input.closest('[data-automation-id^="formField"]');
    const fieldLabel = field && field.querySelector('label, legend');
    if (fieldLabel && fieldLabel.innerText && fieldLabel.querySelector('input, [role="checkbox"]') === null) texts.push(fieldLabel.innerText);

    return texts.filter(Boolean);
}

/**
 * Force a checkbox to `desired`, matching on the box's own name.
 *
 * Ticking AND unticking, which is the point. The old checkCheckbox could only
 * ever tick: nothing in the extension ever cleared a box. So once "I currently
 * work here" was ticked — by Workday's own default, by a stale page, by an
 * earlier run against a different profile, or by one of the loose matchers that
 * used to exist here — it stayed ticked, the To date became unreachable, and the
 * entry claimed a job the user had already left. Reported 2026-08-24.
 */
const isChecked = (el) => (el.type === 'checkbox' ? el.checked : el.getAttribute('aria-checked') === 'true');

/** Click a checkbox and confirm it changed; replay a full pointer sequence on its label if a plain click didn't take. */
async function toggleCheckbox(el, desired) {
    if (isChecked(el) === desired) return true;
    el.click();
    if (el.type === 'checkbox') el.dispatchEvent(new Event('change', { bubbles: true }));
    if (await waitForCondition(() => isChecked(el) === desired, 500)) return true;
    const target = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label') || el;
    const r = target.getBoundingClientRect();
    const init = { bubbles: true, cancelable: true, composed: true, view: window, button: 0, clientX: r.left + 4, clientY: r.top + 4 };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        const Ctor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
        target.dispatchEvent(new Ctor(type, init));
    }
    const ok = await waitForCondition(() => isChecked(el) === desired, 800);
    if (!ok) console.warn(`Workday Autoplay: clicked the "${(checkboxLabelTexts(el)[0] || 'checkbox').trim().slice(0, 60)}" checkbox but it did not change`);
    return ok;
}

function checkboxCandidates(root) {
    return Array.from(root.querySelectorAll('input[type="checkbox"], [role="checkbox"]'))
        .filter(el => !(el.getAttribute('role') === 'checkbox' && el.querySelector('input[type="checkbox"]')));
}

function setCheckbox(keys, desired, root = SCOPE) {
    let changed = false;
    for (const input of checkboxCandidates(root)) {
        const texts = checkboxLabelTexts(input);
        if (!texts.some(t => matchesAny(t, keys))) continue;
        if (isChecked(input) === desired) continue;
        console.log(`Workday Autoplay: ${desired ? 'ticking' : 'clearing'} checkbox "${texts[0].trim().slice(0, 60)}"`, input);
        toggleCheckbox(input, desired); // verified asynchronously; the caller waits briefly anyway
        changed = true;
    }
    return changed;
}

// Kept as the tick-only spelling for callers that only ever mean "tick".
function checkCheckbox(keys) {
    return setCheckbox(keys, true);
}

/**
 * PHASE 3: ADVANCED HELPERS
 */

// 1. Cumulative GPA
function fillGPA(gpaValue) {
    const inputs = SCOPE.querySelectorAll('input');
    let target = null;
    inputs.forEach(input => {
        if (target) return;
        if (input.getAttribute('aria-label') && /cumulative gpa|gpa/i.test(input.getAttribute('aria-label'))) target = input;
        if (!target && input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label && /cumulative gpa|gpa/i.test(label.innerText)) target = input;
        }
        if (!target) {
            // Prefix match: Workday emits formField-gradeAverage, not a bare
            // "formField", so the exact selector never matched and this third
            // fallback was dead. Safe to widen here — the label still has to
            // match /gpa/i, so nothing else can be picked up.
            const container = input.closest('div[data-automation-id^="formField"]');
            if (container) {
                const label = container.querySelector('label');
                if (label && /cumulative gpa|gpa/i.test(label.innerText)) target = input;
            }
        }
    });
    if (target) {
        console.log("Workday Autoplay: Found GPA field", target);
        setNativeValue(target, gpaValue);
    }
}

// 2. Dynamic Websites Section (Async)
//
// Every visible URL box in the Websites section, in document order. The old
// single-element lookup could only ever fill one row, which was fine while the
// profile held one link; it holds two now (LinkedIn and a personal website).
function findWebsiteUrlInputs() {
    const inputs = [];
    document.querySelectorAll('input[type="text"], input[type="url"], input:not([type])').forEach(input => {
        if (input.offsetParent === null) return; // collapsed row, hidden section
        if (collectLabelTexts(input).some(t => /\burl\b|web ?site/i.test(t))) inputs.push(input);
    });
    return inputs;
}

function findAddWebsiteButton() {
    // Workday's current markup: <h3>Websites</h3> ... <button data-automation-id="add-button">Add</button>.
    // The old lookup only knew data-automation-id="Add", so it never found it.
    return findSectionAddButton(/^\s*(websites?|links)\s*$/i, ['Add Website', 'Add Link']);
}

async function handleWebsitesSection(urls) {
    // De-duplicated: the same link stored in both profile fields must not open
    // a second row for itself.
    const wanted = [...new Set((Array.isArray(urls) ? urls : [urls]).filter(Boolean))];
    if (!wanted.length) return;

    for (const url of wanted) {
        const inputs = findWebsiteUrlInputs();

        // Already on the form — the user typed it, or the label pass above filled
        // it a moment ago. Leave it, and do not add a duplicate row.
        if (inputs.some(i => i.value.trim() === url)) continue;

        let target = inputs.find(i => !i.value.trim());

        if (!target) {
            const addBtn = findAddWebsiteButton();
            if (!addBtn) {
                console.log(`Workday Autoplay: no empty website row and no Add button — skipping ${url}`);
                break;
            }
            console.log("Workday Autoplay: Clicking Add Website button", addBtn);
            const before = inputs.length;
            addBtn.click();
            await waitForCondition(() => findWebsiteUrlInputs().length > before, 2000);
            target = findWebsiteUrlInputs().find(i => !i.value.trim());
        }

        if (target) setNativeValue(target, url);
        else console.warn(`Workday Autoplay: could not find a website URL input for ${url}`);
    }
}

// 3. Field of Study / School (Searchable Picker)
// Targets Workday's searchBox input with data-automation-id
async function handleSearchablePicker(keys, value) {
    if (!value) return;

    try {
        let input = null;

        for (const key of keys) {
            // text() first (original behavior), then the label's full string
            // value. Same ladder as findDropdownTrigger (F7) and findDateContainer
            // (F12): Workday nests label text inside a <span> often enough that
            // text() returns an empty node-set, which is a silent miss here —
            // "Could not find searchBox for field of study" — on any tenant/field
            // where that nesting happens. text() stays first so a field with two
            // matching labels (e.g. "Major" appearing standalone elsewhere) keeps
            // resolving to the same one as before.
            const lower = key.toLowerCase();
            const label = getElementByXpath(`//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]`)
                || getElementByXpath(`//label[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]`);
            if (label) {
                // Prefix match: the exact selector never matched Workday's
                // formField-school / formField-degree, so this always fell
                // through to label.parentElement — a wrapper too narrow to
                // contain the input, which is part of why F2 reports
                // "Could not find searchBox for school".
                const container = label.closest('div[data-automation-id^="formField"]') || label.parentElement;
                if (container) {
                    input = findSearchInputIn(container, label);
                    if (input) break;
                }
            }
        }

        if (!input) {
            for (const key of keys) {
                input = SCOPE.querySelector(`input[data-automation-id="searchBox"][id*="${key.toLowerCase().replace(/\s+/g, '')}"]`);
                if (input) break;
            }
        }

        if (!input) {
            input = findElementByFuzzyLabel(keys);
        }

        if (!input) {
            console.log(`Workday Autoplay: Could not find searchBox for ${keys[0]}`);
            return ABSENT;
        }

        if (input.value && input.value.toLowerCase().includes(value.toLowerCase())) {
            console.log(`Workday Autoplay: ${keys[0]} already filled with ${value}, skipping.`);
            return;
        }

        // A multiselect keeps its value in a pill, NOT in the search input --
        // input.value is empty even when "Purdue University, Calumet" is already
        // showing. That check above therefore protects nothing here, and it only
        // looked safe while the input could not be found at all. Now that it can,
        // re-running would type and select a SECOND pill. Same idempotency guard
        // handleLanguages already uses.
        const field = input.closest('div[data-automation-id^="formField"]');
        const existingPill = field && field.querySelector('[data-automation-id="selectedItem"]');
        if (existingPill) {
            const pillText = (existingPill.getAttribute('aria-label') || existingPill.innerText || '').trim();
            console.log(`Workday Autoplay: ${keys[0]} already has a selection (${pillText}), skipping.`);
            return;
        }

        console.log(`Workday Autoplay: Handling Searchable Picker for ${keys[0]}`, input);

        scrollIntoViewIfNeeded(input);
        input.focus();
        setNativeValue(input, value);

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        // Every lookup below goes through getOpenPromptOptions so that a pill
        // that is already on the page can never be mistaken for a suggestion.
        // The previous unscoped wait resolved instantly against such a pill.
        await waitForCondition(() => getOpenPromptOptions().length > 0, 3000);

        const suggestions = getOpenPromptOptions();
        const needle = value.toLowerCase();
        const textOf = el => (el.getAttribute('data-automation-label') || el.innerText || '').trim();

        let option = suggestions.find(el => textOf(el).toLowerCase() === needle)
            || suggestions.find(el => textOf(el).toLowerCase().includes(needle));

        if (!option) {
            // Some Workday variants render suggestions as role="option" rows
            // rather than promptOption, so fall back to the open listbox — which
            // is itself already scoped away from selectedItemList.
            option = getOpenListboxOptions().find(el => el.innerText.toLowerCase().includes(needle));
        }

        // We returned early above if this field already had a pill, so ANY pill
        // appearing now is proof our own pick landed — and it is the only proof
        // available for a <p> suggestion in a menu that may stay open.
        const pillAppeared = () => !!(field && field.querySelector('[data-automation-id="selectedItem"]'));

        if (option) {
            console.log(`Workday Autoplay: Found matching option for ${value}`, option);
            await commitOptionSelection(option, keys[0], pillAppeared);
        } else if (suggestions.length) {
            // User's call: guess rather than leave the field blank. Prefer the
            // suggestion closest to the stored value over whichever happens to
            // be listed first, since school lists are dense with near-misses.
            const closest = closestSuggestion(suggestions, value, textOf);
            const chosen = closest ? closest.el : suggestions[0];
            const how = closest
                ? `closest match "${textOf(chosen)}" (score ${closest.score.toFixed(2)})`
                : `first suggestion "${textOf(chosen)}" (nothing scored above zero)`;
            console.log(`Workday Autoplay: No exact match for ${value}, taking ${how}`);
            await commitOptionSelection(chosen, keys[0], pillAppeared);
        } else {
            console.log(`Workday Autoplay: No options found for ${value}`);
        }

        await new Promise(r => setTimeout(r, 300));
    } catch (e) {
        console.error(`Workday Autoplay: Error in handleSearchablePicker for ${keys[0]}:`, e);
    }
}

// 4. Language Handling - Enhanced with Add Button Workflow
async function handleLanguages(languageData) {
    if (!languageData || !languageData.name) return ABSENT;
    // Only on a page with a Languages section. Off it, the "row already exists"
    // check below matched any multiselect and any page mentioning the language.
    if (!sectionOnPage(/^\s*languages?\s*$/i)) return ABSENT;

    console.log("Workday Autoplay: Handling Language Section...");

    // Idempotency: Check if language dropdown or row already exists
    const existingLangDropdown = document.querySelector('button[aria-label*="Language"], select[name*="language"], div[data-automation-id="multiselectInputContainer"]');
    const existingLangText = document.body.innerText.includes(languageData.name);
    if (existingLangDropdown || existingLangText) {
        console.log("Workday Autoplay: Language row already exists, skipping Add.");
        await setLanguageProficiency(languageData);
        return true;
    }

    // STEP 2a: Click the "Add" Button
    console.log("Workday Autoplay: Step 2a - Looking for Add Language button...");

    let addBtn = document.querySelector('button[data-automation-id="add-button"]');

    // Narrow down to Languages section if multiple Add buttons exist
    if (!addBtn) {
        const sections = document.querySelectorAll('div[data-automation-id="formSection"]');
        for (const sec of sections) {
            if (sec.innerText.includes("Language")) {
                addBtn = sec.querySelector('button[data-automation-id="add-button"]');
                if (addBtn) {
                    console.log("Workday Autoplay: Found Add button in Languages section");
                    break;
                }
            }
        }
    }

    // Fallback: Look for any button with "Add" text in Languages section
    if (!addBtn) {
        const sections = document.querySelectorAll('div, section');
        for (const sec of sections) {
            const header = sec.querySelector('h2, h3, h4');
            if (header && /language/i.test(header.innerText)) {
                const buttons = sec.querySelectorAll('button');
                for (const btn of buttons) {
                    if (/add/i.test(btn.innerText) || btn.getAttribute('data-automation-id') === 'add-button') {
                        addBtn = btn;
                        console.log("Workday Autoplay: Found Add button (fallback method)");
                        break;
                    }
                }
                if (addBtn) break;
            }
        }
    }

    if (addBtn) {
        console.log("Workday Autoplay: Clicking Add Language button", addBtn);
        addBtn.click();
        addBtn.dispatchEvent(new Event('click', { bubbles: true }));

        // STEP 2b: Wait for new row to appear, then click the Language dropdown
        // Use retry-wait loop to ensure element exists before clicking
        console.log("Workday Autoplay: Step 2b - Waiting for language dropdown button to appear...");

        let langDropdownBtn = null;
        let retries = 0;
        const maxRetries = 20; // 20 retries * 200ms = 4 seconds max wait

        while (!langDropdownBtn && retries < maxRetries) {
            await new Promise(r => setTimeout(r, 200)); // Wait 200ms between retries

            // Try to find the language dropdown button with specific selectors
            // Based on actual HTML: aria-label="Language English Required" or "Language Select One"

            // Selector 1: button with aria-label containing "Language" and "Required"
            langDropdownBtn = document.querySelector('button[aria-label*="Language"][aria-label*="Required"]');

            // Selector 2: button with name attribute matching pattern "language-*--language"
            if (!langDropdownBtn) {
                const langButtons = document.querySelectorAll('button[name*="language"][name*="--language"]');
                if (langButtons.length > 0) {
                    // Get the last one (most recently added)
                    langDropdownBtn = langButtons[langButtons.length - 1];
                }
            }

            // Selector 3: button with aria-haspopup="listbox" and aria-label containing "Language"
            if (!langDropdownBtn) {
                langDropdownBtn = document.querySelector('button[aria-haspopup="listbox"][aria-label*="Language"]');
            }

            // Selector 4: Look for any button with aria-label containing "Language"
            if (!langDropdownBtn) {
                const allLangButtons = document.querySelectorAll('button[aria-label*="Language"]');
                if (allLangButtons.length > 0) {
                    // Get the last one (most recently added)
                    langDropdownBtn = allLangButtons[allLangButtons.length - 1];
                }
            }

            retries++;

            if (langDropdownBtn) {
                console.log(`Workday Autoplay: Found language dropdown button after ${retries} retries (${retries * 200}ms)`, langDropdownBtn);
                console.log(`  → aria-label: ${langDropdownBtn.getAttribute('aria-label')}`);
                console.log(`  → name: ${langDropdownBtn.getAttribute('name')}`);
            }
        }

        if (langDropdownBtn) {
            console.log("Workday Autoplay: Clicking Language Dropdown button", langDropdownBtn);
            langDropdownBtn.click();
            langDropdownBtn.dispatchEvent(new Event('click', { bubbles: true }));

            // Wait for dropdown to open
            await new Promise(r => setTimeout(r, 500));

            // Now select the language from the dropdown
            console.log(`Workday Autoplay: Selecting language: ${languageData.name}`);

            // Scoped to the open dropdown — an unscoped lookup finds the
            // selected-pill listbox of some other multiselect widget instead.
            const options = getOpenListboxOptions();

            if (options.length) {

                // Try exact match first
                for (const opt of options) {
                    const optionText = opt.innerText.trim();
                    if (optionText === languageData.name) {
                        console.log(`Workday Autoplay: Found exact match for language: ${languageData.name}`);
                        opt.click();
                        opt.dispatchEvent(new Event('click', { bubbles: true }));
                        await new Promise(r => setTimeout(r, 500));

                        // Continue with proficiency settings
                        await setLanguageProficiency(languageData);
                        return true;
                    }
                }

                // Try partial match
                for (const opt of options) {
                    const optionText = opt.innerText.trim();
                    if (optionText.toLowerCase().includes(languageData.name.toLowerCase())) {
                        console.log(`Workday Autoplay: Found partial match for language: ${optionText}`);
                        opt.click();
                        opt.dispatchEvent(new Event('click', { bubbles: true }));
                        await new Promise(r => setTimeout(r, 500));

                        // Continue with proficiency settings
                        await setLanguageProficiency(languageData);
                        return true;
                    }
                }
            }

            // Fallback to XPath method
            const optionXpath = `//li[@role="option"]//div[text()="${languageData.name}"] | //div[@role="option" and contains(text(), "${languageData.name}")]`;
            const option = getElementByXpath(optionXpath);
            if (option) {
                console.log("Workday Autoplay: Found language via XPath");
                option.click();
                await new Promise(r => setTimeout(r, 500));

                // Continue with proficiency settings
                await setLanguageProficiency(languageData);
                return true;
            }
            console.warn(`Workday Autoplay: "${languageData.name}" is not in the Language list`);
            return false;
        } else {
            console.warn("Workday Autoplay: Language dropdown button not found after waiting");
        }
    } else {
        console.warn("Workday Autoplay: Add Language button not found");
    }
    return false;
}

// Helper function to set language proficiency after language is selected
async function setLanguageProficiency(languageData) {
    // Native Speaker checkbox
    if (languageData.isNative) {
        const nativeCheckbox = document.querySelector('input[type="checkbox"][name*="native"], input[type="checkbox"][aria-label*="Native"]');
        if (nativeCheckbox && !nativeCheckbox.checked) {
            console.log("Workday Autoplay: Checking Native Speaker");
            nativeCheckbox.click();
            nativeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // Proficiency dropdowns ("Overall", "Reading", ...), found by their QUESTION
    // label: the old lookup used aria-label, which on Workday is the current
    // value, so a tenant's "Overall" dropdown (DMA, 2026-11-23) was never found.
    const PROF = /^(overall|comprehension|reading|speaking|writing|verbal|fluency|proficiency)\b/i;
    const triggers = Array.from(document.querySelectorAll('button[aria-haspopup="listbox"]')).filter(b => {
        if (b.offsetParent === null) return false;
        const shown = (b.innerText || '').trim();
        if (shown && !/^select one$/i.test(shown)) return false;
        return PROF.test(questionLabelFor(b));
    });
    if (!triggers.length) return;

    await step('Language proficiency', async () => {
        // The profile stores no proficiency level, only "native speaker". So a
        // native speaker gets the top level; anyone else is left to choose.
        if (!languageData.isNative) {
            console.warn('Workday Autoplay: proficiency level is not in your profile (only answered for a native speaker)');
            return 'skipped';
        }
        const top = (opts) => opts.find(o => /native|bilingual/i.test(o.innerText))
            || opts.find(o => /fluent/i.test(o.innerText))
            || opts.find(o => /expert|advanced|excellent|full professional/i.test(o.innerText)) || null;
        let ok = true;
        for (const t of triggers) ok = (await pickFromDropdown(t, 'Native', `"${questionLabelFor(t)}"`, top)) && ok;
        return ok;
    });
}

/**
 * PHASE 4: DISCLOSURES & CUSTOM DROPDOWNS (Async)
 */

// DEAD. Reassigned near the bottom of this file before anything can call it,
// so this body never runs — see "ONE-CLICK DISCLOSURES OVERRIDE". Left in place
// only because the reassignment reads as an edit to it. Do not resurrect these
// three lines: all three ignore the user's own toggles, and the age one in
// particular would answer a legal question on their behalf.
/**
 * Voluntary disclosures. ONE definition: a later "Enhanced" override used to
 * replace this function at load time, so this one never ran; the override did
 * nothing unless "Decline All Disclosures" was ticked, ignored the answers saved
 * in the profile, never handled Gender, and looked dropdowns up by aria-label,
 * which on Workday holds the current answer, not the question.
 *
 * Rules, in order, for each question:
 *   1. the answer saved in the profile (gender, Hispanic/Latino, race);
 *   2. otherwise "decline" ONLY if the user ticked Decline All Disclosures;
 *   3. otherwise left unanswered for the user (and listed in the fill report).
 * Nothing is ever invented. Values never go into the report.
 */
async function fillDisclosures() {
    console.log("Workday Autoplay: Filling Disclosures...");
    const prefs = userProfile.jobPreferences || {};
    const demo = userProfile.demographics || {};
    const decline = !!prefs.autoDisclosures;
    const DECLINE = 'I do not wish to answer'; // chooseOption maps it to the tenant's own decline wording

    // Gated on the attestation, exactly like handleJobPreferences: an unticked
    // box means the question is left for the user, never answered for them.
    if (prefs.isAtLeast18) {
        await step('18 or older', () => selectWorkdayDropdown('18 years of age or older', 'Yes'));
    }

    const ask = async (name, labels, value, matcher = null) => {
        if (!value) {
            await step(name, () => labels.some(l => findDropdownForQuestion(l)) ? 'skipped' : ABSENT);
            return;
        }
        await step(name, async () => {
            for (const label of labels) {
                const r = await selectWorkdayDropdown(label, value, matcher);
                if (r !== ABSENT) return r;
            }
            return ABSENT;
        });
    };

    await ask('Gender', ['Gender', 'Sex'], demo.gender || (decline ? DECLINE : ''));
    await ask('Hispanic or Latino', ['Hispanic or Latino', 'Hispanic/Latino', 'Hispanic'], demo.hispanicLatino || (decline ? DECLINE : ''));

    // Race and ethnicity. Many forms ask it as ONE question whose options
    // include "Hispanic or Latino" (the EEO-1 combined format, where Hispanic
    // or Latino is chosen instead of a race). The profile keeps them apart, so
    // a Yes to Hispanic or Latino picks that option when the list has it, and
    // the saved race is used otherwise.
    const hispanic = demo.hispanicLatino === 'Yes';
    const hispanicOption = (opts) => opts.find(o => /\b(hispanic|latino|latina|latinx)\b/i.test(o.innerText) && !/\bnot\b/i.test(o.innerText)) || null;
    await step('Race / ethnicity', async () => {
        const value = demo.race || (decline ? DECLINE : '');
        if (!value && !hispanic) return ['Race', 'Ethnicity'].some(l => findDropdownForQuestion(l)) ? 'skipped' : ABSENT;
        for (const label of ['Race', 'Ethnicity']) {
            const trigger = findDropdownForQuestion(label);
            if (!trigger) continue;
            if (hispanic) {
                // Matcher only: "Hispanic or Latino" as the wanted text would
                // also accept a plain-word match inside "Not Hispanic or Latino".
                const r = await pickFromDropdown(trigger, '\u0000', `"${label}"`, hispanicOption);
                if (r) return true;
                if (!value) { console.warn('Workday Autoplay: this race question has no Hispanic or Latino option, and no race is saved'); return 'skipped'; }
            }
            return pickFromDropdown(trigger, value, `"${label}"`);
        }
        return ABSENT;
    });

    // Veteran status: the saved answer, mapped onto the tenant's wording.
    const veteranOption = (opts, want) => {
        const t = (o) => o.innerText.replace(/\s+/g, ' ').trim();
        const declineish = (o) => /wish|decline|answer|self-identify/i.test(t(o));
        if (/^i am not a veteran/i.test(want)) {
            // A non-veteran is also "not a protected veteran"; never "a veteran, but not protected".
            return opts.find(o => /\bnot a veteran\b/i.test(t(o)) && !declineish(o))
                || opts.find(o => /^i am not a protected veteran/i.test(t(o))) || null;
        }
        if (/veteran, but not a protected/i.test(want)) {
            return opts.find(o => /\bveteran\b.*\bnot a protected veteran/i.test(t(o)))
                || opts.find(o => /^i am not a protected veteran/i.test(t(o))) || null;
        }
        if (/identify as one or more|protected veteran/i.test(want)) {
            return opts.find(o => /identify as (one or more|a protected)|classifications of protected veteran/i.test(t(o)))
                || opts.find(o => /\bprotected veteran/i.test(t(o)) && !/\bnot\b/i.test(t(o))) || null;
        }
        return null;
    };
    await ask('Veteran status', ['Veteran Status', 'Veteran'], demo.veteranStatus || (decline ? DECLINE : ''), veteranOption);

    await step('Disability', () => fillDisability(demo.disabilityStatus || (decline ? DECLINE : ''), DECLINE));

    // The CC-305 form is signed by typing your name.
    await step('Signature name', () => fillSignatureName());

    // Auto-fill Date field in disclosure section with TODAY's date
    await fillDisclosureDate();
}

/**
 * Disability (CC-305 "Voluntary Self-Identification of Disability").
 * Workday shows it as mutually exclusive checkboxes (formField-disabilityStatus,
 * report 2026-11-24), on some tenants as radios or a dropdown. `want` is the
 * saved answer: 'Yes' | 'No' | the decline wording. Nothing saved: skipped.
 */
const DISABILITY_OPTION = {
    yes: (t) => /^\s*yes\b/i.test(t),
    no: (t) => /^\s*no\b/i.test(t),
    decline: (t) => /\b(wish|want) to answer\b|\bdecline\b|\bnot to (answer|self-identify)\b/i.test(t)
};
const disabilityKind = (want) => (/^yes\b/i.test(want) ? 'yes' : /^no\b/i.test(want) ? 'no' : 'decline');

function findDisabilityGroup() {
    const direct = document.querySelector('[data-automation-id="formField-disabilityStatus"]');
    if (direct && direct.offsetParent !== null) return direct;
    // Elsewhere: the group around an option that says "...have a disability...".
    for (const el of document.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]')) {
        if (el.offsetParent === null) continue;
        if (!checkboxLabelTexts(el).some(t => /\bhave (had )?a disability\b/i.test(t))) continue;
        const g = el.closest('[data-automation-id^="formField"], fieldset, [role="group"], [role="radiogroup"]');
        if (g) return g;
    }
    return null;
}

/** The option's own text: its label, never the question it sits under. */
function optionText(el) {
    const own = (el.id && document.querySelector(`label[for="${CSS.escape(el.id)}"]`)) || el.closest('label');
    return ((own && own.innerText) || el.getAttribute('aria-label') || '').replace(/\s+/g, ' ').trim();
}

async function fillDisability(want, DECLINE) {
    const group = findDisabilityGroup();
    if (!group) {
        if (!want) return findDropdownForQuestion('Disability') ? 'skipped' : ABSENT;
        const kind = disabilityKind(want);
        return selectWorkdayDropdown('Disability', kind === 'decline' ? DECLINE : want,
            (opts) => opts.find(o => DISABILITY_OPTION[kind](o.innerText.replace(/\s+/g, ' ').trim())) || null);
    }
    if (!want) return 'skipped';
    const kind = disabilityKind(want);
    const options = Array.from(group.querySelectorAll('input[type="checkbox"], input[type="radio"], [role="checkbox"], [role="radio"]'))
        .filter(el => !(el.getAttribute('role') && el.querySelector('input')));
    const pick = options.find(el => DISABILITY_OPTION[kind](optionText(el)));
    if (!pick) { console.warn('Workday Autoplay: no matching disability option on this form'); return false; }
    // Checkboxes here are one-of: clear any other ticked option first.
    for (const el of options) if (el !== pick && isChecked(el) && (el.type === 'checkbox' || el.getAttribute('role') === 'checkbox')) await toggleCheckbox(el, false);
    if (pick.type === 'radio' || pick.getAttribute('role') === 'radio') {
        const on = () => (pick.type === 'radio' ? pick.checked : pick.getAttribute('aria-checked') === 'true');
        if (!on()) { pick.click(); pick.dispatchEvent(new Event('change', { bubbles: true })); }
        if (await waitForCondition(on, 800)) return true;
        console.warn('Workday Autoplay: clicked the disability answer but it did not change');
        return false;
    }
    return toggleCheckbox(pick, true);
}

/**
 * The signature on the disability form: a "Name" box. Only filled on that
 * form, so a bare "Name" field elsewhere (a referrer's name) is never given
 * the user's name. Left alone if it already has something in it.
 */
function fillSignatureName() {
    if (!findDisabilityGroup()) return ABSENT;
    const field = document.querySelector('[data-automation-id="formField-name"]');
    const input = field && field.querySelector('input[type="text"], input:not([type])');
    if (!input || input.offsetParent === null) return ABSENT;
    if (input.value.trim()) return true;
    const info = userProfile.personalInfo || {};
    const name = [info.firstName, info.lastName].map(s => (s || '').trim()).filter(Boolean).join(' ');
    if (!name) return 'skipped';
    setNativeValue(input, name);
    return true;
}

// Helper function to fill the disclosure date with today's date (MM/DD/YYYY format)
async function fillDisclosureDate() {
    const today = new Date();
    const mm = String(today.getMonth() + 1).padStart(2, '0');
    const dd = String(today.getDate()).padStart(2, '0');
    const yyyy = String(today.getFullYear());

    console.log(`Workday Autoplay: Filling disclosure date with ${mm}/${dd}/${yyyy}`);

    // Method 1: Click the "Today" button if visible
    const todayBtn = document.querySelector('[data-automation-id="datePickerSelectedToday"]');
    if (todayBtn) {
        console.log("Workday Autoplay: Clicking Today button");
        todayBtn.click();
        await new Promise(r => setTimeout(r, 300));
        return;
    }

    // Method 2: Find and fill MM/DD/YYYY inputs separately
    // Look for date inputs in disclosure/self-identify sections
    const dateLabels = ['date', 'signature date', 'today'];

    for (const labelText of dateLabels) {
        // Find month input
        const monthXpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${labelText}")]/following::input[contains(@aria-label, "Month") or contains(@placeholder, "MM")][1]`;
        const monthInput = getElementByXpath(monthXpath);

        if (monthInput && !monthInput.value) {
            monthInput.click();
            setNativeValue(monthInput, mm);
            console.log(`Workday Autoplay: Filled month with ${mm}`);
        }

        // Find day input
        const dayXpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${labelText}")]/following::input[contains(@aria-label, "Day") or contains(@placeholder, "DD")][1]`;
        const dayInput = getElementByXpath(dayXpath);

        if (dayInput && !dayInput.value) {
            dayInput.click();
            setNativeValue(dayInput, dd);
            console.log(`Workday Autoplay: Filled day with ${dd}`);
        }

        // Find year input
        const yearXpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${labelText}")]/following::input[contains(@aria-label, "Year") or contains(@placeholder, "YYYY")][1]`;
        const yearInput = getElementByXpath(yearXpath);

        if (yearInput && !yearInput.value) {
            yearInput.click();
            setNativeValue(yearInput, yyyy);
            console.log(`Workday Autoplay: Filled year with ${yyyy}`);
        }

        if (monthInput || dayInput || yearInput) {
            break; // Found date fields, stop searching
        }
    }

    // Method 3: Fallback - look for any empty date section inputs in disclosure area
    const allDateInputs = document.querySelectorAll('input[data-automation-id*="dateSection"], input[aria-label*="Month"], input[aria-label*="Day"], input[aria-label*="Year"]');

    allDateInputs.forEach(input => {
        const ariaLabel = (input.getAttribute('aria-label') || '').toLowerCase();
        const placeholder = (input.placeholder || '').toLowerCase();

        if (!input.value) {
            if (ariaLabel.includes('month') || placeholder.includes('mm')) {
                input.click();
                setNativeValue(input, mm);
            } else if (ariaLabel.includes('day') || placeholder.includes('dd')) {
                input.click();
                setNativeValue(input, dd);
            } else if (ariaLabel.includes('year') || placeholder.includes('yyyy')) {
                input.click();
                setNativeValue(input, yyyy);
            }
        }
    });
}

// Wording that identifies a terms / acknowledgement checkbox by its OWN name.
const TERMS_PATTERNS = /i agree|i accept|i consent|i acknowledge|i have read|i certify|terms (and conditions|of use|of service)|privacy (policy|notice|statement)/i;

// Boxes that must never be ticked from the terms path however the surrounding
// markup reads. "I currently work here" is a factual claim about the user's
// employment, not an acknowledgement, and getting it wrong silently changes
// what the application says about them.
const NEVER_TERMS = /currently work here|current job|current employer|18 years|veteran|disab|sponsor|authoriz/i;

async function handleTerms() {
    // Match on the checkbox's own name.
    //
    // The old lookup was an XPath that selected a checkbox because some LATER
    // SIBLING label matched "I agree" / "terms" / "read" —
    //
    //   //input[@type="checkbox"]/following::label[contains(text(), "read")]
    //     /preceding-sibling::input[@type="checkbox"]
    //
    // so the box it ticked need never have had anything to do with terms; it
    // only had to sit before one. It also took the FIRST match in document
    // order, which on a page with several checkboxes is the earliest box, not
    // the relevant one. And "read" is a substring of "already", so the label
    // did not have to be about terms either.
    //
    // This runs unconditionally on every scan, on every page, and could only
    // ever tick — never clear. That combination is how a checkbox nobody asked
    // for ends up set. Reported 2026-08-24.
    const target = checkboxCandidates(document).find(box => {
        const texts = checkboxLabelTexts(box);
        if (!texts.length) return false;
        if (texts.some(t => NEVER_TERMS.test(t))) return false;
        return texts.some(t => TERMS_PATTERNS.test(t));
    });

    if (!target) {
        console.log('Workday Autoplay: no terms checkbox identified on this page, ticking nothing.');
        return ABSENT;
    }
    if (isChecked(target)) return true;

    const name = checkboxLabelTexts(target)[0].trim().slice(0, 80);
    console.log(`Workday Autoplay: Checking Terms & Conditions — "${name}"`, target);
    return toggleCheckbox(target, true);
}

// "Decline to self-identify", "I do not wish to answer", "I prefer not to say", ...
const DECLINE_RE = /decline|do not wish|don['’]?t wish|not wish to|prefer not|choose not|not to (answer|disclose|self)/i;
const STOP_WORDS = new Set(['i', 'am', 'a', 'an', 'the', 'to', 'of', 'or', 'and', 'my', 'is']);

/** The best option for `desired` among open options, or null. Placeholders never count. */
function chooseOption(options, desired, matcher = null) {
    const real = options.filter(o => o.getAttribute('aria-disabled') !== 'true' && !/^select one$/i.test(o.innerText.trim()));
    const text = (o) => o.innerText.replace(/\s+/g, ' ').trim();
    const want = String(desired).trim();
    const lower = want.toLowerCase();
    return real.find(o => text(o) === want)
        || real.find(o => text(o).toLowerCase() === lower)
        || (matcher && matcher(real, want))
        || (DECLINE_RE.test(want) ? real.find(o => DECLINE_RE.test(text(o))) : null)
        || (() => {
            // Every meaningful word of the wanted answer present: "I am not a veteran"
            // finds "I am not a protected veteran".
            const words = lower.split(/[^a-z0-9]+/).filter(w => w && !STOP_WORDS.has(w));
            if (!words.length) return null;
            return real.find(o => {
                const t = text(o).toLowerCase();
                return words.every(w => new RegExp(`\\b${escapeRegExp(w)}\\b`).test(t));
            }) || null;
        })()
        || real.find(o => text(o).toLowerCase().includes(lower))
        || null;
}

/**
 * The dropdown that answers the question `label`. Workday's question pages put
 * the question in a <fieldset><legend>, and the button's aria-label is the
 * CURRENT ANSWER (" Yes Required", tools/LegallyAuthorized.png), so label- and
 * aria-label lookups never found these. Container first, whole-word match.
 */
// Workday's own field ids for the self-ID questions. Some tenants word the
// question as a legal paragraph that never names it (HUB International's gender
// question, report 2026-11-24), so the label can't be matched; the id still can.
const QUESTION_FIELD_IDS = {
    gender: ['gender'], sex: ['gender'],
    'hispanic or latino': ['hispanicOrLatino'], 'hispanic/latino': ['hispanicOrLatino'], hispanic: ['hispanicOrLatino'],
    race: ['ethnicity', 'race'], ethnicity: ['ethnicity'],
    'veteran status': ['veteranStatus'], veteran: ['veteranStatus'],
    disability: ['disabilityStatus']
};

function findDropdownForQuestion(label) {
    const found = findDropdownByLabel(label);
    if (found) return found;
    for (const id of QUESTION_FIELD_IDS[label.toLowerCase()] || []) {
        const btn = SCOPE.querySelector(`[data-automation-id="formField-${id}"] button[aria-haspopup="listbox"]`);
        if (btn && btn.offsetParent !== null) return btn;
    }
    return null;
}

function findDropdownByLabel(label) {
    const re = new RegExp(`(^|[^a-z0-9])${escapeRegExp(label.toLowerCase())}([^a-z0-9]|$)`);
    const textOf = (n) => (n ? (n.innerText || n.textContent || '').replace(/\s+/g, ' ').toLowerCase() : '');
    for (const sel of ['fieldset', 'div[data-automation-id^="formField"]']) {
        for (const box of SCOPE.querySelectorAll(sel)) {
            const q = box.querySelector(':scope > legend, :scope label, :scope legend');
            if (!q || !re.test(textOf(q))) continue;
            const btn = box.querySelector('button[aria-haspopup="listbox"]');
            if (btn && btn.offsetParent !== null) return btn;
        }
    }
    const lower = label.toLowerCase();
    return getElementByXpath(`//label[contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${lower}")]/following::div[@data-automation-id="selectSelectedOption" or @data-automation-id="selectWidget"][1]`)
        || null;
}

function closeOpenListbox(trigger) {
    const t = document.activeElement || trigger;
    t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
}

/**
 * Open the dropdown for `label`, pick the option for `desiredValue`, and only
 * report success when the dropdown then SHOWS that option. Returns ABSENT when
 * the question isn't on this page.
 */
async function selectWorkdayDropdown(label, desiredValue, matcher = null) {
    try {
        const trigger = findDropdownForQuestion(label);
        if (!trigger) return ABSENT;
        return await pickFromDropdown(trigger, desiredValue, label, matcher);
    } catch (e) {
        console.warn(`Workday Autoplay: error choosing an option for ${label}: ${e.message}`);
        return false;
    }
}

async function pickFromDropdown(trigger, desiredValue, label, matcher = null) {
    const shown = () => (trigger.innerText || '').replace(/\s+/g, ' ').trim();
    const before = shown();
    if (before && !/^select one$/i.test(before)) {
        const probe = { innerText: before, getAttribute: () => null };
        if (chooseOption([probe], desiredValue, matcher)) return true; // already answered this way
    }

    // Only options that appear AFTER this click count. Workday leaves the
    // previous question's menu in the DOM, and the old "any open menu" wait
    // resolved instantly on it: the click then landed on the PREVIOUS question
    // (2026-11-24: sponsorship "chose an option but still shows Select One",
    // straight after work authorization had been answered).
    const stale = new Set(document.querySelectorAll(OPTION_SELECTOR));
    const fresh = () => Array.from(document.querySelectorAll('ul[role="listbox"], div[role="listbox"]'))
        .filter(l => l.getAttribute('data-automation-id') !== 'selectedItemList' && l.getBoundingClientRect().height > 0)
        .flatMap(l => Array.from(l.querySelectorAll(OPTION_SELECTOR)))
        .filter(o => !stale.has(o));
    scrollIntoViewIfNeeded(trigger);
    trigger.click();
    if (!await waitForCondition(() => fresh().length > 0, 3000)) {
        console.warn(`Workday Autoplay: the ${label} dropdown did not open`);
        closeOpenListbox(trigger);
        return false;
    }
    const options = fresh();
    const option = chooseOption(options, desiredValue, matcher);
    if (!option) {
        const sample = options.map(o => o.innerText.trim()).filter(Boolean).slice(0, 8).join(' | ');
        console.warn(`Workday Autoplay: no matching option for ${label} (options: ${sample})`);
        closeOpenListbox(trigger);
        return false;
    }
    const want = option.innerText.replace(/\s+/g, ' ').trim();
    await commitOptionSelection(option, label);
    const stuck = await waitForCondition(() => shown() === want || (trigger.getAttribute('aria-label') || '').includes(want), 1500);
    if (!stuck) console.warn(`Workday Autoplay: chose an option for ${label} but the dropdown still shows "${shown() || 'nothing'}"`);
    await new Promise(r => setTimeout(r, 200));
    return stuck;
}

async function selectByAriaLabel(ariaLabelKeyword, desiredValue) {
    // Find button/div with aria-label containing the keyword
    const elements = document.querySelectorAll('[aria-label]');
    let trigger = null;

    for (const el of elements) {
        const ariaLabel = el.getAttribute('aria-label').toLowerCase();
        if (ariaLabel.includes(ariaLabelKeyword.toLowerCase()) &&
            (el.tagName === 'BUTTON' || el.getAttribute('role') === 'combobox' || el.getAttribute('data-automation-id'))) {
            trigger = el;
            break;
        }
    }

    if (!trigger) return false;

    // Check if already set
    if (trigger.innerText && trigger.innerText.includes(desiredValue)) {
        console.log(`Workday Autoplay: ${ariaLabelKeyword} already set to ${desiredValue} (via aria-label)`);
        return true;
    }

    console.log(`Workday Autoplay: Opening dropdown for ${ariaLabelKeyword} (via aria-label)`);
    trigger.click();

    await new Promise(r => setTimeout(r, 500));

    // Try to find the option with exact or partial match
    const optionXpath = `//div[@role="option" and contains(text(), "${desiredValue}")]`;
    let option = getElementByXpath(optionXpath);

    // Try case-insensitive partial match
    if (!option) {
        const options = document.querySelectorAll('div[role="option"]');
        for (const opt of options) {
            if (opt.innerText.toLowerCase().includes(desiredValue.toLowerCase())) {
                option = opt;
                break;
            }
        }
    }

    if (option) {
        console.log(`Workday Autoplay: Selecting ${desiredValue} for ${ariaLabelKeyword} (via aria-label)`);
        option.click();
        await new Promise(r => setTimeout(r, 500));
        return true;
    }

    console.warn(`Workday Autoplay: Option '${desiredValue}' not found for ${ariaLabelKeyword} (via aria-label)`);
    return false;
}

function setNativeValue(element, value) {
    const lastValue = element.value;
    element.value = value;
    const tracker = element._valueTracker;
    if (tracker) tracker.setValue(lastValue);

    let proto = element.constructor.prototype;
    if (element instanceof HTMLInputElement) proto = window.HTMLInputElement.prototype;
    else if (element instanceof HTMLTextAreaElement) proto = window.HTMLTextAreaElement.prototype;
    else if (element instanceof HTMLSelectElement) proto = window.HTMLSelectElement.prototype;

    const nativeInputValueSetter = Object.getOwnPropertyDescriptor(proto, "value").set;
    if (nativeInputValueSetter) nativeInputValueSetter.call(element, value);

    element.dispatchEvent(new Event('input', { bubbles: true }));
    element.dispatchEvent(new Event('change', { bubbles: true }));
    element.dispatchEvent(new Event('blur', { bubbles: true }));
    console.log(`Workday Autoplay: Filled ${value} into`, element);
}

function getElementByXpath(path) {
    try {
        // Inside a panel scope, absolute "//x" paths become relative ".//x".
        const scoped = SCOPE !== document;
        const expr = scoped ? path.split(' | ').map(p => p.trim().replace(/^\/\//, './/')).join(' | ') : path;
        return document.evaluate(expr, SCOPE, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (e) {
        console.error("XPath error", e);
        return null;
    }
}

async function waitForCondition(checkFn, timeout = 5000, interval = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        if (checkFn()) return true;
        await new Promise(r => setTimeout(r, interval));
    }
    return false;
}

function isElementVisible(el) {
    if (!el) return false;
    const rect = el.getBoundingClientRect();
    return rect.height > 0 && rect.width > 0 && rect.top < window.innerHeight && rect.bottom > 0;
}

function scrollIntoViewIfNeeded(el) {
    if (!isElementVisible(el)) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
}

/**
 * Click a dropdown option and confirm the selection actually took.
 *
 * `el.click()` dispatches ONLY a click event — no pointerdown/mousedown/mouseup.
 * Workday rows frequently commit on mousedown so the menu tears down before the
 * input blurs, in which case the bare click reaches no handler at all and the
 * row just sits there highlighted. Observed on Country in My Information: the
 * correct row highlights and nothing is selected.
 *
 * The pointer replay is ESCALATION ONLY. When the plain click already works
 * nothing extra is dispatched, which keeps multiselect widgets from toggling a
 * freshly-set value straight back off.
 */
async function commitOptionSelection(option, label = '', alsoCommitted = null) {
    if (!option) return false;
    scrollIntoViewIfNeeded(option);

    // Options are <li role="option"><div>Text</div></li> and the handler may be
    // bound to the inner element. Events bubble up, so dispatching on the leaf
    // covers a handler at any level; dispatching on the li would not reach it.
    const leaf = Array.from(option.querySelectorAll('*'))
        .find(el => el.children.length === 0 && el.textContent.trim());
    const target = leaf || option;

    // Do NOT verify by watching the popper tear down. Country commits and leaves
    // its menu open (tools/FoundbutNotSelected.png shows aria-selected="true" on
    // the row with the trigger already reading "United States of America"), so a
    // teardown check reads that success as a failure and escalates for nothing.
    // Either the row reports itself selected, or the menu closed and took the
    // node with it.
    // `alsoCommitted` lets a caller supply proof of its own. A searchable
    // picker's suggestion is a <p>, which carries no aria-selected, so success
    // would otherwise rest entirely on the menu tearing down — and Workday menus
    // demonstrably do not always tear down (Country's stayed open). Without this,
    // a successful pick on a multiselect reads as a failure, the pointer replay
    // below fires, and the field gets a SECOND pill.
    const committed = () => option.getAttribute('aria-selected') === 'true'
        || !option.isConnected
        || (alsoCommitted ? alsoCommitted() : false);

    target.click();
    if (await waitForCondition(committed, 600)) return true;

    console.log(`Workday Autoplay: plain click did not commit${label ? ` for ${label}` : ''}, replaying pointer sequence`);
    const rect = target.getBoundingClientRect();
    const init = {
        bubbles: true,
        cancelable: true,
        composed: true,
        view: window,
        button: 0,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2
    };
    for (const type of ['pointerdown', 'mousedown', 'mouseup', 'click']) {
        const Ctor = type.startsWith('pointer') && window.PointerEvent ? PointerEvent : MouseEvent;
        target.dispatchEvent(new Ctor(type, init));
    }

    const ok = await waitForCondition(committed, 600);
    if (!ok) console.warn(`Workday Autoplay: option did not commit${label ? ` for ${label}` : ''} even after pointer replay`);
    return ok;
}

/**
 * Degree matching.
 *
 * The generic exact -> case-insensitive -> substring chain cannot connect the
 * ways a degree gets written. Every one of these is a real miss:
 *
 *   "BS"                  vs "Bachelor of Science"  -> substring is false
 *   "Bachelors"           vs "Bachelor's Degree"    -> the apostrophe alone breaks it
 *   "Bachelor of Science" vs "Bachelors"            -> substring is false
 *
 * And the substring fallback does not merely miss, it mis-picks: "BA" is a
 * substring of "Bachelor of Science" (via "BAchelor"), so a BA silently
 * selects a BS. Reduce both sides to a level (+ field where stated) instead.
 *
 * Deliberately NOT applied to dropdowns generally -- Country and State are
 * matched literally and are working.
 */
function normalizeDegreeText(text) {
    return String(text || '')
        .toLowerCase()
        .replace(/[‘’']/g, '')  // bachelor's -> bachelors
        .replace(/\./g, '')               // B.S. -> bs
        .replace(/[^a-z0-9]+/g, ' ')
        .trim();
}

// Ordered: the first match wins, so the more specific level is listed first.
const DEGREE_LEVEL_PATTERNS = [
    ['doctorate', /\b(doctor|doctorate|doctoral|phd|dphil|edd|dsc|md|jd)\b/],
    ['master', /\b(master|masters|ms|msc|ma|mba|meng|mfa|mph|msw)\b/],
    ['bachelor', /\b(bachelor|bachelors|bs|bsc|ba|bba|beng|bfa|bsn)\b/],
    ['associate', /\b(associate|associates|aa|as|aas)\b/],
    ['highschool', /\b(high school|hs|ged|secondary)\b/]
];

function degreeLevel(normalized) {
    for (const [level, re] of DEGREE_LEVEL_PATTERNS) {
        if (re.test(normalized)) return level;
    }
    return null;
}

// Ordered: business and fine arts are checked before plain arts so that "MBA"
// and "BFA" are not read as generic arts degrees.
function degreeField(normalized) {
    if (/\b(bba|mba)\b|business administration/.test(normalized)) return 'business';
    if (/\b(bfa|mfa)\b|fine arts/.test(normalized)) return 'finearts';
    if (/\b(beng|meng)\b|engineering/.test(normalized)) return 'engineering';
    if (/\b(bs|bsc|ms|msc|bsn)\b|science/.test(normalized)) return 'science';
    if (/\b(ba|ma)\b|arts/.test(normalized)) return 'arts';
    return null;
}

function matchDegreeOption(options, desiredValue) {
    const wanted = normalizeDegreeText(desiredValue);
    const wantedLevel = degreeLevel(wanted);
    if (!wantedLevel) return null;

    const sameLevel = options
        .map(el => {
            const norm = normalizeDegreeText(el.innerText);
            return { el, level: degreeLevel(norm), field: degreeField(norm) };
        })
        .filter(o => o.level === wantedLevel);

    if (!sameLevel.length) return null;

    const wantedField = degreeField(wanted);
    if (wantedField) {
        const bothMatch = sameLevel.find(o => o.field === wantedField);
        if (bothMatch) return bothMatch.el;
    }

    // A generic option ("Bachelor's Degree") states the level and nothing else,
    // so it is always a safe answer for the right level.
    const generic = sameLevel.find(o => !o.field);
    if (generic) return generic.el;

    // Level is known, but the list forces a choice of field the profile does not
    // settle -- "Bachelors" against both "Bachelor of Arts" and "Bachelor of
    // Science". Guessing writes a degree the user does not hold onto a job
    // application, which is worse than the blank they can see and correct.
    if (sameLevel.length > 1) return null;

    return sameLevel[0].el;
}

// Every dropdown seen on Duke Energy uses role="option". listitem is carried
// over from what handleDropdown matched previously, so that scoping these
// lookups does not quietly drop support for a Workday variant we have not
// captured.
const OPTION_SELECTOR = '[role="option"], [role="listitem"]';

/**
 * Locate the dropdown that is currently OPEN.
 *
 * Workday portals an open dropdown to the very end of <body>, outside #root,
 * inside a popper wrapper:
 *
 *   <div data-popper-placement="bottom"><div visibility="opened">
 *     <ul role="listbox"><li role="option"><div>Mobile</div></li>…
 *
 * Separately, every multiselect pill widget INSIDE #root carries its own
 * listbox holding the currently-selected pills as role="option":
 *
 *   <ul role="listbox" data-automation-id="selectedItemList" aria-label="items selected">
 *     <li role="presentation"><div role="option">Purdue University, Calumet</div>
 *
 * An unscoped document.querySelector('[role="listbox"]') returns whichever comes
 * first in document order, which is a pill container, and its single selected
 * pill then reads as the entire option list. That produced "Found 1 options" on
 * every dropdown and made State and referral-source selection fail silently.
 * It also made autofill look intermittent: it only misbehaves once some pill
 * widget on the page is populated.
 */
function findOpenListbox() {
    const candidates = Array.from(document.querySelectorAll('ul[role="listbox"], div[role="listbox"]'))
        .filter(el => el.getAttribute('data-automation-id') !== 'selectedItemList')
        // Rendered check only. Deliberately NOT a viewport test: the popper is
        // absolutely positioned and can sit outside the current scroll window.
        .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });

    if (!candidates.length) return null;

    // Prefer the portalled one when present; otherwise consider everything left.
    const portalled = candidates.filter(el => el.closest('[data-popper-placement], [visibility="opened"]'));
    const pool = portalled.length ? portalled : candidates;

    // Workday does not reliably tear down the previous popper, so SEVERAL can be
    // open at once. Confirmed on Duke Energy (tools/State-inspectElement-New.png):
    // Country's list was still up when State opened, so picking whichever list
    // carried the most options meant every later dropdown read Country's 250
    // entries — "Found 250 options for State" followed by "Option 'Indiana' not
    // found for State", and the same for the referral-source dropdown.
    //
    // Poppers are appended to the end of <body>, and querySelectorAll returns
    // document order, so the LAST one carrying options is the one just opened.
    const withOptions = pool.filter(el => el.querySelectorAll(OPTION_SELECTOR).length > 0);
    const ordered = withOptions.length ? withOptions : pool;
    return ordered[ordered.length - 1] || null;
}

function getOpenListboxOptions() {
    const listbox = findOpenListbox();
    return listbox ? Array.from(listbox.querySelectorAll(OPTION_SELECTOR)) : [];
}

/**
 * Suggestions from an OPEN searchable picker, never already-selected pills.
 *
 * data-automation-id="promptOption" is not unique to dropdown suggestions — it
 * is also the selected pill's own text (tools/School-inspectElement.png):
 *
 *   <div role="option" data-automation-id="selectedItem"
 *        aria-label="Purdue University, Calumet, press delete to clear value.">
 *     <div data-automation-id="DELETE_charm" role="presentation">
 *     <p data-automation-id="promptOption"
 *        data-automation-label="Purdue University, Calumet">Purdue University, Calumet</p>
 *
 * An unscoped lookup therefore returns pills, which broke handleSearchablePicker
 * two ways: its "wait for suggestions" resolved instantly off a pill that was
 * already on the page, and its "no exact match, click the first option" fallback
 * could click a pill — next to a DELETE charm — and clear a field that was
 * already filled correctly.
 */
function getOpenPromptOptions() {
    const suggestions = Array.from(document.querySelectorAll('[data-automation-id="promptOption"]'))
        .filter(el => !el.closest('[data-automation-id="selectedItemList"], [data-automation-id="selectedItem"]'))
        .filter(el => {
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0;
        });

    // Same portal preference as findOpenListbox: when Workday has popped a menu,
    // only that menu's entries count.
    const portalled = suggestions.filter(el => el.closest('[data-popper-placement], [visibility="opened"]'));
    return portalled.length ? portalled : suggestions;
}

/**
 * Rank picker suggestions by how close they are to the user's stored value.
 *
 * Used when nothing matches exactly or by substring. School lists are full of
 * near-misses — "Purdue University Northwest", "Purdue University Fort Wayne",
 * "Purdue University, Calumet" — where taking whichever happened to be listed
 * first is a coin flip. Dice coefficient over word tokens, so shared words
 * count regardless of order or punctuation.
 */
function suggestionTokens(text) {
    return new Set(
        String(text || '')
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, ' ')
            .trim()
            .split(/\s+/)
            .filter(t => t.length > 1)
    );
}

function suggestionSimilarity(a, b) {
    const ta = suggestionTokens(a);
    const tb = suggestionTokens(b);
    if (!ta.size || !tb.size) return 0;

    let shared = 0;
    for (const t of ta) if (tb.has(t)) shared++;
    return (2 * shared) / (ta.size + tb.size);
}

function closestSuggestion(suggestions, value, textOf) {
    let best = null;
    let bestScore = 0;
    for (const el of suggestions) {
        const score = suggestionSimilarity(value, textOf(el));
        if (score > bestScore) {
            best = el;
            bestScore = score;
        }
    }
    return best ? { el: best, score: bestScore } : null;
}

/**
 * The text input of a searchable/multiselect field.
 *
 * There is no data-automation-id="searchBox" on Duke Energy's form — that is the
 * whole of F2. The input sits inside the multiselect's own input container,
 * under data-automation-hiddensearch, and the field's <label for> points
 * straight at it (<label for="education-20--school"> against a container
 * carrying data-fkit-id="education-20--school").
 */
function findSearchInputIn(container, label) {
    if (!container) return null;

    const forId = label && label.getAttribute('for');
    if (forId) {
        const byFor = document.getElementById(forId);
        if (byFor && byFor.tagName === 'INPUT') return byFor;
    }

    // searchBox first so Workday tenants that do emit it keep their old path.
    return container.querySelector('input[data-automation-id="searchBox"]')
        || container.querySelector('[data-automation-id="multiselectInputContainer"] input[type="text"]')
        || container.querySelector('[data-automation-hiddensearch] input')
        || container.querySelector('input[type="text"]:not([aria-hidden="true"])');
}

/**
 * PHASE 5: SMART OBSERVER & QUESTIONS (The "Brain")
 */

let observer = null;
function startObserver() {
    if (observer) return; // Already running
    console.log("Workday Autoplay: Starting MutationObserver...");

    observer = new MutationObserver((mutations) => {
        // Don't trigger if we're already scanning
        if (isScanning) return;

        // Only trigger if URL has changed (user navigated to new page)
        const currentUrl = window.location.href;
        if (currentUrl === lastScannedUrl) return;

        let shouldScan = false;
        for (const mutation of mutations) {
            if (mutation.addedNodes.length > 0) {
                shouldScan = true;
                break;
            }
        }

        if (shouldScan) {
            // Debounce scan
            if (window.scanTimeout) clearTimeout(window.scanTimeout);
            window.scanTimeout = setTimeout(() => {
                if (!isScanning && window.location.href !== lastScannedUrl) {
                    console.log("Workday Autoplay: New page detected, Re-Scanning...");
                    scanAndFill();
                }
            }, 2000);
        }
    });

    const body = document.querySelector('body');
    if (body) {
        observer.observe(body, { childList: true, subtree: true });
    }
}

// REQUIREMENT 2 & 3: Handler for Job Preferences (Smart Questions)
async function handleJobPreferences() {
    if (!userProfile.jobPreferences) return;
    const prefs = userProfile.jobPreferences;

    console.log("Workday Autoplay: Handling Job Preferences Questions...");

    // 1. Former Employee
    // Keywords: "former employee", "previous employee", "worked here before", "employed by"
    const formerKeywords = [
        'former employee',
        'previous employee',
        'worked here before',
        'employed by',
        'worked for',
        'previously worked'
    ];
    // Only questions about THIS employer. "employed by" / "worked for" also
    // appear in government-service questions ("Present and former federal
    // government employees ... employed by the U.S. Government"), which the
    // former-employee checkbox says nothing about (Motorola, 2026-11-24).
    const OTHER_EMPLOYER = /\b(government|federal|state or local|public (official|office|sector)|military|armed forces|DoD|department of defense|agency|another employer|non-?compete)\b/i;
    for (const block of findQuestionBlocks(formerKeywords)) {
        if (OTHER_EMPLOYER.test(block.text)) {
            console.log(`Workday Autoplay: "${block.text.slice(0, 60)}" is about another employer, leaving it for the user.`);
            continue;
        }
        if (await answerQuestionBlock(block, prefs.formerEmployee ? 'Yes' : 'No')) break;
    }

    // Age has its OWN profile field, deliberately not folded into
    // authorizedToWork below: a user who unchecks work authorization must not
    // thereby answer "No" to being 18 or older, which would be a false
    // statement on a job application.
    //
    // Unticked means UNANSWERED, not "No". Nobody's age gets asserted by a
    // default, so when the box is off the question is left for the user.
    const ageKeywords = [
        '18 years or older',
        '18 years of age',
        'at least 18',
        'over the age of 18',
        'older than 18'
    ];
    if (prefs.isAtLeast18) {
        await answerYesNo(ageKeywords, 'Yes');
    } else {
        console.log('Workday Autoplay: "18 or older" not confirmed in the profile, leaving that question for the user.');
    }

    // 2. Authorization and sponsorship — classified together, on purpose.
    //
    // These two rules used to run one after the other, each calling
    // answerYesNo with its own keyword list. Workday routinely asks both things
    // in ONE sentence:
    //
    //   "Are you legally authorized to work in the United States without
    //    requiring sponsorship for an employment visa?"
    //
    // Both keyword lists claim that block. The sponsorship rule ran second, and
    // its default answer is No, so it overwrote the correct Yes — the "legally
    // authorized to work" dropdown mysteriously reading No that the user
    // reported on 2026-08-24. Nothing in the console said so, because from each
    // rule's own point of view it had answered its question correctly.
    //
    // So every candidate block is classified ONCE, up front, and exactly one
    // rule answers it. Same shape as the age/authorization split above: when two
    // rules can claim a question, decide which one owns it rather than letting
    // DOM order decide.
    const authKeywords = [
        'legally authorized',
        'authorized to work',
        'legal right to work',
        'lawfully work',
        // Observed wording that matched none of the above: "Are you legally
        // eligible to work in the country to which you are applying?" --
        // eligible, not authorized.
        'legally eligible',
        'eligible to work'
    ];

    // 3. Sponsorship
    // Keywords: "sponsorship", "require sponsorship", "support for immigration", "visa"
    const sponsorKeywords = [
        'sponsorship',
        'immigration',
        'visa',
        'work permit',
        'require sponsorship',
        'need sponsorship'
    ];

    const authBlocks = [];
    const sponsorBlocks = [];
    for (const block of findQuestionBlocks([...authKeywords, ...sponsorKeywords])) {
        const isAuth = matchesAny(block.text, authKeywords);
        const isSponsor = matchesAny(block.text, sponsorKeywords);
        if (isAuth) authBlocks.push({ block, isSponsor });
        else if (isSponsor) sponsorBlocks.push(block);
    }

    for (const { block, isSponsor } of authBlocks) {
        // A compound "authorized to work WITHOUT sponsorship" question is Yes
        // only when both halves hold. A user who is authorized but still needs
        // sponsorship must answer No to it, and answering Yes would be a false
        // statement on a job application.
        const yes = isSponsor
            ? (prefs.authorizedToWork !== false && !prefs.requiresSponsorship)
            : prefs.authorizedToWork !== false;
        if (isSponsor) {
            console.log(`Workday Autoplay: "${block.text.slice(0, 60)}" asks about authorization AND sponsorship — answering ${yes ? 'Yes' : 'No'}.`);
        }
        await answerQuestionBlock(block, yes ? 'Yes' : 'No');
    }

    for (const block of sponsorBlocks) {
        await answerQuestionBlock(block, prefs.requiresSponsorship ? 'Yes' : 'No');
    }

    // 4. Referral Source (REQUIREMENT 2: Source Dropdown)
    // "How did you hear about us?" dropdown
    const hearKeys = ['how did you hear', 'where did you hear', 'how did you find'];
    if (!prefs.sourceReferral) {
        await step('How did you hear about us', () => findQuestionBlocks(hearKeys).length ? 'skipped' : ABSENT);
    } else {
        console.log(`Workday Autoplay: Setting referral source to ${prefs.sourceReferral}`);

        // Try multiple common variations of this question
        const sourceKeywords = [
            'how did you hear about us',
            'source',
            'referral source',
            'where did you hear',
            'how did you find'
        ];

        // Found by the question text (legend/label); the old aria-label lookup
        // matched the dropdown's current VALUE, never the question.
        await step('How did you hear about us', async () => {
            for (const keyword of sourceKeywords) {
                const r = await selectWorkdayDropdown(keyword, prefs.sourceReferral);
                if (r !== ABSENT) return r;
            }
            // Many tenants render it as a search box with a prompt list
            // (formField-source), not a listbox button. Proof of a pick is the pill.
            const block = findQuestionBlocks(hearKeys)[0];
            if (!block) return ABSENT;
            return pickNestedPrompt(block.container, prefs.sourceReferral);
        });
    }

    // 5. US Citizenship. Answered Yes ONLY when the user ticked "I am a U.S.
    // citizen". This used to answer Yes for everyone, which is a false
    // statement on an application for anyone who isn't a citizen. Unticked
    // means unanswered (never "No": unticked can just mean "not set").
    if (prefs.usCitizen) {
        const citizenshipKeywords = [
            'citizen of the united states',
            'u.s. citizen',
            'us citizen',
            'united states citizen',
            'are you a citizen'
        ];
        // Radios or a dropdown inside the question's own block first, then a
        // dropdown found by its question text.
        let citizenAnswered = await answerYesNo(citizenshipKeywords, 'Yes');
        if (!citizenAnswered) {
            await step('U.S. citizen', async () => {
                for (const label of ['citizen of the United States', 'U.S. Citizen', 'citizenship']) {
                    const r = await selectWorkdayDropdown(label, 'Yes');
                    if (r !== ABSENT) return r;
                }
                return ABSENT;
            });
        }
    } else {
        console.log('Workday Autoplay: citizenship question left for the user ("I am a U.S. citizen" not ticked).');
    }
}

/**
 * NESTED SEARCH-BOX MENUS ("How Did You Hear About Us?").
 *
 * Shape (tools/captures/private, 2026-11-23): a search <input> in
 * formField-source; the menu is portalled as activeListContainer with
 * menuItem > promptLeafNode > promptOption[data-automation-label]. The top level
 * holds CATEGORIES ("Job Board", "Recruiting Source"); clicking one replaces the
 * list with its children under a multiSelectHeader with a backButton. Children
 * are choices, each carrying a radioBtn. A pick shows as a selectedItem pill.
 *
 * Never guesses: the old picker took the "closest" suggestion when nothing
 * matched, which on this widget meant a category or an unrelated source.
 */
const promptNorm = (t) => String(t || '').toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim();
function promptMatches(label, want) {
    const l = promptNorm(label), w = promptNorm(want);
    if (!l || !w) return false;
    if (l === w) return true;
    const words = l.split(' ');
    return w.split(' ').every(x => words.includes(x)); // "Indeed" in "Job Board - Indeed.com"
}
function openPromptList() {
    return Array.from(document.querySelectorAll('[data-automation-id="activeListContainer"]'))
        .filter(l => l.offsetParent !== null || l.getBoundingClientRect().height > 0).pop() || null;
}
function promptItems() {
    const list = openPromptList();
    if (!list) return [];
    return Array.from(list.querySelectorAll('[data-automation-id="menuItem"]')).map(item => {
        const opt = item.querySelector('[data-automation-id="promptOption"]');
        return {
            item, opt,
            label: opt ? (opt.getAttribute('data-automation-label') || opt.textContent || '').trim() : '',
            leaf: !!item.querySelector('input[type="radio"], input[type="checkbox"]')
        };
    }).filter(x => x.opt);
}
function promptBackButton() {
    const list = openPromptList();
    const scope = (list && list.closest('[data-automation-id="responsiveMonikerPrompt"]')) || document;
    return scope.querySelector('[data-automation-id="backButton"]');
}

async function pickNestedPrompt(field, want) {
    const pills = () => field.querySelectorAll('[data-automation-id="selectedItem"]').length;
    if (pills()) return true; // already answered (by the user or an earlier pass): leave it
    const input = field.querySelector('input[data-automation-id="searchBox"], [data-automation-id="multiselectInputContainer"] input, input[type="text"], input:not([type])');
    if (!input) return ABSENT;

    const choose = async (x) => {
        const before = pills();
        await commitOptionSelection(x.opt, 'How did you hear about us', () => pills() > before);
        return waitForCondition(() => pills() > before, 1500);
    };
    const close = () => {
        input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', keyCode: 27, bubbles: true }));
    };

    // 1. Search. Workday runs the search on Enter; results are flat choices.
    scrollIntoViewIfNeeded(input);
    input.focus();
    setNativeValue(input, want);
    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', keyCode: 13, bubbles: true }));
    await waitForCondition(() => promptItems().some(x => promptMatches(x.label, want)), 2000);
    let hit = promptItems().find(x => x.leaf && promptMatches(x.label, want))
        || promptItems().find(x => promptMatches(x.label, want));
    if (hit && await choose(hit)) return true;

    // 2. Browse: open the top level, then each category in turn.
    setNativeValue(input, '');
    input.click();
    const icon = field.querySelector('[data-automation-id="promptIcon"]');
    if (!await waitForCondition(() => promptItems().length > 0, 1500) && icon) {
        icon.click();
        await waitForCondition(() => promptItems().length > 0, 1500);
    }
    // Leave the menu at the top level even if the search left it inside a category.
    for (let i = 0; i < 3 && promptBackButton(); i++) { promptBackButton().click(); await new Promise(r => setTimeout(r, 300)); }

    const top = promptItems();
    if (!top.length) { console.warn('Workday Autoplay: the How did you hear about us menu did not open'); return false; }
    hit = top.find(x => promptMatches(x.label, want));
    if (hit) {
        const before = pills();
        hit.opt.click();
        await new Promise(r => setTimeout(r, 400));
        if (pills() > before) return true;              // it was a choice
        const sub = promptItems().find(x => promptMatches(x.label, want)); // a category named like the answer
        if (sub && promptBackButton() && await choose(sub)) return true;
        if (promptBackButton()) { promptBackButton().click(); await new Promise(r => setTimeout(r, 300)); }
    }

    const categories = promptItems().filter(x => !x.leaf).map(x => x.label);
    for (const cat of categories) {
        const entry = promptItems().find(x => x.label === cat && !x.leaf);
        if (!entry) continue;
        const before = pills();
        entry.opt.click();
        await waitForCondition(() => !!promptBackButton() || pills() > before, 1000);
        if (pills() > before) {
            // Not a category after all: it got picked. Undo, keep looking.
            const pill = field.querySelectorAll('[data-automation-id="selectedItem"]')[before];
            const del = pill && pill.querySelector('[data-automation-id="DELETE_charm"]');
            if (del) del.click();
            await waitForCondition(() => pills() === before, 800);
            if (pills() > before) { console.warn(`Workday Autoplay: "${cat}" was picked by mistake and could not be removed`); return false; }
            input.click();
            await waitForCondition(() => promptItems().length > 0, 1000);
            continue;
        }
        const child = promptItems().find(x => promptMatches(x.label, want));
        if (child && await choose(child)) return true;
        const back = promptBackButton();
        if (back) { back.click(); await waitForCondition(() => !promptBackButton(), 1000); }
    }
    close();
    console.warn(`Workday Autoplay: no "${want}" option under "How did you hear about us" (looked in: ${categories.join(', ').slice(0, 120)})`);
    return false;
}

/**
 * APPLICATION QUESTIONS THE PROFILE ALREADY ANSWERS.
 *
 * Employers re-ask things the profile holds ("What is your anticipated
 * graduation date?", "What is your current major?", "Do you meet the minimum
 * GPA of 3.0?") as free-text or Yes/No questions with GUID field ids. Answered
 * only from saved values, only into empty boxes, and never guessed: no saved
 * GPA means the GPA question is left for the user.
 */
function latestEducation() {
    const list = (userProfile && userProfile.education || []).filter(e => e && (e.school || e.fieldOfStudy || e.endDate));
    const when = e => e.endDate ? (+e.endDate.year || 0) * 12 + (+e.endDate.month || 0) : 0;
    return list.slice().sort((a, b) => when(b) - when(a))[0] || null;
}

/** The end date in the format the question names: (MM/YY), (MM/YYYY), (YYYY), (Month YYYY). Default MM/YYYY. */
function graduationText(d, label) {
    if (!d || !d.year) return '';
    const yyyy = String(d.year), yy = yyyy.slice(-2);
    const mm = d.month ? String(d.month).padStart(2, '0') : '';
    const hint = ((label || '').match(/\(([^)]*)\)/) || [])[1] || '';
    if (/\bdd\b/i.test(hint)) return ''; // wants a day; the profile has none, and inventing one is not ok
    if (/^\s*yyyy\s*$/i.test(hint)) return yyyy;
    if (!mm) return '';
    if (/mm\s*[\/-]\s*yy(?!yy)/i.test(hint)) return `${mm}/${yy}`;
    if (/month/i.test(hint)) return `${['January','February','March','April','May','June','July','August','September','October','November','December'][+mm - 1] || mm} ${yyyy}`;
    return `${mm}/${yyyy}`;
}

const PROFILE_TEXT_QUESTIONS = [
    { re: /\b(what|which) languages? (do|can) you (speak|read|write)\b|^\s*languages? (spoken|you speak)\b/i,
      value: (e, label) => languagesText(label) },
    { re: /\bwhat is your (cumulative |overall |current |college |university )?(gpa|grade point average)\b|^\s*(cumulative|overall) gpa\b/i,
      value: e => e.gpa || '' },
    { re: /\b(anticipated|expected|projected|estimated)\b.*\bgraduat|\bgraduation date\b|\bwhen (do|will) you graduate\b/i,
      value: (e, label) => graduationText(e.endDate, label) },
    { re: /\b(current|your|intended|declared)\s+(major|field of study|area of study|course of study)\b|\bwhat is your major\b/i,
      value: e => e.fieldOfStudy || '' },
    { re: /\b(best|preferred) (way|method|means) (to|of) (contact|reach)(ing)? you\b|\bhow (should|can|may) we (best )?(contact|reach) you\b/i,
      value: () => contactText() },
    { re: /\b(what|which|current)\s+(school|university|college)\b.*\b(attend|enrolled|study)|\bcurrent (school|university|college)\b|^\s*(school|university|college)( or (school|university|college))? name\b|\bname of (your )?(school|university|college)\b/i,
      value: e => e.school || '' }
];

/** "What is the best way to contact you?": the saved email and phone, nothing invented. */
function contactText() {
    const p = (userProfile && userProfile.personalInfo) || {};
    return [p.email && `Email: ${p.email}`, p.phone && `Phone: ${p.phone}`].filter(Boolean).join(', ');
}

/** "What languages do you speak? Rate 1 beginner to 10 fluent." A rating only for a native speaker. */
function languagesText(label) {
    const lang = userProfile && userProfile.language;
    if (!lang || !lang.name) return '';
    const scale = (label || '').match(/\b1\b[^0-9]{1,40}\b(5|10)\b/);
    if (scale) return lang.isNative ? `${lang.name} - ${scale[1]}` : '';
    return lang.isNative ? `${lang.name} (native)` : lang.name;
}

async function answerProfileQuestions() {
    const edu = latestEducation() || {};

    const root = document.querySelector('[data-automation-id="applyFlowPage"]') || document.body;
    for (const el of root.querySelectorAll('input[type="text"], input:not([type]), textarea')) {
        if (el.offsetParent === null || el.value) continue;
        if (el.getAttribute('data-automation-id') === 'searchBox' || el.closest('[data-automation-id="dateWidget"], [role="listbox"]')) continue;
        const label = questionLabelFor(el);
        const rule = label && PROFILE_TEXT_QUESTIONS.find(r => r.re.test(label));
        if (!rule) continue;
        const container = el.closest('fieldset, div[data-automation-id^="formField"]') || el;
        if (answeredQuestions.has(container)) continue;
        const value = rule.value(edu, label);
        await step(label.slice(0, 140), () => {
            if (!value) return 'skipped';
            setNativeValue(el, value);
            if (el.value !== value) { console.warn('Workday Autoplay: wrote the answer but the box did not keep it'); return false; }
            answeredQuestions.add(container);
            return true;
        });
    }

    // "Do you have a High School Diploma or GED?" Yes only when the profile
    // holds college-level study (which presupposes one); otherwise left alone.
    const college = (userProfile.education || []).some(e => e && (
        /\b(university|college|institute|polytechnic)\b/i.test(e.school || '')
        || /\b(bachelor|associate|master|doctor|ph\.?d|b\.?s|b\.?a|m\.?s|mba)\b/i.test(e.degree || '')));
    if (college) {
        for (const block of findQuestionBlocks(['high school diploma', 'ged'])) {
            if (!/\bhigh school diploma\b|\bGED\b/.test(block.text)) continue;
            await answerQuestionBlock(block, 'Yes');
        }
    }

    // "This position requires a minimum GPA of 3.0/4.0 scale. Do you meet this requirement?"
    const gpa = parseFloat(edu.gpa);
    if (!(gpa > 0 && gpa <= 4.0)) return; // also covers "no education saved"
    for (const block of findQuestionBlocks(['gpa', 'grade point average'])) {
        const t = block.text.replace(/\s+/g, ' ');
        if (!/\b(minimum|at least|or higher|or above|or greater)\b/i.test(t)) continue;
        if (!/\b(do you|are you|have you|does your)\b/i.test(t)) continue;
        const m = t.match(/\b([1-4]\.\d{1,2})\b/);
        if (!m) continue;
        if (/\/\s*(5|10|100)\b/.test(t)) continue; // not a 4.0 scale
        await answerQuestionBlock(block, gpa >= parseFloat(m[1]) ? 'Yes' : 'No');
    }
}

/**
 * REQUIREMENT 2: answerYesNo Helper Function
 * Finds a question label on the page and clicks the corresponding "Yes" or "No" radio button
 * @param {string|string[]} questionText - The text to search for in question labels (can be array of keywords)
 * @param {string} userChoice - Either "Yes" or "No"
 */
/**
 * Question blocks matching `keywords`, from BOTH <label> and <legend>.
 *
 * Workday's "Application Questions" pages carry no <label> at all — the question
 * text lives in a <legend> inside a <fieldset>, and the text itself is nested
 * one level deeper again:
 *
 *   <div data-automation-id="formField-178a253424c71001ed2ae2d83ef60001">
 *     <fieldset>
 *       <legend><div id="rich-label178">…question…</div></legend>
 *       <button aria-haspopup="listbox" aria-label=" Yes Required">Yes</button>
 *
 * Nothing else on the block is usable: the formField id is a GUID and the
 * button's aria-label is only the current VALUE plus "Required". The legend is
 * the sole place the question exists, and `innerText` is used rather than a text
 * node so the rich-label nesting is read through.
 */
function findQuestionBlocks(keywords) {
    const blocks = [];
    const seen = new Set();

    for (const el of document.querySelectorAll('label, legend')) {
        const text = (el.innerText || '').trim();
        if (!text || !matchesAny(text, keywords)) continue;

        const container = el.closest('fieldset, div[data-automation-id^="formField"], div[role="group"], div[role="radiogroup"]');
        if (!container || seen.has(container)) continue;

        seen.add(container);
        blocks.push({ text, container });
    }
    return blocks;
}

/**
 * Answer a Yes/No question rendered as a dropdown rather than radio buttons.
 *
 * Match on the option text EXACTLY. "No" is a substring of far too much
 * ("None of the above", "Not applicable") for `includes` to be safe on a
 * two-choice question.
 */
async function answerDropdownYesNo(trigger, userChoice, questionText) {
    // Exact Yes/No only: "No" is a substring of "None of the above" and
    // "Not applicable", which are wrong answers, not near misses.
    const exact = (opts, want) => opts.find(o => o.innerText.trim().toLowerCase() === want.toLowerCase()) || null;
    return pickFromDropdown(trigger, userChoice, `"${questionText.slice(0, 60)}"`, exact);
}

/**
 * Answer one already-located question block with Yes or No.
 *
 * Guarded by `answeredQuestions`: once a rule has answered a block, no later
 * rule may overwrite it. Two keyword groups claiming the same question, with
 * the second one winning, is how "Are you legally authorized to work in the
 * United States?" ended up reading No — see handleJobPreferences.
 */
async function answerQuestionBlock(block, userChoice) {
    return step(block.text.replace(/\s+/g, ' ').replace(/\*/g, '').trim().slice(0, 140), () => answerQuestionBlockInner(block, userChoice));
}

async function answerQuestionBlockInner(block, userChoice) {
    const container = block.container;
    if (answeredQuestions.has(container)) {
        console.log(`Workday Autoplay: "${block.text.slice(0, 60)}" was already answered this scan, leaving it.`);
        return false;
    }

    const wanted = userChoice.toLowerCase();
    // Whole-word, not substring. `includes('no')` also matches "Not applicable",
    // "None of the above" and "No Preference" — on a question whose only honest
    // answers are Yes and No, that is a wrong answer, not a near miss.
    const choiceRe = new RegExp(`^${wanted}\\b`, 'i');

    for (const radio of container.querySelectorAll('input[type="radio"]')) {
        const radioLabel = radio.id ? document.querySelector(`label[for="${CSS.escape(radio.id)}"]`) : null;
        const radioText = normalizeLabel(
            (radioLabel && radioLabel.innerText) || radio.getAttribute('aria-label') || radio.getAttribute('value') || ''
        );
        if (!radioText) continue;
        if (radioText !== wanted && !choiceRe.test(radioText)) continue;

        answeredQuestions.add(container);
        if (radio.checked) return true;

        console.log(`Workday Autoplay: answering "${block.text.slice(0, 60)}" with "${userChoice}"`);
        radio.click();
        radio.dispatchEvent(new Event('change', { bubbles: true }));
        radio.dispatchEvent(new Event('input', { bubbles: true }));
        await new Promise(r => setTimeout(r, 300));
        return true;
    }

    // No radios matched. On the questionnaire pages the control is a
    // dropdown, not a radio group, which is the second half of why these
    // questions were never answered.
    const trigger = container.querySelector('button[aria-haspopup="listbox"]');
    if (trigger && await answerDropdownYesNo(trigger, userChoice, block.text)) {
        answeredQuestions.add(container);
        return true;
    }

    return false;
}

async function answerYesNo(questionText, userChoice) {
    const keywords = Array.isArray(questionText) ? questionText : [questionText];

    for (const block of findQuestionBlocks(keywords)) {
        if (await answerQuestionBlock(block, userChoice)) return true;
    }

    return false;
}

/**
 * AUTO ANSWER RADIO (Legacy - kept for compatibility, now uses answerYesNo internally)
 */
async function autoAnswerRadio(keywords, choice) {
    return await answerYesNo(keywords, choice);
}

