document.addEventListener('DOMContentLoaded', () => {
    const form = document.getElementById('profileForm');
    const statusCtx = document.getElementById('status');
    const autofillBtn = document.getElementById('autofillBtn');

    const eduContainer = document.getElementById('education-container');
    const eduTemplate = document.getElementById('education-template');
    const addEduBtn = document.getElementById('addEduBtn');

    const workContainer = document.getElementById('work-container');
    const workTemplate = document.getElementById('work-template');
    const addWorkBtn = document.getElementById('addWorkBtn');

    // Helper: Add Education Card
    function addEducationCard(data = {}) {
        const clone = eduTemplate.content.cloneNode(true);
        const card = clone.querySelector('.card');

        // Fill data
        card.querySelector('.edu-school').value = data.school || '';
        card.querySelector('.edu-degree').value = data.degree || '';
        card.querySelector('.edu-field').value = data.fieldOfStudy || '';
        card.querySelector('.edu-gpa').value = data.gpa || '';
        if (data.startDate) {
            card.querySelector('.edu-start-month').value = data.startDate.month || '';
            card.querySelector('.edu-start-year').value = data.startDate.year || '';
        }
        if (data.endDate) {
            card.querySelector('.edu-end-month').value = data.endDate.month || '';
            card.querySelector('.edu-end-year').value = data.endDate.year || '';
        }

        // Remove Handler
        card.querySelector('.remove-btn').addEventListener('click', () => {
            card.remove();
            refreshBlankHints();
        });

        eduContainer.appendChild(clone);
    }

    // Helper: Add Work Card
    function addWorkCard(data = {}) {
        const clone = workTemplate.content.cloneNode(true);
        const card = clone.querySelector('.card');

        // Fill data
        card.querySelector('.work-company').value = data.company || '';
        card.querySelector('.work-title').value = data.title || data['job title'] || '';
        card.querySelector('.work-location').value = data.location || '';
        card.querySelector('.work-desc').value = data.description || data['role description'] || '';
        if (data.startDate) {
            card.querySelector('.work-start-month').value = data.startDate.month || '';
            card.querySelector('.work-start-year').value = data.startDate.year || '';
        }
        if (data.endDate) {
            card.querySelector('.work-end-month').value = data.endDate.month || '';
            card.querySelector('.work-end-year').value = data.endDate.year || '';
        }
        if (data.isCurrentRole) {
            card.querySelector('.work-current').checked = true;
        }

        // Remove Handler
        card.querySelector('.remove-btn').addEventListener('click', () => {
            card.remove();
            refreshBlankHints();
        });

        workContainer.appendChild(clone);
    }

    // Event Listeners for Add Buttons
    addEduBtn.addEventListener('click', () => { addEducationCard(); refreshBlankHints(); });
    addWorkBtn.addEventListener('click', () => { addWorkCard(); refreshBlankHints(); });

    // ---- Blank-field hints --------------------------------------------------
    //
    // An empty profile field is skipped in silence: nothing on the job page and
    // nothing in this panel says it happened, so a skipped field and a filled
    // one look the same (friction L5). That is not hypothetical — Country read
    // as correct for weeks because Workday's own default said "United States of
    // America" while the profile field behind it was empty.
    //
    // The rules this has to respect: state the fact, name nothing the user
    // cannot see, and never imply an error. So there is no warning colour, no
    // "incomplete" count, no blocking of save — just the field names, in the
    // same words the labels use, and a line saying blank is a valid choice.

    // Only fields autofill actually reads. Listing anything else would be noise.
    const TRACKED_IDS = [
        'firstName', 'lastName', 'phone', 'email', 'linkedinUrl', 'websiteUrl',
        'street', 'city', 'state', 'zip', 'country',
        'skills', 'languageInput',
        'gender', 'hispanicLatino', 'race',
        'sourceReferral'
    ];

    // Card fields are matched by class because the cards are cloned templates.
    const TRACKED_CARD_FIELDS = [
        '.edu-school', '.edu-degree', '.edu-field', '.edu-gpa',
        '.edu-start-month', '.edu-start-year', '.edu-end-month', '.edu-end-year',
        '.work-company', '.work-title', '.work-location', '.work-desc',
        '.work-start-month', '.work-start-year', '.work-end-month', '.work-end-year'
    ];

    const blankSummary = document.getElementById('blankSummary');

    // Skills is the one tracked field with no <label> of its own — its section
    // heading does the naming. Without this it would appear as "skills".
    const LABEL_OVERRIDES = { skills: 'Skills' };

    // The visible label, so the summary names what the user can actually see.
    function fieldLabel(control) {
        const group = control.closest('.input-group');
        const label = group && group.querySelector('label');
        let name = LABEL_OVERRIDES[control.id] || (label ? label.textContent.trim() : control.id);

        // Cards are unlabelled beyond "Education" / "Experience", so a second
        // card's School is indistinguishable from the first's without an index.
        const card = control.closest('.card');
        if (card && card.parentElement.children.length > 1) {
            const n = Array.prototype.indexOf.call(card.parentElement.children, card) + 1;
            name += ` (${card.classList.contains('edu-card') ? 'school' : 'job'} ${n})`;
        }
        return name;
    }

    function isBlank(control) {
        return !control.value || !control.value.trim();
    }

    function refreshBlankHints() {
        const blanks = [];
        let considered = 0;

        const consider = (control) => {
            if (!control) return;
            considered++;
            const group = control.closest('.input-group');
            const blank = isBlank(control);
            if (group) group.classList.toggle('is-blank', blank);
            if (blank) blanks.push(fieldLabel(control));
        };

        TRACKED_IDS.forEach(id => consider(document.getElementById(id)));

        document.querySelectorAll('.card').forEach(card => {
            // An end date left blank on a current role is correct, not missing.
            const current = card.querySelector('.work-current');
            TRACKED_CARD_FIELDS.forEach(sel => {
                const control = card.querySelector(sel);
                if (!control) return;
                if (current && current.checked && sel.startsWith('.work-end-')) {
                    const group = control.closest('.input-group');
                    if (group) group.classList.remove('is-blank');
                    return;
                }
                consider(control);
            });
        });

        // Sections that exist but hold nothing at all.
        considered += 3;
        if (!eduContainer.children.length) blanks.push('Education');
        if (!workContainer.children.length) blanks.push('Work Experience');

        // resumeStatus carries the stored filename; a freshly picked file is not
        // saved yet but will be, so either one counts as present.
        const resumeStored = document.getElementById('resumeStatus').textContent.trim();
        const resumePicked = document.getElementById('resume').files.length > 0;
        if (!resumeStored && !resumePicked) blanks.push('Resume');

        blankSummary.textContent = '';

        // An untouched profile is not a profile with gaps in it. On a fresh
        // install, or straight after Delete all data, every field is blank and
        // the user knows — listing all of them would be the nagging this is
        // explicitly meant to avoid.
        blankSummary.hidden = blanks.length === 0 || blanks.length === considered;
        if (blankSummary.hidden) return;

        // Long lists stop being readable and start reading as a scolding.
        const shown = blanks.slice(0, 6);
        const rest = blanks.length - shown.length;
        const list = shown.join(', ') + (rest ? `, and ${rest} more` : '');

        const lead = document.createElement('p');
        lead.className = 'blank-summary-lead';
        // Several labels are questions ("Hispanic or Latino?"), so a full stop
        // is only added when the sentence does not already end in punctuation.
        const sentence = `Autofill will leave these blank: ${list}`;
        lead.textContent = /[?.!]$/.test(sentence) ? sentence : `${sentence}.`;

        const note = document.createElement('p');
        note.className = 'blank-summary-note';
        note.textContent = 'That is fine if you meant to skip them — nothing here is required.';

        blankSummary.append(lead, note);
    }

    // Delegated, so cards added after load are covered without extra wiring.
    form.addEventListener('input', refreshBlankHints);
    form.addEventListener('change', refreshBlankHints);


    // Load saved data
    chrome.storage.local.get(['personalInfo', 'address', 'education', 'workExperience', 'skills', 'language', 'jobPreferences', 'demographics', 'resumeMeta'], (result) => {
        // Personal Info
        if (result.personalInfo) {
            document.getElementById('firstName').value = result.personalInfo.firstName || '';
            document.getElementById('lastName').value = result.personalInfo.lastName || '';
            document.getElementById('phone').value = result.personalInfo.phone || '';
            document.getElementById('email').value = result.personalInfo.email || '';
            document.getElementById('linkedinUrl').value = result.personalInfo.linkedinUrl || '';
            document.getElementById('websiteUrl').value = result.personalInfo.websiteUrl || '';
        }

        // Address
        if (result.address) {
            document.getElementById('street').value = result.address.street || '';
            document.getElementById('city').value = result.address.city || '';
            document.getElementById('state').value = result.address.state || '';
            document.getElementById('zip').value = result.address.zip || '';
            document.getElementById('country').value = result.address.country || '';
        }

        // Education
        if (result.education && Array.isArray(result.education)) {
            result.education.forEach(edu => addEducationCard(edu));
        } else if (result.education && typeof result.education === 'string') {
            // Fallback for old JSON string data
            try {
                const parsed = JSON.parse(result.education);
                (Array.isArray(parsed) ? parsed : [parsed]).forEach(edu => addEducationCard(edu));
            } catch (e) { }
        }

        // Work Experience
        if (result.workExperience && Array.isArray(result.workExperience)) {
            result.workExperience.forEach(work => addWorkCard(work));
        } else if (result.workExperience && typeof result.workExperience === 'string') {
            try {
                const parsed = JSON.parse(result.workExperience);
                (Array.isArray(parsed) ? parsed : [parsed]).forEach(work => addWorkCard(work));
            } catch (e) { }
        }

        // Skills
        if (result.skills) {
            document.getElementById('skills').value = Array.isArray(result.skills) ? result.skills.join(', ') : result.skills;
        }

        // Language
        if (result.language) {
            document.getElementById('languageInput').value = result.language.name || '';
            document.getElementById('nativeSpeaker').checked = result.language.isNative || false;
        }

        // Job Preferences
        if (result.jobPreferences) {
            // Defaults to false, unlike authorizedToWork below. Nobody's age
            // should be asserted on their behalf by a default.
            document.getElementById('isAtLeast18').checked = result.jobPreferences.isAtLeast18 || false;
            document.getElementById('formerEmployee').checked = result.jobPreferences.formerEmployee || false;
            document.getElementById('authorizedToWork').checked = result.jobPreferences.authorizedToWork !== false; // Default true
            document.getElementById('requiresSponsorship').checked = result.jobPreferences.requiresSponsorship || false;
            document.getElementById('sourceReferral').value = result.jobPreferences.sourceReferral || '';
            document.getElementById('autoDisclosures').checked = result.jobPreferences.autoDisclosures || false;
        }

        // Resume Status
        if (result.resumeMeta) {
            document.getElementById('resumeStatus').textContent = `Stored: ${result.resumeMeta.name}`;
        }

        // Demographics
        if (result.demographics) {
            document.getElementById('gender').value = result.demographics.gender || '';
            document.getElementById('hispanicLatino').value = result.demographics.hispanicLatino || '';
            document.getElementById('race').value = result.demographics.race || '';
        }

        // Must run last: everything above decides what counts as blank.
        refreshBlankHints();
    });

    // Save data
    form.addEventListener('submit', async (e) => {
        e.preventDefault();
        statusCtx.textContent = 'Saving...';

        // Gather Education
        const eduCards = document.querySelectorAll('.edu-card');
        const education = Array.from(eduCards).map(card => ({
            school: card.querySelector('.edu-school').value,
            degree: card.querySelector('.edu-degree').value,
            fieldOfStudy: card.querySelector('.edu-field').value,
            gpa: card.querySelector('.edu-gpa').value,
            startDate: {
                month: card.querySelector('.edu-start-month').value,
                year: card.querySelector('.edu-start-year').value
            },
            endDate: {
                month: card.querySelector('.edu-end-month').value,
                year: card.querySelector('.edu-end-year').value
            }
        })).filter(e => e.school || e.degree); // Basic filter empty

        // Gather Work
        const workCards = document.querySelectorAll('.work-card');
        const workExperience = Array.from(workCards).map(card => ({
            company: card.querySelector('.work-company').value,
            title: card.querySelector('.work-title').value,
            location: card.querySelector('.work-location').value,
            description: card.querySelector('.work-desc').value,
            startDate: {
                month: card.querySelector('.work-start-month').value,
                year: card.querySelector('.work-start-year').value
            },
            endDate: {
                month: card.querySelector('.work-end-month').value,
                year: card.querySelector('.work-end-year').value
            },
            isCurrentRole: card.querySelector('.work-current').checked
        })).filter(w => w.company || w.title);

        // Prepare Base Data
        const data = {
            personalInfo: {
                firstName: document.getElementById('firstName').value,
                lastName: document.getElementById('lastName').value,
                phone: document.getElementById('phone').value,
                email: document.getElementById('email').value,
                linkedinUrl: document.getElementById('linkedinUrl').value,
                websiteUrl: document.getElementById('websiteUrl').value,
            },
            address: {
                street: document.getElementById('street').value,
                city: document.getElementById('city').value,
                state: document.getElementById('state').value,
                zip: document.getElementById('zip').value,
                country: document.getElementById('country').value,
            },
            education: education,
            workExperience: workExperience,
            skills: document.getElementById('skills').value.split(',').map(s => s.trim()).filter(s => s),
            language: {
                name: document.getElementById('languageInput').value,
                isNative: document.getElementById('nativeSpeaker').checked
            },
            jobPreferences: {
                isAtLeast18: document.getElementById('isAtLeast18').checked,
                formerEmployee: document.getElementById('formerEmployee').checked,
                authorizedToWork: document.getElementById('authorizedToWork').checked,
                requiresSponsorship: document.getElementById('requiresSponsorship').checked,
                sourceReferral: document.getElementById('sourceReferral').value,
                autoDisclosures: document.getElementById('autoDisclosures').checked
            },
            demographics: {
                gender: document.getElementById('gender').value,
                hispanicLatino: document.getElementById('hispanicLatino').value,
                race: document.getElementById('race').value
            }
        };

        // Handle Resume Upload (Async)
        const resumeFile = document.getElementById('resume').files[0];
        if (resumeFile) {
            if (resumeFile.size > 3 * 1024 * 1024) { // 3MB limit
                statusCtx.textContent = 'Error: Resume too large (Max 3MB)';
                statusCtx.style.color = 'var(--danger)';
                return;
            }

            try {
                const base64 = await toBase64(resumeFile);
                data.resume = base64;
                data.resumeMeta = {
                    name: resumeFile.name,
                    type: resumeFile.type,
                    lastModified: resumeFile.lastModified
                };
            } catch (err) {
                console.error(err);
                statusCtx.textContent = 'Error reading resume file';
                return;
            }
        }

        // Save to Storage
        chrome.storage.local.set(data, () => {
            if (chrome.runtime.lastError) {
                statusCtx.textContent = 'Error saving (Quota exceeded?)';
                statusCtx.style.color = 'var(--danger)';
            } else {
                statusCtx.textContent = 'Profile saved!';
                statusCtx.style.color = 'var(--success)';
                if (resumeFile) document.getElementById('resumeStatus').textContent = `Stored: ${resumeFile.name}`;
                refreshBlankHints();
                syncAfterSave(); // no-op unless the user turned sync on
            }
            const shown = statusCtx.textContent;
            setTimeout(() => { if (statusCtx.textContent === shown) statusCtx.textContent = ''; }, 3000);
        });
    });

    const toBase64 = file => new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.readAsDataURL(file);
        reader.onload = () => resolve(reader.result);
        reader.onerror = error => reject(error);
    });

    // Delete Data
    const deleteBtn = document.getElementById('deleteBtn');
    if (deleteBtn) {
        deleteBtn.addEventListener('click', async () => {
            const cloud = await Cloud.status();
            const question = cloud.signedIn
                ? 'Wipe all data on this device and sign out? This cannot be undone.\n\n' +
                  'Your cloud account is NOT deleted — use "Delete cloud account" for that.'
                : 'Are you sure you want to wipe all your data? This cannot be undone.';
            if (confirm(question)) {
                // Sign out first so the refresh token is revoked, not just forgotten.
                if (cloud.signedIn) await Cloud.signOut().catch(() => {});
                chrome.storage.local.clear(() => {
                    renderCloud();
                    statusCtx.textContent = 'All data deleted.';
                    statusCtx.style.color = 'var(--danger)';

                    // Reset forms
                    document.getElementById('profileForm').reset();
                    eduContainer.innerHTML = '';
                    workContainer.innerHTML = '';
                    document.getElementById('resumeStatus').textContent = '';
                    document.getElementById('languageInput').value = '';
                    document.getElementById('nativeSpeaker').checked = false;
                    document.getElementById('formerEmployee').checked = false;
                    document.getElementById('authorizedToWork').checked = true;
                    document.getElementById('requiresSponsorship').checked = false;
                    document.getElementById('sourceReferral').value = '';
                    document.getElementById('autoDisclosures').checked = false;
                    refreshBlankHints();

                    setTimeout(() => { statusCtx.textContent = ''; }, 3000);
                });
            }
        });
    }

    // Autofill Trigger
    autofillBtn.addEventListener('click', () => {
        chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
            if (tabs.length === 0) return;

            const activeTab = tabs[0];
            // Known portal hosts. We still attempt the message on unknown URLs
            // because Greenhouse forms are often embedded in an iframe on a
            // company's own careers page — the content script lives in the iframe.
            const SUPPORTED_HOSTS = ['myworkdayjobs.com', 'boards.greenhouse.io', 'job-boards.greenhouse.io'];
            const looksSupported = activeTab.url && SUPPORTED_HOSTS.some(h => activeTab.url.includes(h));

            chrome.tabs.sendMessage(activeTab.id, { action: 'fill_form' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("Could not send message, maybe content script isn't loaded yet.");
                    statusCtx.textContent = looksSupported
                        ? 'Error: Refresh the page and try again.'
                        : 'Not a supported job page (Workday / Greenhouse).';
                    statusCtx.style.color = 'var(--danger)';
                } else {
                    console.log("Message sent", response);
                    statusCtx.textContent = "Autofill running...";
                    statusCtx.style.color = 'var(--success)';
                }
            });
        });
    });

    // Supported Portals: Greenhouse opt-in via optional host permissions.
    // The permission request MUST come from a user gesture (this click).
    // background.js watches permissions.onAdded/onRemoved and registers or
    // unregisters the Greenhouse content script accordingly.
    const GH_ORIGINS = ['*://boards.greenhouse.io/*', '*://job-boards.greenhouse.io/*'];
    const ghToggle = document.getElementById('greenhouseToggle');

    chrome.permissions.contains({ origins: GH_ORIGINS }, (granted) => {
        ghToggle.checked = !!granted;
    });

    ghToggle.addEventListener('change', () => {
        if (ghToggle.checked) {
            chrome.permissions.request({ origins: GH_ORIGINS }, (granted) => {
                ghToggle.checked = !!granted;
                statusCtx.textContent = granted
                    ? 'Greenhouse support enabled.'
                    : 'Permission declined — Greenhouse stays off.';
                statusCtx.style.color = granted ? 'var(--success)' : 'var(--primary)';
                setTimeout(() => { statusCtx.textContent = ''; }, 4000);
            });
        } else {
            chrome.permissions.remove({ origins: GH_ORIGINS }, (removed) => {
                ghToggle.checked = !removed;
                if (removed) {
                    statusCtx.textContent = 'Greenhouse support disabled.';
                    statusCtx.style.color = 'var(--text-muted)';
                    setTimeout(() => { statusCtx.textContent = ''; }, 3000);
                }
            });
        }
    });

    // Cloud Account (optional). Signed out = today's local-only behaviour.
    // Host access to the API and sign-in domains is an optional permission,
    // requested in the Sign in click (it must come from a user gesture), the
    // same way Greenhouse support works. See cloud-auth.js.
    const Cloud = window.EasyApplyCloud;
    const CloudSync = window.EasyApplyCloudSync;
    const cloudUi = {
        section: document.getElementById('cloudSection'),
        signedOut: document.getElementById('cloudSignedOut'),
        signedIn: document.getElementById('cloudSignedIn'),
        email: document.getElementById('cloudEmail'),
        connection: document.getElementById('cloudConnection'),
        syncToggle: document.getElementById('cloudSyncToggle'),
        signInBtn: document.getElementById('cloudSignInBtn'),
        signOutBtn: document.getElementById('cloudSignOutBtn'),
        deleteBtn: document.getElementById('cloudDeleteBtn')
    };
    const welcomeUi = {
        root: document.getElementById('welcome'),
        signInBtn: document.getElementById('welcomeSignInBtn'),
        signUpBtn: document.getElementById('welcomeSignUpBtn'),
        guestBtn: document.getElementById('welcomeGuestBtn'),
        status: document.getElementById('welcomeStatus')
    };

    function flash(text, color, ms = 4000) {
        statusCtx.textContent = text;
        statusCtx.style.color = color;
        setTimeout(() => { if (statusCtx.textContent === text) statusCtx.textContent = ''; }, ms);
    }

    // When both this device and the account hold a profile, the user picks one.
    const syncAsk = {
        chooseCopy({ remoteUpdatedAt, conflict }) {
            const when = remoteUpdatedAt ? new Date(remoteUpdatedAt).toLocaleString() : 'earlier';
            const intro = conflict
                ? `Your profile was changed on another device (${when}) since this device last synced.`
                : `Your account already has a synced profile (last updated ${when}).`;
            if (confirm(`${intro}\n\nOK: use the synced profile here (replaces the profile on this device).\nCancel: more options.`)) {
                return 'cloud';
            }
            if (confirm('Upload the profile on this device instead, replacing the synced one?\n\nOK: upload this device\'s profile.\nCancel: decide later.')) {
                return 'device';
            }
            return null;
        }
    };

    const when = (iso) => (iso ? new Date(iso).toLocaleString([], { dateStyle: 'medium', timeStyle: 'short' }) : '');

    async function showSyncStatus() {
        const s = await CloudSync.state();
        cloudUi.syncToggle.checked = s.enabled;
        cloudUi.connection.textContent = !s.enabled
            ? 'Connected · sync is off'
            : s.pending
                ? 'Connected · changes waiting to sync'
                : `Connected · synced ${when(s.lastSyncedAt)}`;
    }

    // On open: pull a newer synced profile, or push changes that couldn't sync earlier.
    async function refreshCloud() {
        cloudUi.connection.textContent = 'Checking connection…';
        try {
            const result = await CloudSync.onOpen(Cloud, syncAsk);
            if (result === 'downloaded') { location.reload(); return; } // show the synced profile
            if (result === 'off') await Cloud.api('/profiles'); // still confirm the connection works
            await showSyncStatus();
        } catch (e) {
            if (e.notSignedIn) {
                await renderCloud();
                flash(e.message, 'var(--primary)');
            } else {
                cloudUi.connection.textContent = `Can't reach the cloud right now (${e.message})`;
            }
        }
    }

    async function renderCloud() {
        const s = await Cloud.status();
        const { cloudChoice } = await chrome.storage.local.get('cloudChoice');
        const showWelcome = !s.signedIn && cloudChoice !== 'guest';
        welcomeUi.root.hidden = !showWelcome;
        document.body.classList.toggle('show-welcome', showWelcome);

        cloudUi.signedOut.hidden = s.signedIn;
        cloudUi.signedIn.hidden = !s.signedIn;
        if (s.signedIn) {
            cloudUi.email.textContent = s.email || 'your account';
            refreshCloud();
        }
    }

    // Shared by the welcome screen and the Cloud Account section.
    async function startSignIn(button, { signUp = false } = {}) {
        button.disabled = true;
        try {
            // Called first, inside the click, so Chrome treats it as a user gesture.
            const granted = await Cloud.requestPermission();
            if (!granted) return { ok: false, message: 'Chrome permission declined. Nothing was sent.' };
            await Cloud.signIn({ signUp });
            await renderCloud();
            return { ok: true };
        } catch (e) {
            return { ok: false, message: e.message };
        } finally {
            button.disabled = false;
        }
    }

    function afterSignIn() {
        cloudUi.section.classList.remove('collapsed');
        cloudUi.section.scrollIntoView({ block: 'start' });
        flash('Signed in. Turn on "Sync my profile" to back it up to your account.', 'var(--success)', 6000);
    }

    for (const [button, signUp] of [[welcomeUi.signInBtn, false], [welcomeUi.signUpBtn, true]]) {
        button.addEventListener('click', async () => {
            welcomeUi.status.textContent = '';
            const result = await startSignIn(button, { signUp });
            if (result.ok) afterSignIn();
            else welcomeUi.status.textContent = result.message;
        });
    }

    welcomeUi.guestBtn.addEventListener('click', async () => {
        await chrome.storage.local.set({ cloudChoice: 'guest' });
        await renderCloud();
    });

    cloudUi.signInBtn.addEventListener('click', async () => {
        const result = await startSignIn(cloudUi.signInBtn);
        if (result.ok) afterSignIn();
        else flash(result.message, 'var(--danger)', 6000);
    });

    cloudUi.syncToggle.addEventListener('change', async () => {
        const toggle = cloudUi.syncToggle;
        toggle.disabled = true;
        try {
            if (toggle.checked) {
                const result = await CloudSync.enable(Cloud, syncAsk);
                if (result === 'downloaded') { location.reload(); return; }
                if (result === 'cancelled') flash('Sync stays off.', 'var(--text-muted)');
                else flash('Sync on. Your profile is backed up to your account.', 'var(--success)');
            } else {
                await CloudSync.disable();
                flash('Sync off on this device. Your synced copy stays in your account.', 'var(--text-muted)', 5000);
            }
        } catch (e) {
            flash(`Sync failed: ${e.message}`, 'var(--danger)', 6000);
        } finally {
            toggle.disabled = false;
            await showSyncStatus();
        }
    });

    // Called by the Save handler after the profile is stored on this device.
    async function syncAfterSave() {
        try {
            const result = await CloudSync.afterLocalSave(Cloud, syncAsk);
            if (result === 'off') return;
            if (result === 'downloaded') { location.reload(); return; }
            if (result === 'uploaded') flash('Profile saved and synced ✓', 'var(--success)');
            else if (result === 'pending') flash('Saved on this device. It will sync next time you open the panel online.', 'var(--primary)', 6000);
            else if (result === 'cancelled') flash('Saved on this device only for now. You will be asked again next time.', 'var(--primary)', 6000);
            await showSyncStatus();
        } catch (e) {
            if (e.notSignedIn) await renderCloud();
            flash(e.notSignedIn ? e.message : `Saved on this device, but sync failed: ${e.message}`, 'var(--danger)', 7000);
        }
    }

    cloudUi.signOutBtn.addEventListener('click', async () => {
        cloudUi.signOutBtn.disabled = true;
        await Cloud.signOut();
        cloudUi.signOutBtn.disabled = false;
        await renderCloud();
        welcomeUi.status.textContent = 'Signed out. Your profile on this device is unchanged.';
        flash('Signed out. Your data on this device is unchanged.', 'var(--text-muted)');
    });

    cloudUi.deleteBtn.addEventListener('click', async () => {
        const ok = confirm(
            'Delete your cloud account and everything stored in it (synced profiles and tracked applications)?\n\n' +
            'Your data on this device is not affected. This cannot be undone.'
        );
        if (!ok) return;
        cloudUi.deleteBtn.disabled = true;
        try {
            await Cloud.deleteAccount();
            await renderCloud();
            welcomeUi.status.textContent = 'Cloud account deleted. Your profile on this device is unchanged.';
            flash('Cloud account deleted.', 'var(--danger)', 5000);
        } catch (e) {
            flash(`Could not delete the account: ${e.message}`, 'var(--danger)', 6000);
        } finally {
            cloudUi.deleteBtn.disabled = false;
        }
    });

    renderCloud();

    // Live status from content script (side panel stays open, so we can show this)
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'fill_complete') {
            statusCtx.textContent = 'Autofill complete ✓';
            statusCtx.style.color = 'var(--success)';
            setTimeout(() => { statusCtx.textContent = ''; }, 5000);
        }
    });

    // Collapsible sections — click a section title to collapse/expand it
    document.querySelectorAll('form section h2').forEach(h2 => {
        h2.addEventListener('click', () => {
            h2.parentElement.classList.toggle('collapsed');
        });
    });

    // Export Profile (full backup, including resume)
    document.getElementById('exportBtn').addEventListener('click', () => {
        chrome.storage.local.get(null, (data) => {
            // Never write sign-in credentials into a backup file.
            for (const key of Object.keys(data)) if (Cloud.isCloudKey(key)) delete data[key];
            const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
            const url = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = url;
            a.download = `workday-autofill-profile-${new Date().toISOString().slice(0, 10)}.json`;
            a.click();
            URL.revokeObjectURL(url);
            statusCtx.textContent = 'Profile exported.';
            statusCtx.style.color = 'var(--success)';
            setTimeout(() => { statusCtx.textContent = ''; }, 3000);
        });
    });

    // Import Profile
    const importFile = document.getElementById('importFile');
    document.getElementById('importBtn').addEventListener('click', () => importFile.click());
    importFile.addEventListener('change', () => {
        const file = importFile.files[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = () => {
            try {
                const data = JSON.parse(reader.result);
                if (!data || typeof data !== 'object' || Array.isArray(data)) {
                    throw new Error('Invalid profile format');
                }
                // A backup file must not be able to plant a sign-in session.
                for (const key of Object.keys(data)) if (Cloud.isCloudKey(key)) delete data[key];
                chrome.storage.local.set(data, () => {
                    if (chrome.runtime.lastError) {
                        statusCtx.textContent = 'Error importing (file too large?)';
                        statusCtx.style.color = 'var(--danger)';
                    } else {
                        // Reload panel so the form reflects imported data; sync it next time.
                        CloudSync.markPending().finally(() => location.reload());
                    }
                });
            } catch (err) {
                statusCtx.textContent = 'Error: Not a valid profile file.';
                statusCtx.style.color = 'var(--danger)';
                setTimeout(() => { statusCtx.textContent = ''; }, 4000);
            }
        };
        reader.readAsText(file);
        importFile.value = ''; // Allow re-importing the same file
    });
});
