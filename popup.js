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
        });

        workContainer.appendChild(clone);
    }

    // Event Listeners for Add Buttons
    addEduBtn.addEventListener('click', () => addEducationCard());
    addWorkBtn.addEventListener('click', () => addWorkCard());


    // Load saved data
    chrome.storage.local.get(['personalInfo', 'address', 'education', 'workExperience', 'skills', 'language', 'jobPreferences', 'resumeMeta'], (result) => {
        // Personal Info
        if (result.personalInfo) {
            document.getElementById('firstName').value = result.personalInfo.firstName || '';
            document.getElementById('lastName').value = result.personalInfo.lastName || '';
            document.getElementById('phone').value = result.personalInfo.phone || '';
            document.getElementById('email').value = result.personalInfo.email || '';
            document.getElementById('linkedinUrl').value = result.personalInfo.linkedinUrl || '';
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
                statusCtx.style.color = '#ef4444';
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
                statusCtx.style.color = '#ef4444';
            } else {
                statusCtx.textContent = 'Profile saved!';
                statusCtx.style.color = '#10b981';
                if (resumeFile) document.getElementById('resumeStatus').textContent = `Stored: ${resumeFile.name}`;
            }
            setTimeout(() => { statusCtx.textContent = ''; }, 3000);
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
        deleteBtn.addEventListener('click', () => {
            if (confirm("Are you sure you want to wipe all your data? This cannot be undone.")) {
                chrome.storage.local.clear(() => {
                    statusCtx.textContent = 'All data deleted.';
                    statusCtx.style.color = '#ef4444';

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
            chrome.tabs.sendMessage(activeTab.id, { action: 'fill_form' }, (response) => {
                if (chrome.runtime.lastError) {
                    console.log("Could not send message, maybe content script isn't loaded yet.");
                    statusCtx.textContent = "Error: Refresh page and try again.";
                    statusCtx.style.color = '#ef4444';
                } else {
                    console.log("Message sent", response);
                    statusCtx.textContent = "Autofill started...";
                    statusCtx.style.color = '#10b981';
                }
            });
        });
    });
});
