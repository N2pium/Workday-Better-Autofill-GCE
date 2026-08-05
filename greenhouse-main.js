// Greenhouse Autofill - MAIN world helper
/**
 * Runs in the page's JavaScript world (world: 'MAIN'), where React internals
 * are visible. The new job-boards.greenhouse.io UI renders every dropdown as a
 * react-select combobox that ignores synthetic DOM events (verified live:
 * mousedown/keydown/focus dispatches never open the menu). Instead of fighting
 * the menu, this helper walks the React fiber from the combobox <input> to the
 * react-select component and calls its own selectOption() API directly.
 *
 * It has NO chrome.* access. greenhouse.js (isolated world) sends fill
 * requests via window.postMessage and receives results the same way.
 */
(function () {
    if (window.__ghAutofillMainLoaded) return;
    window.__ghAutofillMainLoaded = true;
    console.log('Greenhouse Autofill: main-world helper loaded.');

    const norm = s => (s || '').toString().toLowerCase().replace(/[^a-z0-9]/g, '');

    function commonPrefixLen(a, b) {
        let i = 0;
        while (i < a.length && i < b.length && a[i] === b[i]) i++;
        return i;
    }

    // Walk up the fiber tree from the combobox input to the react-select
    // internals: props containing selectOption() and the options array.
    function findSelectApi(input) {
        const fiberKey = Object.keys(input).find(k => k.startsWith('__reactFiber$'));
        if (!fiberKey) return null;
        let fiber = input[fiberKey];
        for (let i = 0; i < 30 && fiber; i++) {
            const p = fiber.memoizedProps;
            if (p && typeof p.selectOption === 'function' && Array.isArray(p.options)) return p;
            fiber = fiber.return;
        }
        return null;
    }

    // Options may be grouped: [{label, options: [...]}, ...]
    function flatten(options) {
        const out = [];
        for (const o of options) {
            if (o && Array.isArray(o.options)) out.push(...o.options);
            else if (o) out.push(o);
        }
        return out;
    }

    /**
     * Pick the best option for any of the candidate strings.
     * Scoring handles phrasing drift, e.g. profile "United States of America"
     * vs option "United States +1" (long common prefix), or "Decline to
     * Self-Identify" vs "I don't wish to answer" (decline-intent fallback).
     */
    function pickOption(options, candidates, declineOk, reject) {
        let flat = flatten(options).filter(o => o && o.label != null);
        // Drop options that merely contain a generic candidate but mean
        // something narrower ("Accelerated Masters" for a plain MA). Applied
        // unconditionally: if nothing survives, no option is the right one.
        if (reject) {
            const re = new RegExp(reject, 'i');
            flat = flat.filter(o => !re.test(String(o.label)));
        }
        for (const desired of candidates) {
            const t = norm(desired);
            if (!t) continue;
            let best = null, bestScore = 0;
            for (const o of flat) {
                const l = norm(String(o.label));
                if (!l) continue;
                let score = 0;
                if (l === t) score = 1000;
                else if (l.includes(t) || t.includes(l)) score = 500 + Math.min(l.length, t.length);
                else {
                    const cp = commonPrefixLen(l, t);
                    if (cp >= 5) score = cp;
                }
                if (score > bestScore) { best = o; bestScore = score; }
            }
            if (best) return best;
        }
        if (declineOk) {
            return flat.find(o => /decline|donotwish|dontwish|prefernot|donotwant/.test(norm(String(o.label)))) || null;
        }
        return null;
    }

    async function fillCombobox(item) {
        // NOTE: this selector must stay identical to the one greenhouse.js
        // enumerates, or item.index refers to a different element here.
        const input = (item.id && document.getElementById(item.id))
            || document.querySelectorAll('input[role="combobox"], input[aria-autocomplete="list"]')[item.index];
        if (!input) return { ok: false, reason: 'input not found', label: item.label };

        let api = findSelectApi(input);
        if (!api) return { ok: false, reason: 'no react-select api on element', label: item.label };

        // Skip if something is already selected (hasValue comes from react-select)
        if (api.hasValue && !item.overwrite) {
            return { ok: true, reason: 'already has value', label: item.label };
        }

        let opt = pickOption(api.options, item.values, item.declineOk, item.reject);

        // Async selects (e.g. School) load options only after typing:
        // drive the input's React onChange, wait, then re-read fresh props.
        if (!opt) {
            const propsKey = Object.keys(input).find(k => k.startsWith('__reactProps$'));
            if (propsKey && input[propsKey] && typeof input[propsKey].onChange === 'function') {
                const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
                setter.call(input, item.values[0]);
                try {
                    input[propsKey].onChange({ target: input, currentTarget: input, type: 'change' });
                } catch (e) { /* ignore */ }
                await new Promise(r => setTimeout(r, 1500));
                api = findSelectApi(input) || api;
                opt = pickOption(api.options, item.values, item.declineOk, item.reject);
                if (!opt && item.acceptFirst) {
                    opt = flatten(api.options)[0] || null;
                }
            }
        }

        if (opt) {
            api.selectOption(opt);
            await new Promise(r => setTimeout(r, 250));
            console.log(`Greenhouse Autofill: "${item.label}" -> "${opt.label}"`);
            return { ok: true, picked: String(opt.label), label: item.label };
        }
        return { ok: false, reason: 'no matching option', label: item.label, tried: item.values };
    }

    window.addEventListener('message', async (ev) => {
        if (ev.source !== window || !ev.data || ev.data.type !== 'GH_AUTOFILL_SELECT') return;
        const results = [];
        for (const item of ev.data.items || []) {
            try {
                results.push(await fillCombobox(item));
            } catch (e) {
                results.push({ ok: false, reason: String(e), label: item.label });
            }
        }
        window.postMessage({ type: 'GH_AUTOFILL_SELECT_RESULT', results }, '*');
    });
})();
