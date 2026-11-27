/*
 * On-page AI answers + Answer Library (plan/Features/F04, F11).
 *
 * Next to each long free-text question on a job form, a small "Draft" button.
 * It opens a panel that offers the user's saved answers first (free, instant),
 * then "Adapt" or "New draft" with AI. Nothing reaches the form until the user
 * presses Insert, and nothing is saved to the library unless they tick the box.
 *
 * Signed-in users only. Every cloud call goes through the background relay
 * (background.js), which holds the session and reads the profile itself.
 * The UI lives in a closed shadow root so the job site's CSS and scripts can't
 * reach into it, and all text is set with textContent.
 */
(function () {
    'use strict';
    if (window.__easyApplyAiAssist) return;
    window.__easyApplyAiAssist = true;

    const Lib = self.EasyApplyLibrary;
    const DEFAULT_MAX = 1500;
    const JOB_CACHE_KEY = 'aiJobCache';
    const CAT_CACHE_KEY = 'aiCategoryCache';
    const SAVE_PREF_KEY = 'aiSaveToLibrary';
    const MARK = 'data-easyapply-ai';

    let signedIn = false;
    let answersPromise = null;

    // ------------------------------------------------------------ relay

    function relay(op, args) {
        return new Promise((resolve, reject) => {
            try {
                chrome.runtime.sendMessage({ action: 'cloud_relay', op, args }, (res) => {
                    if (chrome.runtime.lastError) return reject(new Error('The extension was reloaded. Refresh this page.'));
                    if (!res || !res.ok) {
                        const err = new Error((res && res.error) || 'Request failed');
                        err.status = res && res.status;
                        err.notSignedIn = res && res.notSignedIn;
                        return reject(err);
                    }
                    resolve(res.data);
                });
            } catch (e) {
                reject(new Error('The extension was reloaded. Refresh this page.'));
            }
        });
    }

    const loadAnswers = () => {
        if (!answersPromise) answersPromise = relay('listAnswers').then((r) => r.items || []).catch((e) => { answersPromise = null; throw e; });
        return answersPromise;
    };

    // ------------------------------------------------------------ the job on this page

    const text = (el) => (el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '');

    function jobKey() {
        const path = location.pathname.split(/\/apply(\/|$)/)[0].replace(/\/$/, '');
        return (location.origin + path).toLowerCase();
    }

    function readJobFromPage() {
        const heading = document.querySelector(
            '[data-automation-id="jobPostingHeader"], [data-automation-id="jobTitleHeading"], .app-title, .job__title h1, .job-title, h1'
        );
        const logo = document.querySelector('[data-automation-id="logo"] img, img[data-automation-id="logo"]');
        const ghCompany = document.querySelector('.company-name, .job__company, [class*="company-name"]');
        const site = document.querySelector('meta[property="og:site_name"]');
        const desc = document.querySelector(
            '[data-automation-id="jobPostingDescription"], #content .job__description, .job__description, #content #gh_jid ~ *, [class*="job-description"], #content'
        );
        let company = (logo && logo.alt) || text(ghCompany).replace(/^at\s+/i, '') || (site && site.content) || '';
        if (/^(logo|company logo|careers?|home|workday)$/i.test(company.trim())) company = '';
        if (!company && /\.myworkdayjobs\.com$/i.test(location.hostname)) {
            company = location.hostname.split('.')[0].replace(/[-_]+/g, ' ').replace(/\b[a-z]/g, (m) => m.toUpperCase());
        }
        const description = text(desc);
        return {
            company: company.trim().slice(0, 200),
            role: text(heading).slice(0, 200),
            description: description.length >= 200 ? description.slice(0, 12000) : ''
        };
    }

    /** Remembers the job description from the posting page, for the apply pages that don't show it. */
    async function rememberJob() {
        const job = readJobFromPage();
        if (!job.description) return;
        const { [JOB_CACHE_KEY]: cache = {} } = await chrome.storage.local.get(JOB_CACHE_KEY);
        cache[jobKey()] = { ...job, at: Date.now() };
        const keep = Object.entries(cache).sort((a, b) => b[1].at - a[1].at).slice(0, 15);
        await chrome.storage.local.set({ [JOB_CACHE_KEY]: Object.fromEntries(keep) });
    }

    async function jobContext() {
        const live = readJobFromPage();
        const { [JOB_CACHE_KEY]: cache = {} } = await chrome.storage.local.get(JOB_CACHE_KEY);
        const saved = cache[jobKey()] || {};
        return {
            company: live.company || saved.company || '',
            role: live.role || saved.role || '',
            description: live.description || saved.description || ''
        };
    }

    // ------------------------------------------------------------ finding questions

    function questionFor(box) {
        const parts = [];
        if (box.id) {
            const l = document.querySelector(`label[for="${CSS.escape(box.id)}"]`);
            if (l) parts.push(text(l));
        }
        const by = box.getAttribute('aria-labelledby');
        if (by) for (const id of by.split(/\s+/)) parts.push(text(document.getElementById(id)));
        const field = box.closest('[data-automation-id^="formField"], .field, .application-question, fieldset, [role="group"]');
        if (field) {
            const l = field.querySelector('label, legend, [data-automation-id="richText"], .application-label');
            if (l) parts.push(text(l));
        }
        parts.push(box.getAttribute('aria-label') || '', box.getAttribute('placeholder') || '');
        const q = parts.map((p) => p.replace(/\*/g, '').replace(/\(required\)/i, '').trim()).find((p) => p.length >= 8) || '';
        return q.slice(0, 1000);
    }

    // Profile fields autofill already handles, and panels it fills.
    const SKIP_LABEL = /^(role |job )?description$|^(street )?address|^summary$|^skills$|^additional information$/i;

    function inProfilePanel(box) {
        for (let el = box.parentElement; el && el !== document.body; el = el.parentElement) {
            const h = el.querySelector(':scope > h2, :scope > h3, :scope > h4, :scope > h5, :scope > [role="heading"], :scope > legend');
            if (h && /^\s*(work experience|education)\s*\d*\s*$/i.test(text(h))) return true;
        }
        return false;
    }

    function candidateBoxes() {
        return Array.from(document.querySelectorAll('textarea')).filter((box) => {
            if (box.hasAttribute(MARK) || box.disabled || box.readOnly) return false;
            if (box.offsetParent === null) return false;
            const q = questionFor(box);
            return q.length >= 8 && !SKIP_LABEL.test(q) && !inProfilePanel(box);
        });
    }

    const maxCharsFor = (box) => (box.maxLength > 0 ? Math.min(box.maxLength, 5000) : DEFAULT_MAX);

    function setBoxValue(box, value) {
        const proto = Object.getPrototypeOf(box);
        const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set
            || Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
        box.focus();
        setter.call(box, value);
        box.dispatchEvent(new Event('input', { bubbles: true }));
        box.dispatchEvent(new Event('change', { bubbles: true }));
        box.dispatchEvent(new Event('blur', { bubbles: true }));
    }

    // ------------------------------------------------------------ UI

    const CSS_TEXT = `
      :host { all: initial;
        /* Same tokens as popup.css. The page cannot see into this closed root. */
        --primary: #d4a574; --primary-hover: #bf9156; --on-primary: #1a1612;
        --bg: #1a1612; --card-bg: #2d2a27; --surface-raised: #35312d;
        --text: #f5f1ed; --text-muted: #a29790; --border: #3a3531;
        --accent: #a8b5a0; --success: #6b9e7a; --danger: #e67873;
        --radius-s: 3px; --radius-m: 6px;
        --dur-fast: 90ms; --dur-base: 160ms; --ease: cubic-bezier(0.2, 0.7, 0.2, 1);
        --dither-amber-down: url("data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' width='4' height='8' viewBox='0 0 4 8' shape-rendering='crispEdges'%3E%3Cpath fill='%23d4a574' d='M0 0h1v1h-1zM2 0h1v1h-1zM1 1h1v1h-1zM0 2h1v1h-1zM2 2h1v1h-1zM0 4h1v1h-1zM2 4h1v1h-1zM2 6h1v1h-1z'/%3E%3C/svg%3E");
        --mono: ui-monospace, Consolas, monospace; }
      * { box-sizing: border-box; font-family: system-ui, -apple-system, 'Segoe UI', Roboto, sans-serif; }
      .btn { position: relative; font-size: 12px; font-weight: 600; border-radius: var(--radius-s); padding: 4px 10px; cursor: pointer;
        border: 1px solid var(--border); background: var(--card-bg); color: var(--text); line-height: 1.4;
        transition: background-color var(--dur-base) var(--ease), transform var(--dur-fast) var(--ease); }
      .btn:hover { background: var(--surface-raised); }
      .btn:active { transform: translateY(1px); }
      .btn.primary { background: var(--primary); border-color: var(--primary); color: var(--on-primary); }
      .btn.primary:hover { background: var(--primary-hover); }
      .btn:disabled { opacity: .55; cursor: wait; }
      .btn.is-busy { opacity: 1; cursor: progress; }
      .btn:focus-visible, textarea:focus-visible, input:focus-visible { outline: 2px solid var(--accent); outline-offset: 1px; }

      /* The trigger sits on the job site's own (light) page, so it is an outline,
         not a fill: a crisp 1 px amber edge plus an amber glow on a pseudo-element.
         Only the glow's opacity ever changes, so the page layout never moves. */
      .trigger { margin: 8px 0; background: transparent; color: var(--on-primary); border-color: transparent;
        box-shadow: 0 0 0 1px var(--primary-hover); }
      .trigger:hover { background: transparent; }
      .trigger:focus-visible { outline: 2px solid var(--on-primary); outline-offset: 3px; }
      .trigger::after, .trigger::before { content: ''; position: absolute; inset: -1px; border-radius: inherit; pointer-events: none; }
      .trigger::after { box-shadow: 0 0 8px 2px color-mix(in srgb, var(--primary) 80%, transparent); opacity: .7;
        transition: opacity var(--dur-base) var(--ease); }
      .trigger:hover::after, .trigger:focus-visible::after, .trigger.is-near::after { opacity: 1; }
      .trigger.is-busy::after { animation: breathe 1.6s ease-in-out infinite alternate; }
      @keyframes breathe { from { opacity: .3; } to { opacity: 1; } }
      .trigger.pulse::before { animation: pulse-ring 420ms var(--ease) 1; }
      @keyframes pulse-ring {
        0%   { box-shadow: 0 0 0 0 color-mix(in srgb, var(--success) 85%, transparent); }
        100% { box-shadow: 0 0 0 5px color-mix(in srgb, var(--success) 0%, transparent); }
      }

      .panel { position: relative; margin: 6px 0 12px; padding: 16px 12px 12px; border-radius: var(--radius-m); background: var(--bg); color: var(--text);
        border: 1px solid var(--border); font-size: 13px; line-height: 1.45; max-width: 720px; overflow: hidden; }
      /* Pixel-gradient header band, inside the top padding: never behind text. */
      .panel::before { content: ''; position: absolute; inset: 0 0 auto 0; height: 12px;
        background: var(--dither-amber-down) 0 0 / 8px 16px repeat-x; image-rendering: pixelated; pointer-events: none; }
      .head { display: flex; align-items: center; gap: 8px; margin-bottom: 8px; }
      .kicker { font: 600 11px var(--mono); text-transform: uppercase; letter-spacing: .06em; color: var(--primary); }
      .muted { color: var(--text-muted); }
      .x { margin-left: auto; background: none; border: 0; color: var(--text-muted); font-size: 18px; cursor: pointer; padding: 0 4px; }
      .x:hover { color: var(--text); }
      .match { border: 1px solid var(--border); border-radius: var(--radius-m); padding: 8px; margin: 6px 0; background: var(--card-bg); }
      .match p { margin: 0 0 6px; white-space: pre-wrap; }
      .row { display: flex; gap: 6px; flex-wrap: wrap; align-items: center; }
      textarea { width: 100%; min-height: 140px; margin: 8px 0 4px; padding: 8px; border-radius: var(--radius-s); resize: vertical;
        background: var(--card-bg); color: var(--text); border: 1px solid var(--border); font-size: 13px; line-height: 1.5; }
      .count { font-size: 11px; font-family: var(--mono); font-variant-numeric: tabular-nums; }
      .count.over { color: var(--danger); }
      .status { min-height: 1.2em; margin-top: 6px; font-size: 12px; }
      .status.err { color: var(--danger); }
      label.save { display: flex; gap: 6px; align-items: center; margin-right: auto; font-size: 12px; color: var(--text-muted); cursor: pointer; }
      .foot { display: flex; gap: 8px; align-items: center; margin-top: 6px; }
      .sr { position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0); white-space: nowrap; }

      @media (prefers-reduced-motion: reduce) {
        *, *::before, *::after { transition-duration: 0.01ms !important; }
        .trigger.is-busy::after { animation: none; opacity: 1; }
        .trigger.pulse::before { animation: pulse-hold 1.5s steps(1, end) 1; }
        @keyframes pulse-hold { 0%, 100% { box-shadow: 0 0 0 2px var(--success); } }
      }
    `;

    const h = (tag, props = {}, ...kids) => {
        const n = document.createElement(tag);
        for (const [k, v] of Object.entries(props)) {
            if (k === 'class') n.className = v;
            else if (k === 'text') n.textContent = v;
            else if (k.startsWith('on')) n.addEventListener(k.slice(2), v);
            else n.setAttribute(k, v);
        }
        n.append(...kids.filter(Boolean));
        return n;
    };

    function attach(box) {
        box.setAttribute(MARK, '1');
        const host = document.createElement('div');
        host.setAttribute('data-easyapply-ai-host', '');
        const root = host.attachShadow({ mode: 'closed' });
        root.append(h('style', { text: CSS_TEXT }));
        const trigger = h('button', { type: 'button', class: 'btn trigger', text: '✦ Draft', title: 'Saved answers and AI drafts (Better Autofill)' });
        const slot = h('div');
        const live = h('div', { class: 'sr', 'aria-live': 'polite' }); // outlives the panel
        root.append(trigger, slot, live);
        box.insertAdjacentElement('afterend', host);

        // Its question has focus: the glow strengthens (staged focus).
        box.addEventListener('focus', () => trigger.classList.add('is-near'));
        box.addEventListener('blur', () => trigger.classList.remove('is-near'));
        const pulse = () => {
            trigger.classList.remove('pulse');
            void trigger.offsetWidth;
            trigger.classList.add('pulse');
            trigger.addEventListener('animationend', () => trigger.classList.remove('pulse'), { once: true });
        };

        let open = false;
        trigger.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            if (open) { slot.replaceChildren(); open = false; return; }
            open = true;
            slot.replaceChildren(buildPanel(box, (inserted) => {
                slot.replaceChildren(); open = false;
                if (inserted === true) { live.textContent = 'Answer inserted.'; pulse(); }
            }, trigger));
        });
    }

    function buildPanel(box, close, trigger) {
        const question = questionFor(box);
        const maxChars = maxCharsFor(box);
        let category = null;
        let source = null; // { id, filled } when the editor holds a library answer

        const status = h('div', { class: 'status', 'aria-live': 'polite' });
        const say = (msg, err = false) => { status.textContent = msg || ''; status.className = `status${err ? ' err' : ''}`; };

        const editor = h('textarea', { 'aria-label': 'Answer to insert', placeholder: 'Pick a saved answer or draft one with AI. You can edit it here before inserting.' });
        editor.value = box.value || '';
        const count = h('span', { class: 'count muted' });
        const updateCount = () => {
            count.textContent = `${editor.value.length} / ${maxChars}`;
            count.classList.toggle('over', editor.value.length > maxChars);
        };
        editor.addEventListener('input', () => { updateCount(); if (source && editor.value !== source.filled) source = null; });
        updateCount();

        const saveBox = h('input', { type: 'checkbox' });
        chrome.storage.local.get(SAVE_PREF_KEY).then((r) => { saveBox.checked = !!r[SAVE_PREF_KEY]; });
        const insert = h('button', { type: 'button', class: 'btn primary', text: 'Insert' });
        const matches = h('div', {}, h('div', { class: 'muted', text: 'Looking in your saved answers…' }));
        const draftBtn = h('button', { type: 'button', class: 'btn', text: 'New draft with AI' });
        const kicker = h('span', { class: 'kicker', text: 'Your answer' });

        async function busy(button, label, fn) {
            const before = button.textContent;
            button.disabled = true;
            button.textContent = label;
            button.classList.add('is-busy');
            if (trigger) trigger.classList.add('is-busy');
            try { await fn(); } catch (e) {
                say(e.status === 429 ? e.message : e.notSignedIn ? 'Sign in again in the Better Autofill side panel.' : `Couldn't do that: ${e.message}`, true);
            } finally {
                button.disabled = false; button.textContent = before;
                button.classList.remove('is-busy');
                if (trigger) trigger.classList.remove('is-busy');
            }
        }

        draftBtn.addEventListener('click', () => busy(draftBtn, 'Drafting…', async () => {
            say('Writing a first draft from your profile…');
            const job = await jobContext();
            const { text: t } = await relay('draft', { question, maxChars, job });
            editor.value = t; source = null; updateCount();
            say(job.description ? 'Draft ready. Edit it, then Insert.' : 'Draft ready (no job description found, so it is more general). Edit it, then Insert.');
        }));

        insert.addEventListener('click', () => busy(insert, 'Inserting…', async () => {
            const value = editor.value.trim();
            if (!value) { say('Nothing to insert yet.', true); return; }
            setBoxValue(box, value);
            await chrome.storage.local.set({ [SAVE_PREF_KEY]: saveBox.checked });
            const jobs = [];
            if (source && source.filled === value) jobs.push(relay('useAnswer', { id: source.id }).catch(() => {}));
            else if (saveBox.checked) {
                const job = await jobContext();
                jobs.push(relay('saveAnswer', {
                    category: category || 'custom',
                    question,
                    text: Lib.toTemplate(value, job).slice(0, 5000)
                }).then(() => { answersPromise = null; }));
            }
            await Promise.all(jobs);
            close(true);
        }));

        // Library matches: rules first, then the tiny categoriser (cached per question).
        (async () => {
            try {
                const job = await jobContext();
                category = Lib.categoriseByRules(question, job.company);
                if (!category) {
                    const key = Lib.questionKey(question);
                    const { [CAT_CACHE_KEY]: cache = {} } = await chrome.storage.local.get(CAT_CACHE_KEY);
                    category = cache[key] || null;
                    if (!category) {
                        category = (await relay('categorise', { question }).catch(() => ({ category: 'custom' }))).category;
                        cache[key] = category;
                        const keep = Object.entries(cache).slice(-300);
                        await chrome.storage.local.set({ [CAT_CACHE_KEY]: Object.fromEntries(keep) });
                    }
                }
                const ranked = Lib.rankAnswers(await loadAnswers(), { category, maxChars });
                kicker.textContent = Lib.LABELS[category] || 'Your answer';
                if (!ranked.length) {
                    matches.replaceChildren(h('div', { class: 'muted', text: 'No saved answer for this kind of question yet. Draft one, and tick "Save to library" to reuse it next time.' }));
                    return;
                }
                matches.replaceChildren(...ranked.map((a) => {
                    const filled = Lib.fillPlaceholders(a.text, job);
                    const use = h('button', { type: 'button', class: 'btn', text: 'Use' });
                    use.addEventListener('click', () => {
                        editor.value = filled; source = { id: a.id, filled }; updateCount();
                        say(filled.length > maxChars ? 'Too long for this box: edit it, or Adapt with AI.' : 'Loaded. Edit if you like, then Insert.');
                    });
                    const adapt = h('button', { type: 'button', class: 'btn', text: job.company ? `Adapt to ${job.company.slice(0, 30)}` : 'Adapt with AI' });
                    adapt.addEventListener('click', () => busy(adapt, 'Adapting…', async () => {
                        const { text: t } = await relay('adapt', { question, savedAnswer: filled, maxChars, job });
                        editor.value = t; source = null; updateCount();
                        say('Adapted. Edit it, then Insert.');
                    }));
                    const meta = `${a.uses ? `used ${a.uses}×` : 'not used yet'} · ${a.charCount || a.text.length} chars`;
                    return h('div', { class: 'match' },
                        h('p', { text: filled.length > 260 ? `${filled.slice(0, 260)}…` : filled }),
                        h('div', { class: 'row' }, use, adapt, h('span', { class: 'muted', text: meta })));
                }));
            } catch (e) {
                matches.replaceChildren(h('div', { class: 'muted', text: e.notSignedIn ? 'Sign in in the side panel to use saved answers.' : "Couldn't load your saved answers." }));
            }
        })();

        return h('div', { class: 'panel', role: 'group', 'aria-label': 'Draft an answer' },
            h('div', { class: 'head' }, kicker, h('span', { class: 'muted', text: `max ${maxChars} characters` }),
                h('button', { type: 'button', class: 'x', 'aria-label': 'Close', text: '×', onclick: close })),
            matches,
            h('div', { class: 'row' }, draftBtn),
            editor,
            h('div', { class: 'foot' }, h('label', { class: 'save' }, saveBox, h('span', { text: 'Save to library' })), count, insert),
            status);
    }

    // ------------------------------------------------------------ start

    let scanTimer = null;
    function scan() {
        clearTimeout(scanTimer);
        scanTimer = setTimeout(() => {
            if (!signedIn) return;
            for (const box of candidateBoxes()) attach(box);
            rememberJob().catch(() => {});
        }, 400);
    }

    async function refreshStatus() {
        try {
            const { aiAssistOff } = await chrome.storage.local.get('aiAssistOff');
            signedIn = !aiAssistOff && !!(await relay('status')).signedIn;
        } catch (e) { signedIn = false; }
        if (!signedIn) {
            document.querySelectorAll('[data-easyapply-ai-host]').forEach((n) => n.remove());
            document.querySelectorAll(`[${MARK}]`).forEach((n) => n.removeAttribute(MARK));
        }
        answersPromise = null;
        scan();
    }

    chrome.storage.onChanged.addListener((changes, area) => {
        if (area === 'local' && (changes.cloudAuth || changes.aiAssistOff)) refreshStatus();
    });

    // The side panel asks for the job on this page (match score).
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
        if (msg && msg.action === 'get_job_context') {
            jobContext().then(sendResponse, () => sendResponse(null));
            return true;
        }
        return false;
    });

    new MutationObserver(scan).observe(document.documentElement, { childList: true, subtree: true });
    refreshStatus();

    // For tests.
    window.__easyApplyAiAssistTest = { candidateBoxes, questionFor, readJobFromPage, jobKey, maxCharsFor };
})();
