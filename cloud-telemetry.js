// Anonymous, opt-in fill-failure reports (plan/Features/F07, Phase 3 Contracts §2).
//
// Off by default. When Settings -> "Send anonymous fill-failure reports" is on,
// the side panel turns each fill report into the v1 payload below and POSTs it to
// {apiUrl}/telemetry WITHOUT any token, so a report can't be tied to an account.
//
// Scrubbed here, in the browser, before anything leaves the device:
//   - steps: only the extension's OWN step names (STEPS), failed/skipped only;
//     the free-text `detail` becomes a reason code; the text is never sent.
//     Self-identification steps are not in STEPS, so they are never reported.
//   - empty required fields: only the Workday formField id + a field kind.
//     Labels are never sent; GUID-like ids are dropped.
//   - tenant: host name only (never the path, query, job title or company).
// The cloud side (cloud/src/functions/telemetry/schema.ts) enforces the same
// allowlist and rejects anything else.
(function (root) {
    'use strict';

    const CFG = root.EASYAPPLY_CLOUD_CONFIG || {};

    // Keep identical to STEPS in cloud/src/functions/telemetry/schema.ts
    // (cloud/test/telemetry.test.ts checks). Names come from content.js
    // step('...') calls, grouped by their traceSection.
    const STEPS = Object.freeze({
        'My Information': ['First name', 'Last name', 'Phone', 'Phone device type', 'Email',
            'Address line 1', 'City', 'Postal code', 'Country', 'State'],
        'Social Network URLs': ['LinkedIn'],
        'Websites': ['Website', 'Websites section'],
        'Work Experience': ['Work experience'],
        'Education': ['Education'],
        'Skills': ['Skills'],
        'Languages': ['Language', 'Language proficiency'],
        'Resume': ['Resume file'],
        'Application Questions': ['How did you hear about us', 'U.S. citizen'],
        'Voluntary Disclosures': ['18 or older', 'Signature name'],
        'Terms': ['Terms checkbox']
    });

    // Matched against the step's free-text detail, in order. The first hit wins.
    const REASONS = [
        ['not_saved', /nothing is saved|not in your profile|no race is saved/i],
        ['no_add_button', /\bno add button\b|\badd did not open\b|add language button not found/i],
        ['did_not_change', /did not change|did not keep|did not commit|still shows|could not write|picked by mistake/i],
        ['no_option', /\bno (?:[\w-]+ ){0,2}options?\b|\bno "[^"]*" option|option .*not found|no options appeared|is not in the .* list|no suggestion/i],
        ['not_found', /not found|could not find|did not open/i]
    ];

    const KINDS = { text: 'text', picker: 'dropdown', dropdown: 'dropdown', checkbox: 'checkbox',
        radio: 'radio', date: 'date', file: 'file' };

    const WORKDAY_HOST = /^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.){1,3}myworkdayjobs\.com$/;
    const GREENHOUSE_HOST = /^(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io$/;
    const FIELD_ID = /^[A-Za-z][A-Za-z0-9_-]{0,59}$/;
    const GUID_LIKE = /[0-9a-f]{8}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{4}-?[0-9a-f]{12}|[0-9a-f]{20,}/i;
    const BUILD = /^\d{4}-\d{2}-\d{2}[a-z]{0,2}$/;
    const MAX_EVENTS = 50;
    const MAX_BYTES = 8 * 1024;

    const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

    function reasonFor(detail) {
        const text = typeof detail === 'string' ? detail : '';
        for (const [code, re] of REASONS) if (re.test(text)) return code;
        return 'other';
    }

    const kindFor = (kind) => (typeof kind === 'string' && has(KINDS, kind) ? KINDS[kind] : 'other');

    /** Host name only, from a URL or a bare host. null unless Workday or Greenhouse. */
    function tenantOf(value) {
        if (typeof value !== 'string' || !value) return null;
        let host = value.trim().toLowerCase();
        try { host = new URL(host.includes('://') ? host : `https://${host}`).hostname; } catch (e) { return null; }
        if (WORKDAY_HOST.test(host)) return { ats: 'workday', tenant: host };
        if (GREENHOUSE_HOST.test(host)) return { ats: 'greenhouse', tenant: host };
        return null;
    }

    /** The adapter pack version, if the report (stream A) or the caller names one. */
    function packOf(report, packVersion) {
        const p = packVersion !== undefined ? packVersion
            : report.pack && typeof report.pack === 'object' ? report.pack.version : report.pack;
        return Number.isInteger(p) && p >= 0 && p <= 1e6 ? p : undefined;
    }

    /**
     * Fill report (content.js buildFillReport) -> telemetry payload v1, or null
     * when there is nothing to send. Pure: no storage, no network.
     */
    function buildPayload(report, { tenant, packVersion } = {}) {
        if (!report || typeof report !== 'object') return null;
        const where = tenantOf(tenant);
        if (!where) return null;
        if (typeof report.build !== 'string' || !BUILD.test(report.build)) return null;

        const events = [];
        const seen = new Set();
        const add = (e) => {
            const key = JSON.stringify(e);
            if (seen.has(key) || events.length >= MAX_EVENTS) return;
            seen.add(key);
            events.push(e);
        };

        for (const s of Array.isArray(report.steps) ? report.steps : []) {
            if (!s || (s.status !== 'failed' && s.status !== 'skipped')) continue;
            if (typeof s.section !== 'string' || !has(STEPS, s.section)) continue;
            if (!STEPS[s.section].includes(s.field)) continue;
            add({ type: 'step', section: s.section, field: s.field, status: s.status, reason: reasonFor(s.detail) });
        }
        for (const e of Array.isArray(report.empty) ? report.empty : []) {
            if (!e || e.required !== true) continue;
            const id = typeof e.field === 'string' ? e.field : '';
            if (!FIELD_ID.test(id) || GUID_LIKE.test(id)) continue;
            add({ type: 'empty_required', fieldId: id, kind: kindFor(e.kind) });
        }
        if (!events.length) return null;

        const payload = { v: 1, ats: where.ats, tenant: where.tenant, build: report.build };
        const pack = packOf(report, packVersion);
        if (pack !== undefined) payload.pack = pack;
        payload.events = events;
        while (payload.events.length > 1 && JSON.stringify(payload).length > MAX_BYTES) payload.events.pop();
        return payload;
    }

    /**
     * POST the payload, unauthenticated. Never throws; resolves true on 2xx.
     * No Authorization header, no cookies, no referrer.
     */
    async function send(payload, { fetchImpl } = {}) {
        const f = fetchImpl || root.fetch;
        if (!payload || !CFG.apiUrl || typeof f !== 'function') return false;
        try {
            const res = await f.call(root, `${CFG.apiUrl}/telemetry`, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify(payload),
                credentials: 'omit',
                cache: 'no-store',
                referrerPolicy: 'no-referrer'
            });
            return !!(res && res.ok);
        } catch (e) {
            return false;
        }
    }

    // Only the API host is needed (not the sign-in domain). Request from a click.
    const ORIGINS = CFG.apiUrl ? [`${CFG.apiUrl}/*`] : [];
    const hasPermission = () => root.chrome.permissions.contains({ origins: ORIGINS });
    const requestPermission = () => root.chrome.permissions.request({ origins: ORIGINS });

    root.EasyApplyTelemetry = Object.freeze({
        STEPS, buildPayload, send, reasonFor, kindFor, tenantOf, hasPermission, requestPermission
    });
})(typeof self !== 'undefined' ? self : globalThis);
