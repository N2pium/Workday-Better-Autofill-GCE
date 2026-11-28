// Better Autofill - shared form filler
/**
 * A site-independent filler for ordinary HTML application forms: native
 * <input>, <select>, <textarea>, radio groups and file inputs, found by the
 * label a person reads rather than by one site's element ids. Site scripts
 * (job-site.js for iCIMS and Paylocity) decide WHEN and WHERE to fill; this decides WHAT goes in
 * each field, fills it the way the page's own scripts expect (native value
 * setter, then input/change/blur), and returns a fill report in the same
 * shape content.js sends, so the side panel shows it unchanged.
 *
 * Rules it never breaks:
 *  - Never overwrites a field that already has a value (the site or the
 *    person put it there).
 *  - Never guesses: a question with no saved answer, or no option that
 *    matches it, is left for the person and reported.
 *  - Never touches passwords, sign-in fields, captchas, or the submit button.
 *  - Self-identification is answered only from saved answers, or "decline"
 *    when the person turned on Decline all disclosures.
 *
 * Besides native controls it drives two common ARIA widgets, found on
 * React sites such as Paylocity: a combobox that owns a listbox of
 * [role=option] (react-widgets), and a searchable select whose menu rows are
 * [role=option] or "<input id>-select-row-N". Both open on mousedown and take a
 * click on an option, which is verified by what the widget then shows.
 *
 * Exposes self.EasyApplyFormFiller. fill() is async (widgets open and close).
 * No DOM access at load; safe to load in any frame, and in Node for tests.
 */
