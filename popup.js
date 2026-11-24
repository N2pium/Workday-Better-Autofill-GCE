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
        'gender', 'hispanicLatino', 'race', 'veteranStatus',
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


    // Fills the form from profile data: on load, and to show a parsed resume
    // for review before anything is saved.
    const PROFILE_KEYS = ['personalInfo', 'address', 'education', 'workExperience', 'skills', 'language', 'jobPreferences', 'demographics', 'resumeMeta'];
    function populateForm(result) {
        eduContainer.innerHTML = '';
        workContainer.innerHTML = '';
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
            document.getElementById('usCitizen').checked = result.jobPreferences.usCitizen || false;
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
            document.getElementById('veteranStatus').value = result.demographics.veteranStatus || '';
        }

        // Must run last: everything above decides what counts as blank.
        refreshBlankHints();
    }
    chrome.storage.local.get(PROFILE_KEYS, populateForm);

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
                usCitizen: document.getElementById('usCitizen').checked,
                formerEmployee: document.getElementById('formerEmployee').checked,
                authorizedToWork: document.getElementById('authorizedToWork').checked,
                requiresSponsorship: document.getElementById('requiresSponsorship').checked,
                sourceReferral: document.getElementById('sourceReferral').value,
                autoDisclosures: document.getElementById('autoDisclosures').checked
            },
            demographics: {
                gender: document.getElementById('gender').value,
                hispanicLatino: document.getElementById('hispanicLatino').value,
                race: document.getElementById('race').value,
                veteranStatus: document.getElementById('veteranStatus').value
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
                renderHomeProfile();
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
        renderChip();
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
        renderSignedInViews(s);
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

    async function afterSignIn() {
        const { personalInfo } = await chrome.storage.local.get('personalInfo');
        if (!personalInfo || !personalInfo.firstName) {
            showTab('profile');
            importUi.card.classList.add('highlight');
            flash('Signed in. Upload your resume to fill your profile in seconds.', 'var(--success)', 7000);
        } else {
            showTab('settings');
            cloudUi.section.classList.remove('collapsed');
            flash('Signed in. Turn on "Sync my profile" to back it up to your account.', 'var(--success)', 7000);
        }
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
        showTab('home');
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
            'Delete your cloud account and everything stored in it (synced profile, tracked applications, saved answers and resume versions)?\n\n' +
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

    // ---------------------------------------------------------------- tabs
    const Tracker = window.EasyApplyCloudTracker;
    const tabButtons = Array.from(document.querySelectorAll('.tabbar .tab'));
    const tabScroll = document.querySelector('.tab-scroll');
    let signedInNow = false; // kept current by renderCloud(); read inside click handlers

    function showTab(name) {
        for (const t of tabButtons) {
            const on = t.dataset.tab === name;
            t.classList.toggle('active', on);
            if (on) t.setAttribute('aria-current', 'page'); else t.removeAttribute('aria-current');
            document.getElementById(`tab-${t.dataset.tab}`).hidden = !on;
        }
        tabScroll.scrollTop = 0;
        try { sessionStorage.setItem('tab', name); } catch (e) { /* remembering the tab is optional */ } // survives the reload after a sync download
        if (name === 'home') renderHome();
        if (name === 'apps') renderApps();
        if (name === 'profile') { renderVault(); renderAnswers(); }
    }
    tabButtons.forEach((t) => t.addEventListener('click', () => showTab(t.dataset.tab)));
    document.addEventListener('click', (e) => {
        const go = e.target.closest('[data-goto]');
        if (go) showTab(go.dataset.goto);
    });

    // Builds DOM with textContent only: company and role come from web pages.
    const el = (tag, cls, text) => {
        const n = document.createElement(tag);
        if (cls) n.className = cls;
        if (text !== undefined) n.textContent = text;
        return n;
    };
    const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
    const shortDate = (iso) => (iso ? new Date(iso).toLocaleDateString([], { month: 'short', day: 'numeric' }) : '');
    const label = (s) => s.charAt(0).toUpperCase() + s.slice(1);

    // ---------------------------------------------------------------- home
    const homeUi = {
        jobCard: document.querySelector('.job-card'),
        site: document.getElementById('jobSite'),
        company: document.getElementById('jobCompany'),
        role: document.getElementById('jobRole'),
        name: document.getElementById('homeProfileName'),
        stats: document.getElementById('homeProfileStats'),
        list: document.getElementById('homeAppsList'),
        empty: document.getElementById('homeAppsEmpty')
    };

    async function renderJobCard() {
        const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
        // tab.url is only visible for sites the extension may access (Workday, opted-in Greenhouse).
        const job = tab && tab.url ? Tracker.normalizeJob({ url: tab.url }) : null;
        homeUi.jobCard.classList.toggle('inactive', !job);
        if (job) {
            homeUi.site.textContent = job.site === 'workday' ? 'Workday application' : 'Greenhouse application';
            homeUi.company.textContent = job.company;
            homeUi.role.textContent = job.role;
        } else {
            homeUi.site.textContent = 'This page';
            homeUi.company.textContent = 'Open a job application';
            homeUi.role.textContent = 'On Workday or Greenhouse, then press Autofill.';
        }
    }
    chrome.tabs.onActivated.addListener(() => renderJobCard());
    chrome.tabs.onUpdated.addListener((_id, info, tab) => {
        if (tab.active && (info.url || info.status === 'complete')) renderJobCard();
    });

    async function renderHomeProfile() {
        const d = await chrome.storage.local.get(['personalInfo', 'workExperience', 'education', 'skills']);
        const p = d.personalInfo || {};
        const name = [p.firstName, p.lastName].filter(Boolean).join(' ');
        const count = (v) => (Array.isArray(v) ? v.length : 0);
        homeUi.name.textContent = name || 'Not set up yet';
        homeUi.stats.textContent = name
            ? [p.email, [plural(count(d.workExperience), 'job'), plural(count(d.education), 'school'),
                plural(count(d.skills), 'skill')].join(' · ')].filter(Boolean).join(' — ')
            : 'Upload your resume or add your details once, and every application fills itself.';
    }

    async function renderHome() {
        renderJobCard();
        matchUi.card.hidden = !signedInNow;
        renderHomeProfile();
        if (!signedInNow) {
            homeUi.list.replaceChildren();
            homeUi.empty.hidden = false;
            homeUi.empty.textContent = 'Sign in and every job you autofill is listed here.';
            return;
        }
        try {
            const { items } = await Tracker.list(Cloud, { limit: 5 });
            homeUi.list.replaceChildren(...items.map((a) => appItem(a, { compact: true })));
            homeUi.empty.hidden = items.length > 0;
            homeUi.empty.textContent = 'No applications yet. Autofill a job and it shows up here.';
        } catch (e) {
            homeUi.empty.hidden = false;
            homeUi.empty.textContent = e.notSignedIn ? e.message : "Couldn't load your applications right now.";
        }
    }

    // ---------------------------------------------------------------- applications
    const appsUi = {
        list: document.getElementById('appsList'),
        empty: document.getElementById('appsEmpty'),
        more: document.getElementById('appsMore'),
        count: document.getElementById('appsCount'),
        signedOut: document.getElementById('appsSignedOut')
    };
    let appsCursor = null;
    let appsShown = 0;

    function showAppsCount() {
        appsUi.count.textContent = appsShown ? `${appsShown}${appsCursor ? '+' : ''}` : '';
        appsUi.empty.hidden = appsShown > 0 || !signedInNow;
    }

    function appItem(a, { compact = false } = {}) {
        const li = el('li', 'app-item');
        const main = el('div');
        main.append(el('div', 'app-company', a.company), el('div', 'app-role', a.role));
        const side = compact ? el('span', 'status-pill', a.status) : el('span', 'app-date', shortDate(a.appliedAt));
        if (compact) side.dataset.status = a.status;
        li.append(main, side);
        if (compact) return li;

        const actions = el('div', 'app-actions');
        const status = document.createElement('select');
        status.setAttribute('aria-label', `Status for ${a.company}`);
        for (const s of Tracker.STATUSES) status.append(Object.assign(el('option', '', label(s)), { value: s }));
        status.value = a.status;
        status.addEventListener('change', async () => {
            const before = a.status;
            try {
                await Tracker.update(Cloud, a.id, { status: status.value });
                a.status = status.value;
                flash(`${a.company}: ${label(a.status)}`, 'var(--success)');
            } catch (e) {
                status.value = before;
                flash(`Couldn't update the status: ${e.message}`, 'var(--danger)', 6000);
            }
        });
        const open = el('a', '', 'Open posting');
        if (/^https:\/\//.test(a.url)) Object.assign(open, { href: a.url, target: '_blank', rel: 'noopener noreferrer' });
        const remove = Object.assign(el('button', '', 'Remove'), { type: 'button' });
        remove.addEventListener('click', async () => {
            if (!confirm(`Remove ${a.company} (${a.role}) from your applications?`)) return;
            try {
                await Tracker.remove(Cloud, a.id);
                li.remove();
                appsShown -= 1;
                showAppsCount();
                flash('Removed.', 'var(--text-muted)');
            } catch (e) {
                flash(`Couldn't remove it: ${e.message}`, 'var(--danger)', 6000);
            }
        });
        actions.append(status, open, remove);
        li.append(actions);
        return li;
    }

    async function renderApps(append = false) {
        appsUi.signedOut.hidden = signedInNow;
        if (!signedInNow) {
            appsUi.list.replaceChildren();
            appsUi.more.hidden = true;
            appsShown = 0;
            appsCursor = null;
            showAppsCount();
            return;
        }
        if (!append) { appsCursor = null; appsShown = 0; appsUi.list.replaceChildren(); }
        try {
            const page = await Tracker.list(Cloud, { limit: 25, cursor: appsCursor || undefined });
            appsUi.list.append(...page.items.map((a) => appItem(a)));
            appsShown += page.items.length;
            appsCursor = page.cursor || null;
            appsUi.more.hidden = !appsCursor;
            showAppsCount();
        } catch (e) {
            flash(e.notSignedIn ? e.message : `Couldn't load applications: ${e.message}`, 'var(--danger)', 6000);
        }
    }
    appsUi.more.addEventListener('click', () => renderApps(true));

    // After an autofill: log the job (signed in only) and offer Undo.
    async function trackApplication(info) {
        try {
            const r = await Tracker.track(Cloud, info);
            if (r.result !== 'tracked') return;
            const text = `Tracked: ${r.job.company} · ${r.job.role}`;
            statusCtx.textContent = text;
            statusCtx.style.color = 'var(--success)';
            const undo = Object.assign(el('button', '', 'Undo'), { type: 'button' });
            undo.addEventListener('click', async () => {
                try {
                    await Tracker.untrack(Cloud, r.job, r.application);
                    flash('Not tracked.', 'var(--text-muted)');
                    refreshTrackedViews();
                } catch (e) {
                    flash(`Couldn't undo: ${e.message}`, 'var(--danger)', 6000);
                }
            });
            statusCtx.append(undo);
            setTimeout(() => { if (statusCtx.textContent.startsWith(text)) statusCtx.textContent = ''; }, 12000);
            refreshTrackedViews();
        } catch (e) {
            flash(`Couldn't track this application: ${e.message}`, 'var(--danger)', 6000);
        }
    }
    function refreshTrackedViews() {
        if (!document.getElementById('tab-home').hidden) renderHome();
        if (!document.getElementById('tab-apps').hidden) renderApps();
        if (!document.getElementById('tab-profile').hidden) { renderVault(); renderAnswers(); }
    }

    // ---------------------------------------------------------------- resume -> profile
    const importUi = {
        card: document.getElementById('resumeImport'),
        btn: document.getElementById('resumeImportBtn'),
        file: document.getElementById('resumeImportFile'),
        status: document.getElementById('resumeImportStatus')
    };
    const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
    const RESUME_TYPES = ['application/pdf', DOCX];

    function updateResumeImport() {
        importUi.btn.textContent = signedInNow ? 'Upload resume' : 'Sign in to fill from your resume';
    }

    importUi.btn.addEventListener('click', () => {
        if (!signedInNow) {
            showTab('settings');
            flash('Sign in first: reading a resume uses your account.', 'var(--primary)', 5000);
            return;
        }
        importUi.file.click(); // synchronous, so Chrome keeps the click's user activation
    });

    // Parsed values overwrite blanks and outdated fields; lists from the resume replace the old ones.
    // Job preferences and self-ID answers are never touched.
    function mergeDraft(current, draft) {
        const out = { ...current };
        for (const k of ['personalInfo', 'address', 'language']) {
            if (!draft[k]) continue;
            const base = { ...(current[k] || {}) };
            for (const [f, v] of Object.entries(draft[k])) if (v !== '' && v !== null && v !== undefined) base[f] = v;
            out[k] = base;
        }
        for (const k of ['education', 'workExperience']) {
            if (Array.isArray(draft[k]) && draft[k].length) out[k] = draft[k];
        }
        if (Array.isArray(draft.skills) && draft.skills.length) {
            const have = Array.isArray(current.skills)
                ? current.skills
                : String(current.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
            out.skills = [...new Set([...have, ...draft.skills])];
        }
        return out;
    }

    // Also offer the uploaded file as the resume autofill attaches (kept only if the user saves).
    function attachResumeFile(file) {
        try {
            const dt = new DataTransfer();
            dt.items.add(file);
            document.getElementById('resume').files = dt.files;
            document.getElementById('resumeStatus').textContent = `Will attach: ${file.name} (press Save to keep)`;
        } catch (e) { /* older Chrome: the user can pick it in the Resume section */ }
    }

    importUi.file.addEventListener('change', async () => {
        const file = importUi.file.files[0];
        importUi.file.value = '';
        if (!file) return;
        const lower = file.name.toLowerCase();
        const type = RESUME_TYPES.includes(file.type) ? file.type
            : lower.endsWith('.pdf') ? 'application/pdf' : lower.endsWith('.docx') ? DOCX : '';
        if (!type) { importUi.status.textContent = 'Choose a PDF or Word (.docx) file.'; return; }
        if (file.size > 3 * 1024 * 1024) { importUi.status.textContent = 'That file is over 3 MB. Export a smaller PDF and try again.'; return; }

        importUi.card.classList.add('busy');
        importUi.card.classList.remove('highlight');
        importUi.btn.disabled = true;
        importUi.status.textContent = 'Reading your resume… this takes about 10 seconds.';
        try {
            const data = (await toBase64(file)).split(',')[1];
            const { profile } = await Cloud.api('/resumes/parse', {
                method: 'POST',
                body: { fileName: file.name, contentType: type, data }
            });
            const current = await chrome.storage.local.get(PROFILE_KEYS);
            populateForm(mergeDraft(current, profile));
            attachResumeFile(file);
            const n = (v) => (Array.isArray(v) ? v.length : 0);
            importUi.status.textContent =
                `Found ${plural(n(profile.workExperience), 'job')}, ${plural(n(profile.education), 'school')} and ` +
                `${plural(n(profile.skills), 'skill')}. Check the details below, then press Save profile.`;
            flash('Profile filled from your resume. Review it, then Save.', 'var(--success)', 7000);
        } catch (e) {
            importUi.status.textContent = e.notSignedIn ? e.message : `Couldn't read that resume: ${e.message}`;
        } finally {
            importUi.card.classList.remove('busy');
            importUi.btn.disabled = false;
        }
    });

    // ---------------------------------------------------------------- phase 2: match score (F04)
    const Lib = window.EasyApplyLibrary;
    const Vault = window.EasyApplyVault;
    const matchUi = {
        card: document.getElementById('matchCard'),
        help: document.getElementById('matchHelp'),
        result: document.getElementById('matchResult'),
        score: document.getElementById('matchScore'),
        summary: document.getElementById('matchSummary'),
        strengths: document.getElementById('matchStrengths'),
        gaps: document.getElementById('matchGaps'),
        btn: document.getElementById('matchBtn')
    };
    const MATCH_HELP = matchUi.help.textContent;

    // What the AI may see: work, education, skills. Never contact details or self-ID.
    function profileForAi(d) {
        const arr = (v) => (Array.isArray(v) ? v : []);
        const skills = Array.isArray(d.skills) ? d.skills : String(d.skills || '').split(',').map((s) => s.trim()).filter(Boolean);
        return { workExperience: arr(d.workExperience).slice(0, 30), education: arr(d.education).slice(0, 20), skills: skills.slice(0, 200) };
    }

    function jobOnActiveTab() {
        return new Promise(async (resolve) => {
            const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
            if (!tab || !tab.id) return resolve(null);
            chrome.tabs.sendMessage(tab.id, { action: 'get_job_context' }, (res) => {
                void chrome.runtime.lastError; // no content script on this page
                resolve(res || null);
            });
        });
    }

    matchUi.btn.addEventListener('click', async () => {
        matchUi.btn.disabled = true;
        matchUi.help.textContent = 'Comparing your profile with this job…';
        try {
            const job = await jobOnActiveTab();
            if (!job || !job.description) {
                matchUi.result.hidden = true;
                matchUi.help.textContent = 'Open the job posting (the page with the full description) on Workday or Greenhouse, ' +
                    'then try again. It is remembered for that job\'s application pages.';
                return;
            }
            const d = await chrome.storage.local.get(['workExperience', 'education', 'skills']);
            const r = await Cloud.api('/ai/match', { method: 'POST', body: { job, profile: profileForAi(d) } });
            matchUi.score.textContent = String(r.score);
            matchUi.score.parentElement.className = `match-score ${r.score >= 70 ? 'good' : r.score < 40 ? 'weak' : ''}`;
            matchUi.summary.textContent = r.summary;
            matchUi.strengths.replaceChildren(...r.strengths.map((s) => el('li', '', s)));
            matchUi.gaps.replaceChildren(...(r.gaps.length ? r.gaps : ['None spotted']).map((s) => el('li', '', s)));
            matchUi.result.hidden = false;
            matchUi.help.textContent = [job.role, job.company].filter(Boolean).join(' · ') || MATCH_HELP;
        } catch (e) {
            matchUi.help.textContent = e.notSignedIn ? e.message : e.status === 429 ? e.message : `Couldn't score this job: ${e.message}`;
        } finally {
            matchUi.btn.disabled = false;
        }
    });

    // On-page Draft buttons (ai-assist.js) can be switched off; it watches this key.
    const aiToggle = document.getElementById('aiAssistToggle');
    chrome.storage.local.get('aiAssistOff').then((r) => { aiToggle.checked = !r.aiAssistOff; });
    aiToggle.addEventListener('change', () => chrome.storage.local.set({ aiAssistOff: !aiToggle.checked }));

    // ---------------------------------------------------------------- phase 2: resume versions (F02)
    const vaultUi = {
        card: document.getElementById('vaultCard'),
        list: document.getElementById('vaultList'),
        count: document.getElementById('vaultCount'),
        add: document.getElementById('vaultAddBtn'),
        file: document.getElementById('vaultFile'),
        status: document.getElementById('vaultStatus')
    };
    let vaultAllowed = false; // host access to the resume bucket, asked for on first use

    const kb = (n) => (n >= 1024 * 1024 ? `${(n / 1024 / 1024).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

    // chrome.permissions.request must be the first await inside the click.
    async function ensureVaultPermission() {
        if (vaultAllowed) return true;
        vaultAllowed = await Cloud.requestVaultPermission();
        if (!vaultAllowed) vaultUi.status.textContent = 'Chrome permission declined. Nothing was uploaded.';
        return vaultAllowed;
    }

    function vaultItem(item, active) {
        const li = el('li', 'app-item vault-item');
        const main = el('div');
        main.append(el('div', 'app-company', item.name), el('div', 'app-role', `${item.fileName} · ${kb(item.size || 0)} · ${shortDate(item.createdAt)}`));
        li.append(main, active ? el('span', 'vault-active', '● in use') : el('span'));

        const actions = el('div', 'app-actions');
        const use = Object.assign(el('button', '', 'Use for autofill'), { type: 'button' });
        use.addEventListener('click', async () => {
            if (!(await ensureVaultPermission())) return;
            use.disabled = true;
            vaultUi.status.textContent = `Loading ${item.name}…`;
            try {
                await Vault.use(Cloud, item);
                document.getElementById('resumeStatus').textContent = `Stored: ${item.fileName} (from "${item.name}")`;
                vaultUi.status.textContent = `Autofill now attaches "${item.name}".`;
                renderVault();
            } catch (e) {
                vaultUi.status.textContent = `Couldn't load it: ${e.message}`;
            } finally { use.disabled = false; }
        });
        const rename = Object.assign(el('button', '', 'Rename'), { type: 'button' });
        rename.addEventListener('click', async () => {
            const name = prompt('Name this resume version', item.name);
            if (!name || !name.trim() || name.trim() === item.name) return;
            try {
                await Cloud.api(`/resumes/${item.id}`, { method: 'PATCH', body: { name: name.trim().slice(0, 100) } });
                renderVault();
            } catch (e) { vaultUi.status.textContent = `Couldn't rename it: ${e.message}`; }
        });
        const remove = Object.assign(el('button', '', 'Delete'), { type: 'button' });
        remove.addEventListener('click', async () => {
            if (!confirm(`Delete "${item.name}" from your account? The copy autofill uses on this device stays until you replace it.`)) return;
            try {
                await Vault.remove(Cloud, item);
                vaultUi.status.textContent = 'Deleted.';
                renderVault();
            } catch (e) { vaultUi.status.textContent = `Couldn't delete it: ${e.message}`; }
        });
        actions.append(use, rename, remove);
        li.append(actions);
        return li;
    }

    async function renderVault() {
        vaultUi.card.hidden = !signedInNow;
        if (!signedInNow) return;
        try {
            vaultAllowed = await chrome.permissions.contains({ origins: [`https://${window.EASYAPPLY_CLOUD_CONFIG.resumeBucketHost}/*`] });
            const [items, active] = await Promise.all([Vault.list(Cloud), Vault.active()]);
            vaultUi.list.replaceChildren(...items.map((i) => vaultItem(i, active && active.id === i.id)));
            vaultUi.count.textContent = items.length ? `${items.length}/10` : '';
            vaultUi.add.disabled = items.length >= 10;
            if (!items.length && !vaultUi.status.textContent) vaultUi.status.textContent = 'No versions yet.';
        } catch (e) {
            vaultUi.status.textContent = e.notSignedIn ? e.message : `Couldn't load your resumes: ${e.message}`;
        }
    }

    vaultUi.add.addEventListener('click', async () => {
        if (vaultAllowed) { vaultUi.file.click(); return; } // synchronous: keeps the click's user activation
        if (await ensureVaultPermission()) vaultUi.status.textContent = 'Thanks. Now press "Add a resume version" again to pick the file.';
    });

    vaultUi.file.addEventListener('change', async () => {
        const file = vaultUi.file.files[0];
        vaultUi.file.value = '';
        if (!file) return;
        const suggested = file.name.replace(/\.(pdf|docx)$/i, '');
        const name = prompt('Name this version, e.g. "Data Analyst" or "Software Engineer"', suggested);
        if (name === null) return;
        vaultUi.add.disabled = true;
        vaultUi.status.textContent = `Uploading ${file.name}…`;
        try {
            await Vault.add(Cloud, file, name.trim() || suggested);
            vaultUi.status.textContent = `Saved "${name.trim() || suggested}". Press "Use for autofill" to attach it to applications.`;
        } catch (e) {
            vaultUi.status.textContent = e.notSignedIn ? e.message : `Couldn't save it: ${e.message}`;
        } finally {
            vaultUi.add.disabled = false;
            renderVault();
        }
    });

    // ---------------------------------------------------------------- phase 2: saved answers (F11)
    const answersUi = {
        card: document.getElementById('answersCard'),
        list: document.getElementById('answersList'),
        count: document.getElementById('answersCount'),
        help: document.getElementById('answersHelp')
    };

    function answerItem(a) {
        const li = el('li', 'app-item answer-item');
        const body = el('div');
        const head = el('p', 'kicker', `${Lib.LABELS[a.category] || a.category} · used ${a.uses || 0}×`);
        const text = el('p', 'answer-text', a.text.length > 300 ? `${a.text.slice(0, 300)}…` : a.text);
        body.append(head, el('div', 'answer-q', a.question), text);
        li.append(body);

        const actions = el('div', 'app-actions');
        const edit = Object.assign(el('button', '', 'Edit'), { type: 'button' });
        const del = Object.assign(el('button', '', 'Delete'), { type: 'button' });
        edit.addEventListener('click', () => {
            const box = Object.assign(document.createElement('textarea'), { value: a.text, maxLength: 5000 });
            box.setAttribute('aria-label', 'Saved answer text');
            const cat = document.createElement('select');
            cat.setAttribute('aria-label', 'Kind of question');
            for (const c of Lib.CATEGORIES) cat.append(Object.assign(el('option', '', Lib.LABELS[c]), { value: c }));
            cat.value = a.category;
            const save = Object.assign(el('button', '', 'Save'), { type: 'button' });
            const cancel = Object.assign(el('button', '', 'Cancel'), { type: 'button' });
            save.addEventListener('click', async () => {
                const value = box.value.trim();
                if (!value) return;
                try {
                    Object.assign(a, await Cloud.api(`/answers/${a.id}`, { method: 'PATCH', body: { text: value, category: cat.value } }));
                    li.replaceWith(answerItem(a));
                } catch (e) { flash(`Couldn't save it: ${e.message}`, 'var(--danger)', 6000); }
            });
            cancel.addEventListener('click', () => li.replaceWith(answerItem(a)));
            text.replaceWith(box);
            actions.replaceChildren(cat, save, cancel);
            box.focus();
        });
        del.addEventListener('click', async () => {
            if (!confirm('Delete this saved answer?')) return;
            try {
                await Cloud.api(`/answers/${a.id}`, { method: 'DELETE' });
                li.remove();
                answersUi.count.textContent = String(answersUi.list.children.length || '');
            } catch (e) { flash(`Couldn't delete it: ${e.message}`, 'var(--danger)', 6000); }
        });
        actions.append(edit, del);
        li.append(actions);
        return li;
    }

    async function renderAnswers() {
        answersUi.card.hidden = !signedInNow;
        if (!signedInNow) return;
        try {
            const { items } = await Cloud.api('/answers?limit=300');
            answersUi.list.replaceChildren(...items.map(answerItem));
            answersUi.count.textContent = items.length ? String(items.length) : '';
        } catch (e) {
            answersUi.list.replaceChildren(el('li', 'helper', e.notSignedIn ? e.message : `Couldn't load saved answers: ${e.message}`));
        }
    }

    // ---------------------------------------------------------------- top bar + start
    async function renderChip() {
        const chip = document.getElementById('syncChip');
        if (!signedInNow) { chip.hidden = true; return; }
        const s = await CloudSync.state();
        chip.hidden = false;
        chip.className = `chip ${s.enabled ? (s.pending ? 'warn' : 'ok') : ''}`;
        chip.textContent = s.enabled ? (s.pending ? '● Sync pending' : '● Synced') : 'Signed in';
    }

    // Called by renderCloud() whenever the account state may have changed.
    function renderSignedInViews(s) {
        signedInNow = s.signedIn;
        renderChip();
        updateResumeImport();
        refreshTrackedViews();
    }

    let lastTab = null;
    try { lastTab = sessionStorage.getItem('tab'); } catch (e) { /* optional */ }
    showTab(['home', 'profile', 'apps', 'settings'].includes(lastTab) ? lastTab : 'home');
    renderCloud();

    // ---------------------------------------------------------------- fill report
    const reportUi = {
        card: document.getElementById('fillReport'),
        summary: document.getElementById('fillReportSummary'),
        list: document.getElementById('fillReportList'),
        copy: document.getElementById('fillReportCopy')
    };
    let lastReport = null;

    function renderFillReport(r) {
        lastReport = r;
        const c = r.counts || {};
        reportUi.card.hidden = false;
        const parts = [`${c.filled || 0} filled`];
        if (c.failed) parts.push(`${c.failed} didn't work`);
        if (c.emptyRequired) parts.push(`${c.emptyRequired} required still empty`);
        reportUi.summary.textContent = `${r.page ? `${r.page}: ` : ''}${parts.join(' · ')}`;
        const items = [];
        for (const s of (r.steps || []).filter((x) => x.status === 'failed')) {
            const li = el('li');
            li.append(el('span', 'tag failed', 'failed'), document.createTextNode(`${s.section ? `${s.section} › ` : ''}${s.field}`));
            if (s.detail) li.append(el('span', 'why', s.detail));
            items.push(li);
        }
        for (const e of (r.empty || []).filter((x) => x.required)) {
            const li = el('li');
            li.append(el('span', 'tag empty', 'empty'), document.createTextNode(e.label || e.field));
            items.push(li);
        }
        reportUi.list.replaceChildren(...items.slice(0, 25));
    }

    reportUi.copy.addEventListener('click', async () => {
        if (!lastReport) return;
        try {
            await navigator.clipboard.writeText(JSON.stringify(lastReport, null, 2));
            flash('Fill report copied. Paste it to whoever is fixing autofill.', 'var(--success)');
        } catch (e) {
            flash(`Couldn't copy: ${e.message}`, 'var(--danger)');
        }
    });

    // Live status from content script (side panel stays open, so we can show this)
    chrome.runtime.onMessage.addListener((msg) => {
        if (msg.action === 'fill_complete') {
            if (msg.report) renderFillReport(msg.report);
            // Don't cover a "Tracked … Undo" message from an earlier page of the same form.
            if (!statusCtx.querySelector('button')) flash('Autofill complete ✓', 'var(--success)', 5000);
            if (msg.job) trackApplication(msg.job);
        }
    });

    // Collapsible sections — click a section title to collapse/expand it
    document.querySelectorAll('.tab-panel section h2').forEach(h2 => {
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
