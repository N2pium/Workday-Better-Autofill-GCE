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

    if (!userProfile) {
        isScanning = false;
        return;
    }

    // 1. Personal & Address
    if (userProfile.personalInfo) {
        fillFieldByFuzzyLabel(['first name', 'given name'], userProfile.personalInfo.firstName);
        fillFieldByFuzzyLabel(['last name', 'family name', 'surname'], userProfile.personalInfo.lastName);
        fillFieldByFuzzyLabel(['phone', 'mobile'], userProfile.personalInfo.phone);
        // Phone Device Type dropdown — select Mobile
        await selectWorkdayDropdown('Phone Device Type', 'Mobile');
        await selectWorkdayDropdown('Device Type', 'Mobile');
        fillFieldByFuzzyLabel(['email'], userProfile.personalInfo.email);
        fillFieldByFuzzyLabel(['linkedin', 'website', 'url'], userProfile.personalInfo.linkedinUrl);

        // Websites (Dynamic Section) - Phase 3
        if (userProfile.personalInfo.linkedinUrl) {
            await handleWebsitesSection(userProfile.personalInfo.linkedinUrl);
        }
    }

    if (userProfile.address) {
        fillFieldByFuzzyLabel(['address line 1', 'street'], userProfile.address.street);
        fillFieldByFuzzyLabel(['city', 'town'], userProfile.address.city);
        fillFieldByFuzzyLabel(['zip', 'postal code'], userProfile.address.zip);

        // Standard Dropdown for Country
        await handleDropdown(['country', 'region'], userProfile.address.country);

        // Phase 5: "State" uses selectWorkdayDropdown logic
        if (userProfile.address.state) {
            // Try standard keys for state label
            const stateKeys = ['state', 'province', 'territory'];
            // We try to find the label on page to pass to selectWorkdayDropdown
            // Or just try "State" and "Province" sequentially
            let success = await selectWorkdayDropdown('State', userProfile.address.state);
            if (!success) await selectWorkdayDropdown('Province', userProfile.address.state);
        }
    }

    // 2. Work Experience (Complex Date Handling)
    if (userProfile.workExperience && userProfile.workExperience.length > 0) {
        const work = userProfile.workExperience[0];
        fillFieldByFuzzyLabel(['company', 'employer'], work.company);
        fillFieldByFuzzyLabel(['job title', 'title', 'role'], work.title || work['job title']);
        fillFieldByFuzzyLabel(['location'], work.location);
        fillFieldByFuzzyLabel(['role description', 'description', 'summary'], work.description || work['role description']);

        // Date Logic (Async now)
        if (work.startDate) {
            await fillDate('from', work.startDate);
            await fillDate('start date', work.startDate);
            const dateStr = formatDateString(work.startDate);
            fillFieldByFuzzyLabel(['from', 'start date'], dateStr);
        }
        if (work.endDate) {
            await fillDate('to', work.endDate);
            await fillDate('end date', work.endDate);
            const dateStr = formatDateString(work.endDate);
            fillFieldByFuzzyLabel(['to', 'end date'], dateStr);
        }

        if (work.isCurrentRole) {
            checkCheckbox(['i currently work here', 'current job', 'present']);
        }
    }

    // 3. Education
    if (userProfile.education && userProfile.education.length > 0) {
        const edu = userProfile.education[0];

        // Phase 5: School uses Searchable Picker
        if (edu.school) {
            await handleSearchablePicker(['school', 'institution', 'university'], edu.school);
        }

        // Phase 3: Field of Study uses Searchable Picker
        if (edu.fieldOfStudy) {
            await handleSearchablePicker(['field of study', 'major'], edu.fieldOfStudy);
        }

        // Degree Dropdown
        if (edu.degree) {
            await handleDropdown(['degree', 'qualification'], edu.degree, matchDegreeOption);
            // Also try selectWorkdayDropdown as fallback — more reliable for Workday's
            // custom selectSelectedOption / selectWidget elements
            await selectWorkdayDropdown('Degree', edu.degree, matchDegreeOption);
        }

        if (edu.startDate) await fillDate('first year attended', edu.startDate);
        if (edu.endDate) await fillDate('last year attended', edu.endDate);

        // Cumulative GPA
        fillGPA(edu.gpa || "2.8");
    }

    // 4. Skills (Async Injection)
    if (userProfile.skills && userProfile.skills.length > 0) {
        const skillsInput = findElementByFuzzyLabel(['skills', 'competencies']);
        if (skillsInput) {
            await injectSkills(skillsInput, userProfile.skills);
        }
    }

    // 5. Language (New Phase)
    if (userProfile.language && userProfile.language.name) {
        await handleLanguages(userProfile.language);
    }

    // 5. Resume Upload
    if (userProfile.resume && userProfile.resumeMeta) {
        uploadResume(userProfile.resume, userProfile.resumeMeta);
    }

    // 6. Application Questions & Disclosures (Async)
    await handleJobPreferences(); // NEW
    await fillDisclosures();

    // 7. Terms & Conditions
    handleTerms();

    console.log("Workday Autoplay: Scan completed.");
    isScanning = false;

    // Notify the side panel so it can show live status
    try {
        chrome.runtime.sendMessage({ action: 'fill_complete' }, () => {
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
        const xpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${key.toLowerCase()}")]/following::input[1] | //input[contains(@aria-label, "${key}")] | //textarea[contains(@aria-label, "${key}")]`;
        found = getElementByXpath(xpath);
    });
    return found;
}