(function (root) {
    'use strict';

    const BUILD = 'forms-2026-11-28a';

    // ------------------------------------------------------------ text helpers

    const norm = (s) => String(s || '').toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
    const clean = (s) => String(s || '').replace(/\s+/g, ' ').trim();

    const US_STATES = {
        AL: 'Alabama', AK: 'Alaska', AZ: 'Arizona', AR: 'Arkansas', CA: 'California', CO: 'Colorado', CT: 'Connecticut',
        DE: 'Delaware', DC: 'District of Columbia', FL: 'Florida', GA: 'Georgia', HI: 'Hawaii', ID: 'Idaho', IL: 'Illinois',
        IN: 'Indiana', IA: 'Iowa', KS: 'Kansas', KY: 'Kentucky', LA: 'Louisiana', ME: 'Maine', MD: 'Maryland',
        MA: 'Massachusetts', MI: 'Michigan', MN: 'Minnesota', MS: 'Mississippi', MO: 'Missouri', MT: 'Montana',
        NE: 'Nebraska', NV: 'Nevada', NH: 'New Hampshire', NJ: 'New Jersey', NM: 'New Mexico', NY: 'New York',
        NC: 'North Carolina', ND: 'North Dakota', OH: 'Ohio', OK: 'Oklahoma', OR: 'Oregon', PA: 'Pennsylvania',
        PR: 'Puerto Rico', RI: 'Rhode Island', SC: 'South Carolina', SD: 'South Dakota', TN: 'Tennessee', TX: 'Texas',
        UT: 'Utah', VT: 'Vermont', VA: 'Virginia', WA: 'Washington', WV: 'West Virginia', WI: 'Wisconsin', WY: 'Wyoming'
    };
    const US_NAMES = ['united states', 'united states of america', 'usa', 'us', 'u s a', 'u s'];

    // ------------------------------------------------------------ DOM helpers

    function isVisible(el) {
        if (!el || el.type === 'hidden') return false;
        const win = el.ownerDocument.defaultView;
        for (let n = el; n && n.nodeType === 1; n = n.parentElement) {
            if (n.hidden) return false;
            const cs = win.getComputedStyle(n);
            if (cs.display === 'none' || cs.visibility === 'hidden') return false;
        }
        return true;
    }

    const usable = (el) => isVisible(el) && !el.disabled && !el.readOnly;

    function textOf(el) {
        if (!el) return '';
        // Ignore the controls inside a label (a select's options, a nested input).
        const copy = el.cloneNode(true);
        copy.querySelectorAll('select, option, input, textarea, script, style, button').forEach((n) => n.remove());
        return clean(copy.textContent);
    }

    /** What a person reads as this control's label. */
    function labelFor(el) {
        const doc = el.ownerDocument;
        const parts = [];
        const by = el.getAttribute('aria-labelledby');
        if (by) by.split(/\s+/).forEach((id) => { const n = doc.getElementById(id); if (n) parts.push(textOf(n)); });
        if (el.id) {
            const esc = (root.CSS && root.CSS.escape) ? root.CSS.escape(el.id) : el.id.replace(/["\\]/g, '\\$&');
            doc.querySelectorAll(`label[for="${esc}"]`).forEach((l) => parts.push(textOf(l)));
        }
        const wrap = el.closest('label');
        if (wrap) parts.push(textOf(wrap));
        if (el.getAttribute('aria-label')) parts.push(el.getAttribute('aria-label'));
        if (!parts.join('').trim() && el.getAttribute('data-for')) parts.push(el.getAttribute('data-for'));
        if (!parts.join('').trim()) {
            if (el.placeholder) parts.push(el.placeholder);
            if (el.title) parts.push(el.title);
        }
        return clean(parts.join(' ').replace(/\((required|optional)\)/gi, ' '));
    }

    /** The question a radio group or select asks: its legend, or the text of the
        nearest ancestor that holds more than the control's own label. */
    function questionFor(el) {
        const fs = el.closest('fieldset');
        if (fs) {
            const legend = fs.querySelector('legend');
            if (legend && textOf(legend)) return textOf(legend);
        }
        const grouped = el.closest('[role="radiogroup"], [role="group"]');
        if (grouped) {
            const by = grouped.getAttribute('aria-labelledby');
            const n = by && el.ownerDocument.getElementById(by.split(/\s+/)[0]);
            if (n) return textOf(n);
            if (grouped.getAttribute('aria-label')) return grouped.getAttribute('aria-label');
        }
        if (el.type !== 'radio' && el.type !== 'checkbox') {
            const own = labelFor(el);
            if (own) return own;
        }
        // Walk up until an ancestor has text beyond the options themselves.
        const optionTexts = el.type === 'radio'
            ? Array.from(el.ownerDocument.querySelectorAll('input[type="radio"]')).filter((r) => r.name === el.name).map(labelFor).filter(Boolean)
            : [];
        for (let n = el.parentElement, i = 0; n && i < 5; n = n.parentElement, i++) {
            const t = textOf(n);
            const extra = clean(optionTexts.reduce((rest, o) => rest.split(o).join(' '), t));
            if (extra.length > 3) return t.length > 400 ? t.slice(0, 400) : t;
        }
        return '';
    }

    /** One lower-case string to match rules against: label, name, id, autocomplete. */
    function keysOf(el) {
        const name = String(el.name || '').replace(/([a-z])([A-Z])/g, '$1 $2');
        const id = String(el.id || '').replace(/([a-z])([A-Z])/g, '$1 $2');
        return norm(`${labelFor(el)} | ${name} | ${id}`) + ` ac:${(el.getAttribute('autocomplete') || '').toLowerCase()}`;
    }

    const isRequired = (el) => el.required || el.getAttribute('aria-required') === 'true' || /\*\s*$/.test(labelFor(el))
        || !!el.closest('.form-required') || /\(required\)/i.test(textOf(el.closest('.form-group')));

    // ------------------------------------------------------------ setting values

    function setNative(el, value) {
        const win = el.ownerDocument.defaultView;
        const proto = el.tagName === 'TEXTAREA' ? win.HTMLTextAreaElement.prototype
            : el.tagName === 'SELECT' ? win.HTMLSelectElement.prototype : win.HTMLInputElement.prototype;
        const setter = Object.getOwnPropertyDescriptor(proto, 'value').set;
        el.focus && el.focus();
        setter.call(el, value);
        el.dispatchEvent(new win.Event('input', { bubbles: true }));
        el.dispatchEvent(new win.Event('change', { bubbles: true }));
        el.dispatchEvent(new win.Event('blur', { bubbles: true }));
    }

    const isPlaceholderOption = (o) => !o.value || /^(select|choose|please select|--|- ?select)/i.test(clean(o.textContent));

    /** Picks the first option matching any candidate, in candidate order.
        A candidate is a string (exact, then prefix, then whole-word match) or a RegExp. */
    function chooseOption(options, candidates) {
        const opts = options.filter((o) => !isPlaceholderOption(o));
        for (const c of candidates) {
            if (typeof c === 'function') {
                const hit = opts.find((o) => c(clean(o.textContent)));
                if (hit) return hit;
                continue;
            }
            if (c instanceof RegExp) {
                const hit = opts.find((o) => c.test(clean(o.textContent)) || c.test(o.value));
                if (hit) return hit;
                continue;
            }
            const want = norm(c);
            if (!want) continue;
            const hit = opts.find((o) => norm(o.textContent) === want || norm(o.value) === want)
                || opts.find((o) => norm(o.textContent).startsWith(want + ' '))
                || (want.length > 3 && opts.find((o) => (' ' + norm(o.textContent) + ' ').includes(' ' + want + ' ')));
            if (hit) return hit;
        }
        return null;
    }

    function selectOption(select, candidates) {
        const opt = chooseOption(Array.from(select.options), candidates);
        if (!opt) return false;
        setNative(select, opt.value);
        return select.value === opt.value;
    }

    function radioGroup(doc, radio) {
        return Array.from(doc.querySelectorAll('input[type="radio"]')).filter((r) => r.name === radio.name && (r.form === radio.form));
    }

    function chooseRadio(group, candidates) {
        const asOptions = group.map((r) => ({ r, textContent: labelFor(r) || r.value, value: r.value }));
        const hit = chooseOption(asOptions, candidates);
        if (!hit) return false;
        const win = hit.r.ownerDocument.defaultView;
        hit.r.click();
        if (!hit.r.checked) { hit.r.checked = true; hit.r.dispatchEvent(new win.Event('change', { bubbles: true })); }
        return hit.r.checked;
    }

    // ------------------------------------------------------------ ARIA widgets

    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    const UNANSWERED = /^(|-+|select\b.*|choose\b.*|please (select|choose)\b.*)$/i;
    const isCombo = (el) => el.getAttribute('role') === 'combobox' && !/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName);
    // A searchable select: an autocomplete input inside a select box. (An address
    // autocomplete is a free-text box with suggestions, not one of these.)
    const isSearch = (el) => el.tagName === 'INPUT' && el.getAttribute('aria-autocomplete') === 'list'
        && !!el.closest('[class*="select"], [class*="Select"]');

    function press(el) {
        const win = el.ownerDocument.defaultView;
        for (const type of ['mousedown', 'mouseup', 'click']) {
            el.dispatchEvent(new win.MouseEvent(type, { bubbles: true, cancelable: true, button: 0, view: win }));
        }
    }

    /** The box a searchable select draws around its input (it shows the chosen value). */
    const searchBox = (el) => el.closest('[class*="select"][class*="container"], [class*="Select"][class*="container"]')
        || (el.parentElement && el.parentElement.parentElement) || el;

    /** What a widget currently shows as its answer ('' when unanswered). */
    function widgetShows(el) {
        const t = clean(isCombo(el) ? el.textContent : textOf(searchBox(el)));
        return UNANSWERED.test(t) ? '' : t;
    }

    function widgetOptions(el) {
        const doc = el.ownerDocument;
        const owned = (el.getAttribute('aria-owns') || el.getAttribute('aria-controls') || '').split(/\s+/)
            .map((id) => id && doc.getElementById(id)).filter(Boolean);
        let opts = owned.flatMap((lb) => Array.from(lb.querySelectorAll('[role="option"]')));
        if (!opts.length && el.id) opts = Array.from(doc.querySelectorAll('[id^="' + el.id.replace(/["\\]/g, '\\$&') + '-select-row-"]'));
        if (!opts.length) opts = Array.from(doc.querySelectorAll('[role="option"]')).filter(isVisible);
        return opts;
    }

    function closeWidget(el) {
        const win = el.ownerDocument.defaultView;
        el.dispatchEvent(new win.KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', keyCode: 27, bubbles: true }));
        if (el.blur) el.blur();
    }

    /** Opens the widget, clicks the option matching the candidates, and checks it took. */
    async function pickInWidget(el, candidates) {
        press(isCombo(el) ? el : searchBox(el));
        await sleep(250);
        const options = widgetOptions(el).map((o) => ({ o, textContent: o.textContent, value: clean(o.textContent) }));
        const hit = chooseOption(options, candidates);
        if (!hit) { closeWidget(el); return false; }
        press(hit.o);
        await sleep(250);
        return !!widgetShows(el);
    }

    // ------------------------------------------------------------ answers

    /** The GPA to give: the current or most recent school that has one, as typed. */
    function savedGpa(p) {
        const withGpa = (p.education || []).filter((e) => e && String(e.gpa || '').trim());
        if (!withGpa.length) return '';
        const endYear = (e) => String((e.endDate && e.endDate.year) || e.endYear || '').trim();
        const current = withGpa.find((e) => !endYear(e) || Number(endYear(e)) >= new Date().getFullYear());
        return String((current || withGpa[0]).gpa).trim();
    }

    /** Matches option texts like "3.50 - 3.99", "3.5+", "Above 3.0", "Below 2.0" that contain the GPA. */
    function gpaRange(gpa) {
        const g = parseFloat(gpa);
        if (!Number.isFinite(g)) return null;
        return (text) => {
            const t = text.toLowerCase();
            const nums = (t.match(/\d+(?:\.\d+)?/g) || []).map(Number).filter((n) => n <= 5);
            if (nums.length >= 2 && /-|–|\bto\b/.test(t)) return g >= Math.min(nums[0], nums[1]) && g <= Math.max(nums[0], nums[1]) + 0.005;
            if (nums.length !== 1) return false;
            if (/\+|above|or (higher|more|greater|better)|greater|over|at least|minimum/.test(t)) return g >= nums[0];
            if (/below|under|less|lower/.test(t)) return g < nums[0];
            return Math.abs(g - nums[0]) < 0.005;
        };
    }

    /** "Yes" when a saved job is an internship or co-op. Otherwise nothing: a job
        missing from the profile would make "No" a guess. */
    const hadInternship = (p) => (p.workExperience || []).some((w) => /\bintern(ship)?\b|\bco-?op\b/i.test(`${w.title || ''} ${w.company || ''}`));

    const DECLINE = /decline|do not wish|don ?t wish|not wish to|prefer not|choose not|not to (answer|disclose|self.?identify)|i do not want/i;
    const yesNo = (b) => (b ? [/^\s*yes\b/i] : [/^\s*no\b/i]);

    /** Text fields: rule name, what the label must look like, what must not appear, the value. */
    function textRules(p) {
        const pi = p.personalInfo || {};
        const ad = p.address || {};
        const fullName = [pi.firstName, pi.lastName].filter(Boolean).join(' ');
        return [
            ['First name', /\b(first|given|fore) ?name\b|\bfname\b|ac:given-name/, /middle|last|preferred|nick/, pi.firstName, 'Personal information'],
            ['Last name', /\b(last|family|sur) ?name\b|\blname\b|ac:family-name/, /first|middle|maiden|previous|preferred/, pi.lastName, 'Personal information'],
            ['Full name', /^(full |legal |your )?name\b|ac:name$/, /first|last|middle|company|employer|school|reference|manager|user ?name|file|preferred|nick/, fullName, 'Personal information'],
            ['Email', /e ?mail|ac:email/, /confirm|verify|re ?enter|manager|reference|alternate|secondary/, pi.email, 'Personal information'],
            ['Phone', /phone|mobile|cell|telephone|ac:tel/, /type|extension|\bext\b|country code|manager|reference|alternate|secondary|fax/, pi.phone, 'Personal information'],
            ['Street address', /address ?(line)? ?1\b|street|address1|addressstreet ?1|^address\b|ac:address-line1|ac:street-address/, /line ?2|street ?2|address ?2|e ?mail|city|state|zip|postal|country|web|url/, ad.street, 'Address'],
            ['City', /\bcity\b|\btown\b|ac:address-level2/, /state|country|zip|postal|birth/, ad.city, 'Address'],
            ['Zip or postal code', /\bzip\b|postal|post code|postcode|ac:postal-code/, /country/, ad.zip, 'Address'],
            ['LinkedIn', /linked ?in/, null, pi.linkedinUrl, 'Links'],
            ['Website', /website|portfolio|personal (url|site|web)|home ?page|\bblog\b/, /linked ?in|company|employer/, pi.websiteUrl, 'Links'],
            ['GPA', /\bgpa\b|grade point average/, /minimum|required|scale|major gpa/, savedGpa(p), 'Education']
        ];
    }

    /** Questions answered by choosing (select or radio group). Returns candidates, or null to leave it. */
    function questionRules(p) {
        const jp = p.jobPreferences || {};
        const dm = p.demographics || {};
        const decline = jp.autoDisclosures === true;
        const selfId = (value, map) => {
            if (value && DECLINE.test(value)) return [DECLINE];
            if (value) return map(value);
            return decline ? [DECLINE] : null;
        };
        return [
            ['Work authorization', /(legally )?(authori[sz]ed|eligible|permitted) to work|right to work|work authori[sz]ation/, /sponsor/,
                jp.authorizedToWork === undefined ? null : yesNo(jp.authorizedToWork !== false), 'Work eligibility'],
            ['Visa sponsorship', /sponsor/, null, yesNo(jp.requiresSponsorship === true), 'Work eligibility'],
            // Only asserted when the person said so; otherwise left for them.
            ['Age 18 or older', /\b18\b.*(age|old)|(age|old).*\b18\b|legal (working )?age/, null, jp.isAtLeast18 ? yesNo(true) : null, 'Work eligibility'],
            ['U.S. citizen', /\bu ?s\b.*citizen|citizen of the united states/, /dual|other/, jp.usCitizen ? yesNo(true) : null, 'Work eligibility'],
            ['Former employee', /(previously|ever|have you) (ever )?(been )?(employed|worked) (by|for|at|with)|former employee|worked (for|at|with) (us|this company) before/, /government|other (company|employer)/,
                yesNo(jp.formerEmployee === true), 'Work eligibility'],
            ['How did you hear', /how did you (hear|learn|find)|source|referr(al|ed) (source|by)/, /employee name|who referred/,
                jp.sourceReferral ? [jp.sourceReferral] : null, 'Work eligibility'],
            ['Gender', /\bgender\b|\bsex\b/, /orientation|identity.*trans/, selfId(dm.gender, (v) => /^m/i.test(v) ? ['Male', 'Man'] : /^f/i.test(v) ? ['Female', 'Woman'] : [v]), 'Self-identification'],
            ['Hispanic or Latino', /hispanic|latin[oax]/, null, selfId(dm.hispanicLatino, (v) => /^y/i.test(v)
                ? [/^\s*yes\b/i, /^\s*hispanic/i] : [/^\s*no\b/i, /not hispanic/i]), 'Self-identification'],
            ['Race', /\brace\b|ethnic/, /hispanic or latino\s*\??$/, selfId(dm.race, (v) => [v, ...v.split(/\s+or\s+/)]), 'Self-identification'],
            ['Veteran status', /veteran/, null, selfId(dm.veteranStatus, (v) => /not a veteran/i.test(v) ? [/not a (protected )?veteran|i am not a veteran|^\s*no\b/i]
                : /not a protected/i.test(v) ? [/not a protected/i] : [/^(?!.*\bnot\b).*protected veteran/i, /^\s*yes\b/i]), 'Self-identification'],
            ['Disability', /disabilit/, null, selfId(dm.disabilityStatus, (v) => /^y/i.test(v) ? [/^\s*yes\b/i] : [/^\s*no\b/i]), 'Self-identification'],
            ['GPA', /\bgpa\b|grade point average/, /minimum|required|scale/, savedGpa(p) ? [savedGpa(p), gpaRange(savedGpa(p))].filter(Boolean) : null, 'Education'],
            ['Internship experience', /\b(previous|prior|any|past)\b.*\b(internship|co ?op)s?\b/, null, hadInternship(p) ? yesNo(true) : null, 'Education']
        ];
    }

    // ------------------------------------------------------------ the fill

    /**
     * Fills every recognisable field in `doc` from the saved profile.
     * Returns a fill report: { site, page, build, at, counts, steps, empty }.
     */
    async function fill(doc, profile, { site = 'other', page = '' } = {}) {
        const steps = [];
        const done = new Set(); // controls already handled
        const add = (status, section, field, detail) => steps.push({ status, section, field, ...(detail ? { detail } : {}) });

        const controls = Array.from(doc.querySelectorAll('input, select, textarea, [role="combobox"]')).filter(usable)
            .filter((el) => el.getAttribute('aria-disabled') !== 'true')
            .filter((el) => !/^(password|submit|button|image|reset|search)$/i.test(el.type))
            .filter((el) => !/captcha/i.test(`${el.name} ${el.id} ${el.className}`));

        // Text fields.
        const textual = controls.filter((el) => !isSearch(el) && (el.tagName === 'TEXTAREA' || (el.tagName === 'INPUT' && /^(text|email|tel|url|number|)$/i.test(el.type))));
        for (const [field, want, avoid, value, section] of textRules(profile)) {
            if (!value) continue;
            const el = textual.find((c) => !done.has(c) && want.test(keysOf(c)) && !(avoid && avoid.test(norm(labelFor(c)))));
            if (!el) continue;
            done.add(el);
            if (el.value && el.value.trim()) { add('kept', section, field); continue; } // the site or the person already filled it
            setNative(el, value);
            if (el.value === String(value)) add('filled', section, field);
            else add('failed', section, field, 'The page did not keep the value.');
        }

        // State and country: a select or a text box.
        const ad = profile.address || {};
        const fillPlace = async (field, want, candidates, text) => {
            const el = controls.find((c) => !done.has(c) && !isCombo(c) && c.type !== 'radio' && c.type !== 'checkbox' && want.test(keysOf(c)));
            if (!el || !text) return;
            done.add(el);
            if (isSearch(el)) {
                if (widgetShows(el)) { add('kept', 'Address', field); return; }
                if (await pickInWidget(el, candidates)) add('filled', 'Address', field);
                else add('failed', 'Address', field, `No option matched "${text}".`);
            } else if (el.tagName === 'SELECT') {
                if (el.value && !isPlaceholderOption(el.selectedOptions[0] || {})) { add('kept', 'Address', field); return; }
                if (selectOption(el, candidates)) add('filled', 'Address', field);
                else add('failed', 'Address', field, `No option matched "${text}".`);
            } else if (el.value) {
                add('kept', 'Address', field);
            } else {
                setNative(el, text);
                if (el.value) add('filled', 'Address', field);
            }
        };
        const stateName = ad.state && (US_STATES[ad.state.toUpperCase()] || ad.state);
        const stateAbbr = stateName && Object.keys(US_STATES).find((k) => US_STATES[k].toLowerCase() === stateName.toLowerCase());
        await fillPlace('State', /\bstate\b|province|ac:address-level1/, [stateName, stateAbbr].filter(Boolean), stateName);
        const isUS = ad.country && US_NAMES.includes(norm(ad.country));
        await fillPlace('Country', /\bcountry\b(?! code)|ac:country/, isUS ? ['United States', 'United States of America', 'USA', 'US'] : [ad.country], ad.country);

        // Questions: selects and radio groups.
        const questions = [];
        const seenGroups = new Set();
        for (const el of controls) {
            if (done.has(el)) continue;
            if (el.tagName === 'SELECT') questions.push({ el, ask: questionFor(el), kind: 'select' });
            else if (isCombo(el) || isSearch(el)) questions.push({ el, ask: labelFor(el) || questionFor(el), kind: 'widget' });
            else if (el.type === 'radio' && !seenGroups.has(el.name)) {
                seenGroups.add(el.name);
                questions.push({ el, ask: questionFor(el), kind: 'radio', group: radioGroup(doc, el) });
            }
        }
        for (const [field, want, avoid, candidates, section] of questionRules(profile)) {
            const q = questions.find((x) => !x.used && want.test(norm(x.ask)) && !(avoid && avoid.test(norm(x.ask))));
            if (!q) continue;
            q.used = true;
            if (!candidates) {
                add('skipped', section, field, section === 'Self-identification' ? 'No saved answer.' : 'Left for you to answer.');
                continue;
            }
            if (q.kind === 'widget') {
                if (widgetShows(q.el)) { add('kept', section, field); continue; }
                if (await pickInWidget(q.el, candidates)) add('filled', section, field);
                else add('failed', section, field, 'No option matched your saved answer.');
            } else if (q.kind === 'select') {
                if (q.el.value && !isPlaceholderOption(q.el.selectedOptions[0] || {})) { add('kept', section, field); continue; }
                if (selectOption(q.el, candidates)) add('filled', section, field);
                else add('failed', section, field, 'No option matched your saved answer.');
            } else {
                if (q.group.some((r) => r.checked)) { add('kept', section, field); continue; }
                if (chooseRadio(q.group, candidates)) add('filled', section, field);
                else add('failed', section, field, 'No option matched your saved answer.');
            }
        }

        // Most recent school and job, when the page asks for one of each.
        const firstWith = (want, avoid) => textual.find((c) => !done.has(c) && want.test(norm(labelFor(c) || keysOf(c))) && !(avoid && avoid.test(norm(labelFor(c)))));
        const edu = (profile.education || [])[0];
        if (edu) {
            for (const [field, want, value] of [
                ['School', /school|university|college|institution/, edu.school],
                ['Field of study', /major|field of study|area of study|discipline/, edu.fieldOfStudy || edu.field]
            ]) {
                const el = value && firstWith(want, /high school diploma|graduat(ed|ion) (date|year)/);
                if (!el) continue;
                done.add(el);
                if (el.value) { add('kept', 'Education', field); continue; }
                setNative(el, value);
                if (el.value) add('filled', 'Education', field);
            }
        }
        const job = (profile.workExperience || [])[0];
        if (job) {
            const employer = job.company && firstWith(/employer|company( name)?$|^company\b/, /current company you are applying|reference/);
            if (employer) {
                done.add(employer);
                if (employer.value) add('kept', 'Work experience', 'Employer');
                else { setNative(employer, job.company); if (employer.value) add('filled', 'Work experience', 'Employer'); }
                const title = job.title && firstWith(/job title|position( title)?|^title$/, /applying|desired/);
                if (title) {
                    done.add(title);
                    if (title.value) add('kept', 'Work experience', 'Job title');
                    else { setNative(title, job.title); if (title.value) add('filled', 'Work experience', 'Job title'); }
                }
                const typed = (field, el, value) => {
                    if (!el || !value) return;
                    done.add(el);
                    if (el.value) { add('kept', 'Work experience', field); return; }
                    setNative(el, value);
                    if (el.value) add('filled', 'Work experience', field);
                };
                typed('Responsibilities', textual.find((c) => !done.has(c) && /responsibilit|duties|job description|role description/.test(keysOf(c))), job.description);
                // Month and year, as the field's own MM/YYYY hint asks. A full date is left alone.
                const monthYear = (d, el) => {
                    if (!d || !d.month || !d.year || !el) return '';
                    if (/dd/i.test(el.placeholder || '')) return '';
                    return `${String(d.month).padStart(2, '0')}/${d.year}`;
                };
                const startEl = textual.find((c) => !done.has(c) && /\bstart ?date\b|\bdate started\b|\bfrom date\b/.test(keysOf(c)));
                typed('Start date', startEl, monthYear(job.startDate, startEl));
                if (job.isCurrentRole) {
                    const box = controls.find((c) => c.type === 'checkbox' && !c.checked && /current(ly)? (work|employ)|i currently work|present/.test(keysOf(c)));
                    if (box) { box.click(); if (box.checked) add('filled', 'Work experience', 'Currently working here'); }
                } else {
                    const endEl = textual.find((c) => !done.has(c) && /\bend ?date\b|\bdate ended\b|\bto date\b/.test(keysOf(c)));
                    typed('End date', endEl, monthYear(job.endDate, endEl));
                }
            }
        }

        // Resume.
        const resume = attachResume(doc, controls, profile);
        // A resume the site already has on file counts as kept.
        if (resume) add(resume.status, 'Resume', 'Resume file', resume.detail);

        // Required fields still empty: what the person must finish.
        const empty = [];
        const radiosSeen = new Set();
        for (const el of controls) {
            if (!isRequired(el)) continue;
            if (isCombo(el) || isSearch(el)) {
                if (!widgetShows(el)) empty.push({ required: true, field: el.id || el.name, label: (labelFor(el) || el.id).slice(0, 120) });
                continue;
            }
            if (el.type === 'radio') {
                if (radiosSeen.has(el.name)) continue;
                radiosSeen.add(el.name);
                if (radioGroup(doc, el).some((r) => r.checked)) continue;
                empty.push({ required: true, field: el.name, label: clean(questionFor(el)).slice(0, 120) || el.name });
            } else if (el.type === 'checkbox') {
                continue; // attestations are the person's to tick
            } else if (el.type === 'file' ? !el.files || !el.files.length : !String(el.value || '').trim() || (el.tagName === 'SELECT' && isPlaceholderOption(el.selectedOptions[0] || {}))) {
                empty.push({ required: true, field: el.name || el.id, label: (labelFor(el) || el.name || el.id).replace(/\s*\*\s*$/, '').slice(0, 120) });
            }
        }

        const counts = {
            filled: steps.filter((s) => s.status === 'filled').length,
            failed: steps.filter((s) => s.status === 'failed').length,
            kept: steps.filter((s) => s.status === 'kept').length,
            emptyRequired: empty.length
        };
        return { site, page, build: BUILD, at: new Date().toISOString(), counts, steps, empty };
    }

    function attachResume(doc, controls, profile) {
        const files = controls.filter((el) => el.type === 'file');
        if (!files.length || !profile.resume || !profile.resumeMeta) return null;
        const target = files.find((f) => /resume|\bcv\b|curriculum/.test(keysOf(f))) || (files.length === 1 ? files[0] : null);
        if (!target) return null;
        if (target.files && target.files.length) return { status: 'kept' };
        const win = doc.defaultView;
        try {
            const [head, data] = profile.resume.split(',');
            const mime = head.split(':')[1].split(';')[0];
            const bin = win.atob(data);
            const bytes = new Uint8Array(bin.length);
            for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
            const file = new win.File([bytes], profile.resumeMeta.name, { type: mime, lastModified: profile.resumeMeta.lastModified });
            const dt = new win.DataTransfer();
            dt.items.add(file);
            target.files = dt.files;
            target.dispatchEvent(new win.Event('change', { bubbles: true }));
            return target.files.length ? { status: 'filled' } : { status: 'failed', detail: 'Attach your resume yourself.' };
        } catch (e) {
            return { status: 'failed', detail: 'Attach your resume yourself.' };
        }
    }

    /** True when the page is a sign-in or account step: autofill leaves those alone. */
    function isSignInPage(doc) {
        return Array.from(doc.querySelectorAll('input[type="password"]')).some(isVisible);
    }

    root.EasyApplyFormFiller = { BUILD, fill, isSignInPage, labelFor, questionFor, chooseOption, isVisible };
})(typeof self !== 'undefined' ? self : this);
