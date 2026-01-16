// Workday Autoplay - Content Script

let userProfile = {};

// Listen for messages from the popup
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
    if (request.action === "fill_form") {
        console.log("Workday Autoplay: Received fill_form request.");
        // Reload data to ensure freshness
        chrome.storage.local.get(['personalInfo', 'address', 'education', 'workExperience', 'skills', 'resume', 'resumeMeta'], (result) => {
            userProfile = result;
            console.log('Workday Autoplay: Profile loaded for filling', userProfile);
            scanAndFill();
            sendResponse({ status: "started" });
        });
        return true; // Keep channel open for async response
    }
});

async function scanAndFill() {
    console.log('Workday Autoplay: Scanning page (Async Mode)...');

    if (!userProfile) return;

    // 1. Personal & Address
    if (userProfile.personalInfo) {
        fillFieldByFuzzyLabel(['first name', 'given name'], userProfile.personalInfo.firstName);
        fillFieldByFuzzyLabel(['last name', 'family name', 'surname'], userProfile.personalInfo.lastName);
        fillFieldByFuzzyLabel(['phone', 'mobile'], userProfile.personalInfo.phone);
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
            await handleDropdown(['degree', 'qualification'], edu.degree);
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

    // 5. Resume Upload
    if (userProfile.resume && userProfile.resumeMeta) {
        uploadResume(userProfile.resume, userProfile.resumeMeta);
    }

    // 6. Application Questions & Disclosures (Async)
    await fillDisclosures();

    // 7. Terms & Conditions
    handleTerms();

    console.log("Workday Autoplay: Scan completed.");
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
async function handleDropdown(keys, value) {
    if (!value) return;

    for (const key of keys) {
        const xpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${key.toLowerCase()}")]/following::*[self::button or @role="combobox"][1]`;
        const trigger = getElementByXpath(xpath);

        if (trigger) {
            if (trigger.innerText.includes(value) || trigger.value === value) continue;

            console.log(`Workday Autoplay: Found dropdown trigger for ${key}`, trigger);
            trigger.click();

            // Wait for options
            await new Promise(r => setTimeout(r, 500));

            const optionXpath = `//div[@role="option" or @role="listitem"]//div[text()="${value}"] | //div[@role="option" and contains(text(), "${value}")]`;
            const option = getElementByXpath(optionXpath);

            if (option) {
                console.log(`Workday Autoplay: Found option ${value}`, option);
                option.click();
                // Cooldown after selection as per Phase 5 Req 2
                await new Promise(r => setTimeout(r, 500));
                return; // Done
            }

            // Try search input fallback logic here if needed...
            const searchInput = document.querySelector('input[type="search"], input[aria-label="Search"]');
            if (searchInput) {
                setNativeValue(searchInput, value);
                await new Promise(r => setTimeout(r, 1000));
                const filteredOption = getElementByXpath(optionXpath);
                if (filteredOption) {
                    filteredOption.click();
                    await new Promise(r => setTimeout(r, 500));
                    return;
                }
            }
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
    const xpath = `//label[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${groupLabel.toLowerCase()}")]/parent::*//following::*[contains(@aria-label, "${type}") or contains(@title, "${type}")][1]`;
    let trigger = getElementByXpath(xpath);

    if (!trigger) {
        // Fallback logic
        const xpathCase = `//*[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${groupLabel.toLowerCase()}")]/following::*[contains(@aria-label, "${type}")][1]`;
        trigger = getElementByXpath(xpathCase);
    }

    if (trigger) {
        if (trigger.tagName === 'INPUT' && (trigger.type === 'text' || trigger.type === 'number')) return;
        if (trigger.innerText.includes(value) || trigger.value === value) return;

        trigger.click();
        await new Promise(r => setTimeout(r, 500));

        const optionXpath = `//div[@role="option" and contains(text(), "${value}")]`;
        const option = getElementByXpath(optionXpath);
        if (option) {
            option.click();
            await new Promise(r => setTimeout(r, 300));
        }
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
function fillFieldByFuzzyLabel(keys, value) {
    if (!value) return;
    const inputs = document.querySelectorAll('input:not([type="hidden"]), textarea');
    inputs.forEach(input => {
        if (input.value && input.value === value) return;
        let match = false;

        const ariaLabel = input.getAttribute('aria-label');
        if (ariaLabel && matchesAny(ariaLabel, keys)) match = true;

        if (!match && input.id) {
            const label = document.querySelector(`label[for="${CSS.escape(input.id)}"]`);
            if (label && matchesAny(label.innerText, keys)) match = true;
        }

        if (!match) {
            const container = input.closest('div[data-automation-id="formField"], div[data-automation-id="dateWidget"]');
            if (container) {
                const labelEl = container.querySelector('label');
                if (labelEl && matchesAny(labelEl.innerText, keys)) match = true;
            }
        }

        if (match) setNativeValue(input, value);
    });
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
async function handleSearchablePicker(keys, value) {
    const input = findElementByFuzzyLabel(keys);
    if (!input) return;

    console.log(`Workday Autoplay: Handling Searchable Picker for ${keys[0]}`, input);
    setNativeValue(input, value);

    input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keypress', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));
    input.dispatchEvent(new KeyboardEvent('keyup', { key: 'Enter', code: 'Enter', keyCode: 13, bubbles: true }));

    await new Promise(r => setTimeout(r, 1000));

    const optionXpath = `//div[@role="option"]//div[contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${value.toLowerCase()}")] | //div[@role="option" and contains(translate(text(), 'ABCDEFGHIJKLMNOPQRSTUVWXYZ', 'abcdefghijklmnopqrstuvwxyz'), "${value.toLowerCase()}")]`;
    const option = getElementByXpath(optionXpath);

    if (option) {
        option.click();
    } else {
        const firstOption = document.querySelector('div[role="option"]');
        if (firstOption) firstOption.click();
    }
    // New: Cooldown to ensure selection registers
    await new Promise(r => setTimeout(r, 500));
}

/**
 * PHASE 4: DISCLOSURES & CUSTOM DROPDOWNS (Async)
 */

async function fillDisclosures() {
    console.log("Workday Autoplay: Filling Disclosures...");

    await selectWorkdayDropdown('18 years of age or older', 'Yes');
    await selectWorkdayDropdown('legally authorized to work in the US', 'Yes');
    await selectWorkdayDropdown('require immigration sponsorship', 'No');

    await selectWorkdayDropdown('Gender', 'Male');
    await selectWorkdayDropdown('Hispanic or Latino', 'Yes');

    // We try both sequential logic for Race/Ethnicity
    await selectWorkdayDropdown('Race', 'I do not wish to answer (United States of America)');
    await selectWorkdayDropdown('Ethnicity', 'I do not wish to answer (United States of America)');

    await selectWorkdayDropdown('Veteran Status', 'I am not a veteran');
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

async function selectWorkdayDropdown(label, desiredValue) {
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
    trigger.click();

    await new Promise(r => setTimeout(r, 500)); // Wait for listbox

    const optionXpath = `//div[@role="option"]//div[contains(text(), "${desiredValue}")] | //div[@role="option" and contains(text(), "${desiredValue}")]`;
    const option = getElementByXpath(optionXpath);

    if (option) {
        console.log(`Workday Autoplay: Selecting ${desiredValue} for ${label}`);
        option.click();
        await new Promise(r => setTimeout(r, 500)); // Cooldown
        return true;
    } else {
        console.warn(`Workday Autoplay: Option '${desiredValue}' not found for ${label}`);
        // Click trigger again to close if needed? Or just leave it.
        return false;
    }
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