/**
 * Dropdown Handling (Now Async)
 */
async function handleDropdown(keys, value, matcher = null) {
    if (!value) return;

    for (const key of keys) {
        try {
            const xpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${key.toLowerCase()}")]/following::*[self::button or @role="combobox"][1]`;
            const trigger = getElementByXpath(xpath);

            if (!trigger) continue;

            if (trigger.innerText.includes(value) || trigger.value === value) continue;

            console.log(`Workday Autoplay: Found dropdown trigger for ${key}`, trigger);
            scrollIntoViewIfNeeded(trigger);
            trigger.click();

            // Scoped to the open dropdown throughout — see findOpenListbox.
            const hasOptions = await waitForCondition(() => getOpenListboxOptions().length > 0, 3000);

            if (!hasOptions) {
                console.warn(`Workday Autoplay: No options appeared for ${key}`);
                continue;
            }

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
                await commitOptionSelection(option, key);
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
 */
async function fillDate(labelKey, dateObj) {
    if (!dateObj) return;
    const { month, year } = dateObj;

    const monthMap = { "01": "January", "02": "February", "03": "March", "04": "April", "05": "May", "06": "June", "07": "July", "08": "August", "09": "September", "10": "October", "11": "November", "12": "December" };
    const monthName = monthMap[month] || month;

    if (month) {
        await handleDateDropdown(labelKey, 'Month', monthName);
        handleDateInputTyping(labelKey, 'MM', month);
        handleDateInputTyping(labelKey, 'Month', month);
    }
    if (year) {
        await handleDateDropdown(labelKey, 'Year', year);
        handleDateInputTyping(labelKey, 'YYYY', year);
        handleDateInputTyping(labelKey, 'Year', year);
    }
}

async function handleDateDropdown(groupLabel, type, value) {
    try {
        const xpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${groupLabel.toLowerCase()}")]/parent::*//following::*[contains(@aria-label, "${type}") or contains(@title, "${type}")][1]`;
        let trigger = getElementByXpath(xpath);

        if (!trigger) {
            const xpathCase = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${groupLabel.toLowerCase()}")]/following::*[contains(@aria-label, "${type}")][1]`;
            trigger = getElementByXpath(xpathCase);
        }

        if (!trigger) return;

        if (trigger.tagName === 'INPUT' && (trigger.type === 'text' || trigger.type === 'number')) return;
        if (trigger.innerText.includes(value) || trigger.value === value) return;

        scrollIntoViewIfNeeded(trigger);
        trigger.click();

        // Scoped to the open dropdown — see findOpenListbox.
        const hasOptions = await waitForCondition(() => getOpenListboxOptions().length > 0, 2000);

        if (!hasOptions) return;

        const needle = String(value).toLowerCase();
        const opts = getOpenListboxOptions();
        const option = opts.find(o => o.innerText.trim() === String(value))
            || opts.find(o => o.innerText.toLowerCase().includes(needle));
        if (option) {
            await commitOptionSelection(option, `${groupLabel}/${type}`);
            await new Promise(r => setTimeout(r, 200));
        }
    } catch (e) {
        console.error(`Workday Autoplay: Error in handleDateDropdown for ${groupLabel}/${type}:`, e);
    }
}

function handleDateInputTyping(groupLabel, type, value) {
    const xpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${groupLabel.toLowerCase()}")]/following::input[(contains(@aria-label, "${type}") or contains(@placeholder, "${type}"))][1]`;
    let input = getElementByXpath(xpath);
    if (!input) {
        const xpath2 = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${groupLabel.toLowerCase()}")]/following::input[(contains(@aria-label, "${type}") or contains(@placeholder, "${type}"))][1]`;
        input = getElementByXpath(xpath2);
    }
    if (input) {
        if (input.value === value) return;
        input.click();
        setNativeValue(input, value);
    }
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

function fillFieldByFuzzyLabel(keys, value) {
    if (!value) return;

    const candidates = [];
    document.querySelectorAll('input:not([type="hidden"]), textarea').forEach(input => {
        if (input.value && input.value === value) return;
        const texts = collectLabelTexts(input);
        if (texts.length) candidates.push({ input, texts });
    });

    // `keys` is ordered most-specific-first. Take the first key that matches
    // anything and stop, so a loose trailing key cannot poach a field a more
    // specific key already identified — 'role' was writing the job title into
    // "Role Description" because it substring-matches.
    //
    // Within the winning key, an exact label match beats substring matches.
    // Without this, 'to' (the end-date label) also matched every field whose
    // text merely contains "to": "Total Compensation", "Story", and so on.
    //
    // When nothing matches exactly, all substring hits are still filled, which
    // preserves the intended behavior for pairs like Email / Confirm Email.
    for (const key of keys) {
        const needle = key.toLowerCase();
        const hits = candidates.filter(c => c.texts.some(t => t.toLowerCase().includes(needle)));
        if (!hits.length) continue;

        const exact = hits.filter(c => c.texts.some(t => normalizeLabel(t) === normalizeLabel(key)));
        (exact.length ? exact : hits).forEach(c => setNativeValue(c.input, value));
        return;
    }
}

function matchesAny(text, keys) {
    if (!text) return false;
    const t = text.toLowerCase();
    return keys.some(key => t.includes(key.toLowerCase()));
}

function checkCheckbox(keys) {
    const inputs = document.querySelectorAll('input[type="checkbox"]');
    inputs.forEach(input => {
        let match = false;
        const traverseMatch = (el) => {
            if (!el) return false;
            if (el.innerText && matchesAny(el.innerText, keys)) return true;
            if (el.getAttribute('aria-label') && matchesAny(el.getAttribute('aria-label'), keys)) return true;
            return false;
        };

        if (traverseMatch(input)) match = true;
        if (!match && input.id) {
            const label = document.querySelector(`label[for="${input.id}"]`);
            if (label && matchesAny(label.innerText, keys)) match = true;
        }
        if (!match) {
            const container = input.closest('div, label');
            if (container && traverseMatch(container)) match = true;
        }

        if (match && !input.checked) {
            input.click();
            input.dispatchEvent(new Event('change', { bubbles: true }));
        }
    });
}

/**
 * PHASE 3: ADVANCED HELPERS
 */

// 1. Cumulative GPA
function fillGPA(gpaValue) {
    const inputs = document.querySelectorAll('input');
    let target = null;
    inputs.forEach(input => {
        if (target) return;
        if (input.getAttribute('aria-label') && /cumulative gpa|gpa/i.test(input.getAttribute('aria-label'))) target = input;
        if (!target && input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label && /cumulative gpa|gpa/i.test(label.innerText)) target = input;
        }
        if (!target) {
            const container = input.closest('div[data-automation-id="formField"]');
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
async function handleWebsitesSection(url) {
    const urlInput = findElementByFuzzyLabel(['url', 'website address']);
    if (urlInput && urlInput.offsetParent !== null) {
        setNativeValue(urlInput, url);
        return;
    }

    let addBtn = document.querySelector('button[aria-label*="Add Website"], button[aria-label*="Add Link"]');
    if (!addBtn) {
        const sections = document.querySelectorAll('div, section');
        for (let section of sections) {
            const header = section.querySelector('h2, h3, h4');
            if (header && /websites|links/i.test(header.innerText)) {
                addBtn = section.querySelector('button[data-automation-id="Add"], button[title="Add"]');
                if (addBtn) break;
            }
        }
    }

    if (addBtn) {
        console.log("Workday Autoplay: Clicking Add Website button", addBtn);
        addBtn.click();

        // Wait for Input loop
        for (let i = 0; i < 20; i++) {
            await new Promise(r => setTimeout(r, 100));
            const newInput = findElementByFuzzyLabel(['url', 'website address']);
            if (newInput) {
                setNativeValue(newInput, url);
                return;
            }
        }
    }
}

// 3. Field of Study / School (Searchable Picker)
// Targets Workday's searchBox input with data-automation-id
async function handleSearchablePicker(keys, value) {
    if (!value) return;

    try {
        let input = null;

        for (const key of keys) {
            const labelXpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${key.toLowerCase()}")]`;
            const label = getElementByXpath(labelXpath);
            if (label) {
                const container = label.closest('div[data-automation-id="formField"]') || label.parentElement;
                if (container) {
                    input = container.querySelector('input[data-automation-id="searchBox"]');
                    if (input) break;
                }
            }
        }

        if (!input) {
            for (const key of keys) {
                input = document.querySelector(`input[data-automation-id="searchBox"][id*="${key.toLowerCase().replace(/\s+/g, '')}"]`);
                if (input) break;
            }
        }

        if (!input) {
            input = findElementByFuzzyLabel(keys);
        }

        if (!input) {
            console.log(`Workday Autoplay: Could not find searchBox for ${keys[0]}`);
            return;
        }

        if (input.value && input.value.toLowerCase().includes(value.toLowerCase())) {
            console.log(`Workday Autoplay: ${keys[0]} already filled with ${value}, skipping.`);
            return;
        }

        console.log(`Workday Autoplay: Handling Searchable Picker for ${keys[0]}`, input);

        scrollIntoViewIfNeeded(input);
        input.focus();
        setNativeValue(input, value);

        input.dispatchEvent(new Event('input', { bubbles: true }));
        input.dispatchEvent(new Event('change', { bubbles: true }));

        await waitForCondition(() => {
            const prompts = document.querySelectorAll('[data-automation-id="promptOption"]');
            return prompts.length > 0;
        }, 3000);

        let option = document.querySelector(`[data-automation-id="promptOption"][data-automation-label*="${value}"]`);

        if (!option) {
            const allPrompts = document.querySelectorAll('[data-automation-id="promptOption"]');
            for (const prompt of allPrompts) {
                const label = prompt.getAttribute('data-automation-label') || prompt.innerText || '';
                if (label.toLowerCase().includes(value.toLowerCase())) {
                    option = prompt;
                    break;
                }
            }
        }

        if (!option) {
            const promptOptionXpath = `//*[@data-automation-id="promptOption" and contains(translate(., 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${value.toLowerCase()}")]`;
            option = getElementByXpath(promptOptionXpath);
        }

        if (!option) {
            const optionXpath = `//div[@role="option"]//div[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${value.toLowerCase()}")]`;
            option = getElementByXpath(optionXpath);
        }

        if (option) {
            console.log(`Workday Autoplay: Found matching option for ${value}`, option);
            scrollIntoViewIfNeeded(option);
            option.click();
        } else {
            const firstOption = document.querySelector('[data-automation-id="promptOption"], div[role="option"]');
            if (firstOption) {
                console.log(`Workday Autoplay: No exact match, clicking first option`);
                scrollIntoViewIfNeeded(firstOption);
                firstOption.click();
            } else {
                console.log(`Workday Autoplay: No options found for ${value}`);
            }
        }

        await new Promise(r => setTimeout(r, 300));
    } catch (e) {
        console.error(`Workday Autoplay: Error in handleSearchablePicker for ${keys[0]}:`, e);
    }
}

// 4. Language Handling - Enhanced with Add Button Workflow
async function handleLanguages(languageData) {
    if (!languageData || !languageData.name) return;

    console.log("Workday Autoplay: Handling Language Section...");

    // Idempotency: Check if language dropdown or row already exists
    const existingLangDropdown = document.querySelector('button[aria-label*="Language"], select[name*="language"], div[data-automation-id="multiselectInputContainer"]');
    const existingLangText = document.body.innerText.includes(languageData.name);
    if (existingLangDropdown || existingLangText) {
        console.log("Workday Autoplay: Language row already exists, skipping Add.");
        return;
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
                        return;
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
                        return;
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
            }
        } else {
            console.warn("Workday Autoplay: Language dropdown button not found after waiting");
        }
    } else {
        console.warn("Workday Autoplay: Add Language button not found");
    }
}

// Helper function to set language proficiency after language is selected
async function setLanguageProficiency(languageData) {

    // 3. Native Speaker Checkbox
    if (languageData.isNative) {
        const nativeCheckbox = document.querySelector('input[type="checkbox"][name*="native"], input[type="checkbox"][aria-label*="Native"]');
        if (nativeCheckbox && !nativeCheckbox.checked) {
            console.log("Workday Autoplay: Checking Native Speaker");
            nativeCheckbox.click();
            nativeCheckbox.dispatchEvent(new Event('change', { bubbles: true }));
        }
    }

    // 4. Proficiency (if not native, usually required. If native, sometimes hidden but we'll try)
    // Prompt says: Target buttons with aria-label="Comprehension select one required."
    const proficiencyTypes = ['Comprehension', 'Reading', 'Speaking', 'Writing', 'Verbal'];

    for (const type of proficiencyTypes) {
        const btnXpath = `//button[contains(@aria-label, "${type}")]`;
        const btn = getElementByXpath(btnXpath);

        if (btn && btn.innerText.includes("Select")) { // Only if not selected
            console.log(`Workday Autoplay: Setting proficiency for ${type}`);
            btn.click();
            await new Promise(r => setTimeout(r, 500));

            // Select "5 - Fluent" or similar
            const fluentXpath = `//li[@role="option"]//div[contains(text(), "Fluent")] | //div[@role="option" and contains(text(), "Fluent")]`;
            const fluentOption = getElementByXpath(fluentXpath);
            if (fluentOption) {
                fluentOption.click();
                await new Promise(r => setTimeout(r, 500));
            }
        }
    }
}

/**
 * PHASE 4: DISCLOSURES & CUSTOM DROPDOWNS (Async)
 */

async function fillDisclosures() {
    console.log("Workday Autoplay: Filling Disclosures...");

    // Standard yes/no questions
    await selectWorkdayDropdown('18 years of age or older', 'Yes');
    await selectWorkdayDropdown('legally authorized to work in the US', 'Yes');
    await selectWorkdayDropdown('require immigration sponsorship', 'No');

    // Demographics from user profile (with fallbacks)
    const demographics = userProfile.demographics || {};

    const gender = demographics.gender || 'Decline to Self-Identify';
    const hispanicLatino = demographics.hispanicLatino || 'Decline to Self-Identify';
    const race = demographics.race || 'I do not wish to answer';

    console.log(`Workday Autoplay: Using demographics - Gender: ${gender}, Hispanic: ${hispanicLatino}, Race: ${race}`);

    await selectWorkdayDropdown('Gender', gender);
    await selectWorkdayDropdown('Hispanic or Latino', hispanicLatino);

    // Race/Ethnicity (try multiple variations)
    await selectWorkdayDropdown('Race', race);
    await selectWorkdayDropdown('Ethnicity', race);

    await selectWorkdayDropdown('Veteran Status', 'I am not a veteran');

    // Auto-fill Date field in disclosure section with TODAY's date
    await fillDisclosureDate();
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

function handleTerms() {
    const checkboxXpath = `//input[@type="checkbox"]/following::label[contains(text(), "I agree") or contains(text(), "terms") or contains(text(), "read")]/preceding-sibling::input[@type="checkbox"] | //label[contains(text(), "I agree") or contains(text(), "terms") or contains(text(), "read")]//input[@type="checkbox"]`;
    let checkbox = getElementByXpath(checkboxXpath);
    if (!checkbox) {
        checkbox = document.querySelector('input[type="checkbox"][aria-label*="agree"], input[type="checkbox"][aria-label*="terms"]');
    }

    if (checkbox && !checkbox.checked) {
        console.log("Workday Autoplay: Checking Terms & Conditions");
        checkbox.click();
        checkbox.dispatchEvent(new Event('change', { bubbles: true }));
    }
}

async function selectWorkdayDropdown(label, desiredValue, matcher = null) {
    try {
        const xpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${label.toLowerCase()}")]/following::div[@data-automation-id="selectSelectedOption" or @data-automation-id="selectWidget"][1] | //label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${label.toLowerCase()}")]/parent::*/following-sibling::div//div[@data-automation-id="selectSelectedOption" or @data-automation-id="selectWidget"]`;

        let trigger = getElementByXpath(xpath);
        if (!trigger) {
            const btnXpath = `//button[@aria-label and contains(translate(@aria-label, 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${label.toLowerCase()}")]`;
            trigger = getElementByXpath(btnXpath);
        }

        if (!trigger) return false;

        if (trigger.innerText.includes(desiredValue)) {
            console.log(`Workday Autoplay: ${label} already set to ${desiredValue}`);
            return true;
        }

        console.log(`Workday Autoplay: Opening dropdown for ${label}`);
        scrollIntoViewIfNeeded(trigger);
        trigger.click();

        // Wait for the OPEN dropdown to carry options, not merely for some
        // listbox to exist. The selected-pill listboxes always exist, so the
        // previous waitForElement returned instantly with the wrong element.
        await waitForCondition(() => getOpenListboxOptions().length > 0, 3000);
        const options = getOpenListboxOptions();

        if (!options.length) {
            console.warn(`Workday Autoplay: No dropdown options appeared for ${label}`);
            return false;
        }
        console.log(`Workday Autoplay: Found ${options.length} options for ${label}`);

        for (const opt of options) {
            const optionText = opt.innerText.trim();
            if (optionText === desiredValue) {
                console.log(`Workday Autoplay: Found exact match: "${optionText}" for ${label}`);
                await commitOptionSelection(opt, label);
                await new Promise(r => setTimeout(r, 300));
                return true;
            }
        }

        for (const opt of options) {
            const optionText = opt.innerText.trim();
            if (optionText.toLowerCase() === desiredValue.toLowerCase()) {
                console.log(`Workday Autoplay: Found case-insensitive exact match: "${optionText}" for ${label}`);
                await commitOptionSelection(opt, label);
                await new Promise(r => setTimeout(r, 300));
                return true;
            }
        }

        // Partial match, still scoped to the open dropdown. The previous global
        // XPath could match an option belonging to a different widget entirely.
        console.warn(`Workday Autoplay: No exact match found, trying partial match for ${label}`);
        const needle = desiredValue.toLowerCase();
        // Ahead of the substring fallback on purpose: where a matcher is
        // supplied, substring is the path that mis-picks.
        const option = (matcher && matcher(options, desiredValue))
            || options.find(opt => opt.innerText.toLowerCase().includes(needle));

        if (option) {
            console.log(`Workday Autoplay: Selecting ${desiredValue} for ${label} (partial match)`);
            await commitOptionSelection(option, label);
            await new Promise(r => setTimeout(r, 300));
            return true;
        } else {
            console.warn(`Workday Autoplay: Option '${desiredValue}' not found for ${label}`);
            return false;
        }
    } catch (e) {
        console.error(`Workday Autoplay: Error in selectWorkdayDropdown for ${label}:`, e);
        return false;
    }
}

/**
 * Helper function to select dropdown options using aria-label matching
 * This is more reliable for standardized Workday disclosure fields
 */
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

/**
 * Auto-answer radio buttons with exact text matching (for disability disclosures)
 */
async function autoAnswerRadioExact(keywords, exactChoice) {
    const labels = Array.from(document.querySelectorAll('label'));
    const matches = labels.filter(label => matchesAny(label.innerText, keywords));

    for (const label of matches) {
        const container = label.closest('div[data-automation-id="formField"], fieldset, div[role="group"]');

        if (container) {
            const radios = container.querySelectorAll('input[type="radio"]');
            for (const radio of radios) {
                const id = radio.id;
                const radioLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);

                let radioText = "";
                if (radioLabel) radioText = radioLabel.innerText;
                else if (radio.getAttribute('aria-label')) radioText = radio.getAttribute('aria-label');

                // Check for exact match (case-insensitive, but check for full phrase)
                if (radioText.toLowerCase().includes(exactChoice.toLowerCase())) {
                    if (!radio.checked) {
                        console.log(`Workday Autoplay: Auto-answering "${label.innerText}" -> ${exactChoice}`);
                        radio.click();
                        radio.dispatchEvent(new Event('change', { bubbles: true }));
                        await new Promise(r => setTimeout(r, 200));
                        return true;
                    }
                }
            }
        }
    }
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
        return document.evaluate(path, document, null, XPathResult.FIRST_ORDERED_NODE_TYPE, null).singleNodeValue;
    } catch (e) {
        console.error("XPath error", e);
        return null;
    }
}

async function waitForElement(selector, timeout = 5000, interval = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        const el = document.querySelector(selector);
        if (el && el.offsetParent !== null) return el;
        await new Promise(r => setTimeout(r, interval));
    }
    return null;
}

async function waitForCondition(checkFn, timeout = 5000, interval = 100) {
    const startTime = Date.now();
    while (Date.now() - startTime < timeout) {
        if (checkFn()) return true;
        await new Promise(r => setTimeout(r, interval));
    }
    return false;
}

async function retryAsync(fn, maxRetries = 3, delayMs = 500) {
    for (let i = 0; i < maxRetries; i++) {
        try {
            return await fn();
        } catch (e) {
            if (i === maxRetries - 1) throw e;
            console.warn(`Retry ${i + 1}/${maxRetries} after error:`, e.message);
            await new Promise(r => setTimeout(r, delayMs * (i + 1)));
        }
    }
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
async function commitOptionSelection(option, label = '') {
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
    const committed = () => option.getAttribute('aria-selected') === 'true' || !option.isConnected;

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
    await answerYesNo(formerKeywords, prefs.formerEmployee ? 'Yes' : 'No');

    // 2. Authorized to Work
    // Keywords: "legally authorized", "authorized to work", "legal right to work", "18 years"
    const authKeywords = [
        'legally authorized',
        'authorized to work',
        'legal right to work',
        'lawfully work',
        '18 years of age'
    ];
    await answerYesNo(authKeywords, prefs.authorizedToWork ? 'Yes' : 'No');

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
    await answerYesNo(sponsorKeywords, prefs.requiresSponsorship ? 'Yes' : 'No');

    // 4. Referral Source (REQUIREMENT 2: Source Dropdown)
    // "How did you hear about us?" dropdown
    if (prefs.sourceReferral) {
        console.log(`Workday Autoplay: Setting referral source to ${prefs.sourceReferral}`);

        // Try multiple common variations of this question
        const sourceKeywords = [
            'how did you hear about us',
            'source',
            'referral source',
            'where did you hear',
            'how did you find'
        ];

        for (const keyword of sourceKeywords) {
            const success = await selectWorkdayDropdown(keyword, prefs.sourceReferral);
            if (success) break;
        }

        // Also try aria-label approach
        await selectByAriaLabel('source', prefs.sourceReferral);
    }

    // 5. US Citizenship — always answer Yes
    const citizenshipKeywords = [
        'citizen of the united states',
        'u.s. citizen',
        'us citizen',
        'united states citizen',
        'are you a citizen'
    ];
    // Try radio-button style first
    let citizenAnswered = await answerYesNo(citizenshipKeywords, 'Yes');
    // Try Workday dropdown style as fallback
    if (!citizenAnswered) {
        citizenAnswered = await selectWorkdayDropdown('citizen of the United States', 'Yes');
    }
    if (!citizenAnswered) {
        citizenAnswered = await selectWorkdayDropdown('U.S. Citizen', 'Yes');
    }
    if (!citizenAnswered) {
        await selectWorkdayDropdown('citizenship', 'Yes');
    }
}

/**
 * REQUIREMENT 2: answerYesNo Helper Function
 * Finds a question label on the page and clicks the corresponding "Yes" or "No" radio button
 * @param {string|string[]} questionText - The text to search for in question labels (can be array of keywords)
 * @param {string} userChoice - Either "Yes" or "No"
 */
async function answerYesNo(questionText, userChoice) {
    const keywords = Array.isArray(questionText) ? questionText : [questionText];

    // Find all labels that match any of the keywords
    const labels = Array.from(document.querySelectorAll('label'));
    const matchingLabels = labels.filter(label => matchesAny(label.innerText, keywords));

    for (const label of matchingLabels) {
        // Find the associated form field container
        const container = label.closest('div[data-automation-id="formField"], fieldset, div[role="group"], div[role="radiogroup"]');

        if (container) {
            // Find all radio buttons in this container
            const radios = container.querySelectorAll('input[type="radio"]');

            for (const radio of radios) {
                // Get the label text for this specific radio button
                const radioId = radio.id;
                const radioLabel = document.querySelector(`label[for="${CSS.escape(radioId)}"]`);

                let radioText = "";
                if (radioLabel) {
                    radioText = radioLabel.innerText;
                } else if (radio.getAttribute('aria-label')) {
                    radioText = radio.getAttribute('aria-label');
                } else if (radio.getAttribute('value')) {
                    radioText = radio.getAttribute('value');
                }

                // Check if this radio matches the user's choice (Yes or No)
                const normalizedChoice = userChoice.toLowerCase();
                const normalizedRadioText = radioText.toLowerCase();

                let isMatch = false;
                if (normalizedChoice === 'yes' && normalizedRadioText.includes('yes')) {
                    isMatch = true;
                } else if (normalizedChoice === 'no' && normalizedRadioText.includes('no')) {
                    isMatch = true;
                }

                if (isMatch && !radio.checked) {
                    console.log(`Workday Autoplay: answerYesNo - Answering "${label.innerText.substring(0, 50)}..." with "${userChoice}"`);
                    radio.click();
                    radio.dispatchEvent(new Event('change', { bubbles: true }));
                    radio.dispatchEvent(new Event('input', { bubbles: true }));
                    await new Promise(r => setTimeout(r, 300));
                    return true;
                }
            }
        }
    }

    return false;
}

/**
 * AUTO ANSWER RADIO (Legacy - kept for compatibility, now uses answerYesNo internally)
 */
async function autoAnswerRadio(keywords, choice) {
    return await answerYesNo(keywords, choice);
}

/**
 * ONE-CLICK DISCLOSURES OVERRIDE
 */
// Extending existing fillDisclosures
const originalFillDisclosures = fillDisclosures; // Keep reference if needed, but we essentially replace/augment it.

// Re-write fillDisclosures to handle the "Quick-Decline" logic
fillDisclosures = async function () {
    console.log("Workday Autoplay: Filling Disclosures (Enhanced)...");

    // Standard fills from before (Gender, Hispanic) - handled if found
    await selectWorkdayDropdown('18 years of age or older', 'Yes'); // Always Yes?

    // Check for Quick Decline Preference (declineDisclosures)
    const declineDisclosures = userProfile.jobPreferences && userProfile.jobPreferences.autoDisclosures;

    // 1. Race / Ethnicity - Using aria-label matching for standardized Workday fields
    if (declineDisclosures) {
        console.log("Workday Autoplay: Auto-declining Race/Ethnicity disclosures");

        // Try multiple variations of "decline to identify" that Workday uses
        let success = await selectByAriaLabel('race', 'Decline to identify');
        if (!success) success = await selectByAriaLabel('race', 'I do not wish to answer');
        if (!success) success = await selectWorkdayDropdown('Race', 'Decline to identify');
        if (!success) await selectWorkdayDropdown('Race', 'I do not wish to answer');

        success = await selectByAriaLabel('ethnicity', 'Decline to identify');
        if (!success) success = await selectByAriaLabel('ethnicity', 'I do not wish to answer');
        if (!success) success = await selectWorkdayDropdown('Ethnicity', 'Decline to identify');
        if (!success) await selectWorkdayDropdown('Ethnicity', 'I do not wish to answer');
    }

    // 2. Veteran Status - Using aria-label matching
    if (declineDisclosures) {
        console.log("Workday Autoplay: Auto-declining Veteran Status");

        // Try "I DECLINE TO SELF-IDENTIFY" or "I AM NOT A VETERAN" based on preference
        let success = await selectByAriaLabel('veteran', 'I DECLINE TO SELF-IDENTIFY');
        if (!success) success = await selectByAriaLabel('veteran status', 'I DECLINE TO SELF-IDENTIFY');
        if (!success) success = await selectWorkdayDropdown('Veteran Status', 'I DECLINE TO SELF-IDENTIFY');
        if (!success) success = await selectWorkdayDropdown('Veteran Status', 'I do not wish to answer');
        if (!success) await selectWorkdayDropdown('Veteran Status', 'I am not a veteran');
    }

    // 3. Disability Status - Using aria-label matching and radio buttons
    if (declineDisclosures) {
        console.log("Workday Autoplay: Auto-declining Disability disclosures");

        // Try dropdown first with aria-label
        let success = await selectByAriaLabel('disability', 'I DO NOT WISH TO ANSWER');
        if (!success) success = await selectByAriaLabel('disability', 'No, I Don\'t Have A Disability');
        if (!success) success = await selectWorkdayDropdown('Disability', 'I DO NOT WISH TO ANSWER');
        if (!success) await selectWorkdayDropdown('Disability', 'I do not wish to answer');

        // Also try radio buttons with specific text matching
        const disabilityKeywords = ['disability', 'disabled', 'handicapped'];
        await autoAnswerRadioExact(disabilityKeywords, 'I DO NOT WISH TO ANSWER');
        await autoAnswerRadioExact(disabilityKeywords, 'I do not wish to answer');
        await autoAnswerRadioExact(disabilityKeywords, 'No, I don\'t have a disability');
    }

    // Terms is handled separately
}
