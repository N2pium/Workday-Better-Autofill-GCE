/*
 * Application tracker (plan/Features/F05 Application Tracker.md).
 *
 * After an autofill, the content script reports what the page says about the
 * job. When the user is signed in, the side panel logs it once per posting
 * (multi-page Workday forms autofill several times) and offers Undo.
 * Signed out or guest: nothing is logged and nothing is sent.
 */
(function (global) {
    'use strict';

    const TRACKED_KEY = 'cloudTracked'; // { [jobKey]: { id, at } } — a cloud* key: never exported
    const MAX_REMEMBERED = 500;
    const inFlight = new Set();

    const words = (s) => String(s || '').replace(/\s+/g, ' ').trim();
    const titleCase = (s) => s.replace(/\b([a-z])/g, (m) => m.toUpperCase());

    // "Asc-Cybersecurity-Gov-Risk-Analyst---Intern_R40863" -> "Asc Cybersecurity Gov Risk Analyst - Intern"
    function slugToTitle(slug) {
        return words(decodeURIComponent(slug)
            .replace(/_[A-Za-z]*-?\d[\w-]*$/, '') // trailing requisition id (_R40863, _JR-123)
            .replace(/-{3}/g, ' – ')
            .replace(/-{2}/g, ' ')
            .replace(/-/g, ' ')
            .replace(/\s+–\s*$/, ''));
    }

    // "dukeenergy" / "duke-energy" -> "Dukeenergy" / "Duke Energy"
    const slugToName = (slug) => titleCase(words(decodeURIComponent(slug).replace(/[-_]+/g, ' ')));

    const GENERIC_COMPANY = /^(logo|company logo|careers?|home|workday)$/i;

    function parseWorkday(u, info) {
        if (!/\.myworkdayjobs\.com$/i.test(u.hostname)) return null;
        const parts = u.pathname.split('/').filter(Boolean);
        const j = parts.indexOf('job');
        if (j < 0 || parts.length < j + 2) return null;
        // /<locale?>/<site>/job/<location?>/<slug>_<req>/apply/...
        const applyAt = parts.indexOf('apply', j);
        const end = applyAt > 0 ? applyAt : parts.length;
        const slug = parts[end - 1];
        const req = (slug.match(/_([A-Za-z]*-?\d[\w-]*)$/) || [])[1] || slug;
        const tenant = u.hostname.split('.')[0];
        const company = !GENERIC_COMPANY.test(words(info.company)) && words(info.company) ? words(info.company) : slugToName(tenant);
        return {
            key: `workday:${u.hostname.toLowerCase()}:${req.toLowerCase()}`,
            site: 'workday',
            company,
            role: words(info.title) || slugToTitle(slug),
            url: `${u.origin}/${parts.slice(0, end).join('/')}`
        };
    }

    function parseGreenhouse(u, info) {
        if (!/(^|\.)greenhouse\.io$/i.test(u.hostname)) return null;
        let company, id;
        const parts = u.pathname.split('/').filter(Boolean);
        const jobsAt = parts.indexOf('jobs');
        if (jobsAt > 0 && parts[jobsAt + 1]) {
            company = parts[jobsAt - 1];
            id = parts[jobsAt + 1];
        } else if (u.pathname.includes('/embed/job_app')) {
            company = u.searchParams.get('for');
            id = u.searchParams.get('token');
        }
        if (!company || !id) return null;
        return {
            key: `greenhouse:${company.toLowerCase()}:${id}`,
            site: 'greenhouse',
            company: words(info.company) || slugToName(company),
            role: words(info.title) || 'Job application',
            url: `https://${u.hostname}/${company}/jobs/${id}`
        };
    }

    // careers-acme.icims.com/jobs/1234/data-analyst/job?... -> Acme, Data Analyst, job 1234.
    // The API's site list has no 'icims' yet, so these are stored as 'other'.
    const ICIMS_HOST_PREFIX = /^(?:(?:us|uk|ca|global|external|internal|ext|int)?-?(?:careers|jobs|career|recruiting|apply)-)/i;
    function parseIcims(u, info) {
        if (!/(^|\.)icims\.com$/i.test(u.hostname)) return null;
        const parts = u.pathname.split('/').filter(Boolean);
        const j = parts.indexOf('jobs');
        const id = j >= 0 && /^\d+$/.test(parts[j + 1] || '') ? parts[j + 1] : null;
        if (!id) return null;
        const slug = parts[j + 2] && !/^(job|login|candidate|apply|search)$/i.test(parts[j + 2]) ? parts[j + 2] : '';
        const tenant = u.hostname.split('.')[0].replace(ICIMS_HOST_PREFIX, '');
        return {
            key: `icims:${u.hostname.toLowerCase()}:${id}`,
            site: 'other',
            company: words(info.company) || slugToName(tenant),
            role: words(info.title) || (slug ? slugToName(slug) : 'Job application'),
            url: `https://${u.hostname}/jobs/${id}/${slug ? `${slug}/` : ''}job`
        };
    }

    /** Raw page info -> { key, site, company, role, url } or null if it isn't a job we recognise. */
    function normalizeJob(info) {
        if (!info || !info.url) return null;
        let u;
        try { u = new URL(info.url); } catch (e) { return null; }
        if (u.protocol !== 'https:') return null;
        const job = parseWorkday(u, info) || parseGreenhouse(u, info) || parseIcims(u, info);
        if (!job) return null;
        job.company = job.company.slice(0, 200) || 'Unknown company';
        job.role = job.role.slice(0, 200) || 'Job application';
        return job;
    }

    async function remembered() {
        const { [TRACKED_KEY]: map } = await chrome.storage.local.get(TRACKED_KEY);
        return map || {};
    }

    async function remember(key, value) {
        const map = await remembered();
        if (value) map[key] = value; else delete map[key];
        const keys = Object.keys(map);
        if (keys.length > MAX_REMEMBERED) {
            keys.sort((a, b) => String(map[a].at).localeCompare(String(map[b].at)));
            for (const k of keys.slice(0, keys.length - MAX_REMEMBERED)) delete map[k];
        }
        await chrome.storage.local.set({ [TRACKED_KEY]: map });
    }

    /**
     * Log the application if signed in and not logged before.
     * Returns { result: 'tracked', job, application } | { result: 'duplicate' | 'signed-out' | 'unrecognised' }.
     */
    async function track(Cloud, info) {
        const job = normalizeJob(info);
        if (!job) return { result: 'unrecognised' };
        // Claimed synchronously: Greenhouse forms can finish in several frames at once.
        if (inFlight.has(job.key)) return { result: 'duplicate', job };
        inFlight.add(job.key);
        try {
            if (!(await Cloud.status()).signedIn) return { result: 'signed-out' };
            if ((await remembered())[job.key]) return { result: 'duplicate', job };

            const application = await Cloud.api('/applications', {
                method: 'POST',
                body: { company: job.company, role: job.role, url: job.url, site: job.site, status: 'applied' }
            });
            await remember(job.key, { id: application.id, at: new Date().toISOString() });
            return { result: 'tracked', job, application };
        } finally {
            inFlight.delete(job.key);
        }
    }

    /** Undo a just-logged application. */
    async function untrack(Cloud, job, application) {
        await Cloud.api(`/applications/${encodeURIComponent(application.id)}`, { method: 'DELETE' });
        await remember(job.key, null);
    }

    /** Delete from the Applications list; the posting can be logged again later. */
    async function remove(Cloud, id) {
        await Cloud.api(`/applications/${encodeURIComponent(id)}`, { method: 'DELETE' });
        const map = await remembered();
        for (const [k, v] of Object.entries(map)) if (v && v.id === id) delete map[k];
        await chrome.storage.local.set({ [TRACKED_KEY]: map });
    }

    const list = (Cloud, { limit = 50, cursor } = {}) => {
        const q = new URLSearchParams({ limit: String(limit) });
        if (cursor) q.set('cursor', cursor);
        return Cloud.api(`/applications?${q}`);
    };

    const update = (Cloud, id, fields) =>
        Cloud.api(`/applications/${encodeURIComponent(id)}`, { method: 'PATCH', body: fields });

    global.EasyApplyCloudTracker = Object.freeze({
        normalizeJob, track, untrack, remove, list, update,
        STATUSES: ['applied', 'screening', 'interview', 'offer', 'rejected', 'ghosted', 'withdrawn']
    });
})(self);
