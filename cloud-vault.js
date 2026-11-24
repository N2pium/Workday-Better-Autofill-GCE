/*
 * Resume Vault (plan/Features/F02 Resume Vault.md), side panel only.
 *
 * Opt-in, signed-in users: keep several resume versions in the account and pick
 * the one autofill attaches. Files go straight between this panel and S3 with
 * short-lived presigned URLs; the API never sees the bytes. "Use for autofill"
 * copies the chosen version into the same local keys autofill already reads
 * (resume, resumeMeta), so content.js needs no changes.
 */
(function (global) {
    'use strict';

    const ACTIVE_KEY = 'cloudVaultActive'; // a cloud* key: never exported
    // Same limit as the local resume field: chrome.storage.local has to hold the file.
    const MAX_BYTES = 3 * 1024 * 1024;
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

    function typeOf(file) {
        if (file.type === 'application/pdf' || file.type === DOCX) return file.type;
        const n = String(file.name || '').toLowerCase();
        return n.endsWith('.pdf') ? 'application/pdf' : n.endsWith('.docx') ? DOCX : '';
    }

    const list = (Cloud) => Cloud.api('/resumes').then((r) => r.items || []);

    /** Uploads a new version: create record -> POST to S3 -> confirm. */
    async function add(Cloud, file, name, fetchImpl = fetch) {
        const contentType = typeOf(file);
        if (!contentType) throw new Error('Choose a PDF or Word (.docx) file.');
        if (file.size > MAX_BYTES) throw new Error('That file is over 3 MB. Export a smaller PDF and try again.');

        const { resume, upload } = await Cloud.api('/resumes', {
            method: 'POST',
            body: { name: String(name || file.name).slice(0, 100), fileName: String(file.name).slice(0, 255), contentType, size: file.size }
        });
        const form = new FormData();
        for (const [k, v] of Object.entries(upload.fields)) form.append(k, v);
        form.append('file', file); // must be last for S3
        const res = await fetchImpl(upload.url, { method: 'POST', body: form });
        if (!res.ok) {
            await Cloud.api(`/resumes/${resume.id}`, { method: 'DELETE' }).catch(() => {});
            throw new Error(`Upload failed (${res.status}).`);
        }
        return Cloud.api(`/resumes/${resume.id}/confirm`, { method: 'POST', body: {} });
    }

    const toDataUrl = (blob) => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });

    /** Makes a version the resume autofill attaches. */
    async function use(Cloud, item, fetchImpl = fetch) {
        const { url, fileName, contentType } = await Cloud.api(`/resumes/${item.id}/download`);
        const res = await fetchImpl(url);
        if (!res.ok) throw new Error(`Download failed (${res.status}).`);
        const blob = await res.blob();
        const typed = blob.type === contentType ? blob : new Blob([blob], { type: contentType });
        await chrome.storage.local.set({
            resume: await toDataUrl(typed),
            resumeMeta: { name: fileName, type: contentType, lastModified: Date.now() },
            [ACTIVE_KEY]: { id: item.id, name: item.name }
        });
    }

    async function remove(Cloud, item) {
        await Cloud.api(`/resumes/${item.id}`, { method: 'DELETE' });
        const { [ACTIVE_KEY]: active } = await chrome.storage.local.get(ACTIVE_KEY);
        if (active && active.id === item.id) await chrome.storage.local.remove(ACTIVE_KEY); // the local copy stays
    }

    const active = () => chrome.storage.local.get(ACTIVE_KEY).then((r) => r[ACTIVE_KEY] || null);

    global.EasyApplyVault = Object.freeze({ list, add, use, remove, active, typeOf, MAX_BYTES });
})(self);
