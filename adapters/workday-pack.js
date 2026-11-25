// Workday adapter pack: the Workday-specific tunables content.js fills with.
//
// PURE DATA (Chrome Web Store MV3 bans remotely hosted code): strings, arrays,
// and regexes as { source, flags } that content.js compiles. No functions, no
// URLs. This file is the bundled copy (loaded before content.js) AND the source
// that `node tools/build-adapter-pack.mjs` signs into adapters/dist/workday.json
// for the remote copy. Bump `version` on every change, then rebuild.
//
// A remote pack replaces this one only if it is signed, has a higher version,
// and its minExtension is <= the installed extension's version. Any single key
// that is missing or malformed in a remote pack falls back to the value here.
//
// See plan/Phase 3 Contracts.md section 1.
self.EASYAPPLY_ADAPTER_BUNDLED = {
    schema: 1,
    ats: 'workday',
    version: 1,
    minExtension: '2.0.1',
    data: {
        // "Work Experience 1", "Education 2": one heading per repeated panel.
        workPanelHeading: { source: '^\\s*work experience\\s*\\d+\\s*$', flags: 'i' },
        educationPanelHeading: { source: '^\\s*education\\s*\\d+\\s*$', flags: 'i' },
        // The section headings themselves (no number).
        workSectionHeading: { source: '^\\s*work experience\\s*$', flags: 'i' },
        educationSectionHeading: { source: '^\\s*education\\s*$', flags: 'i' },
        // Every My Experience section heading: a search for one section's Add
        // button stops at the edge of its section.
        sectionTitle: { source: '^\\s*(work experience|education|websites?|social network urls?|languages?|skills|certifications?|resume\\/?cv|links)\\s*$', flags: 'i' },
        // The label that tells a single-entry (unnumbered) form has the section.
        workFieldLabel: { source: '^\\s*(company|employer)\\b', flags: 'i' },
        educationFieldLabel: { source: '^\\s*(school|university|institution)\\b', flags: 'i' },
        // Employer-written questions sit in formField-<32 hex GUID>.
        guidField: { source: '^formField-[0-9a-f]{32}$', flags: 'i' },

        // Add buttons: data-automation-id values, then the visible text.
        addButtonIds: ['add-button', 'Add'],
        addButtonText: { source: '^\\s*add( another)?\\s*$', flags: 'i' },
        addWorkAriaLabels: ['Add Work Experience', 'Add Another Work Experience'],
        addEducationAriaLabels: ['Add Education'],
        // The delete button of one repeated panel.
        panelDeleteButtonIds: ['panel-set-delete-button'],
        panelDeleteText: { source: '^\\s*delete\\b', flags: 'i' },

        // Each half of a Workday date is its own input.
        dateSectionSelectors: {
            Month: 'input[data-automation-id="dateSectionMonth-input"], input[aria-label*="Month" i], input[placeholder="MM"], input[placeholder="mm"]',
            Year: 'input[data-automation-id="dateSectionYear-input"], input[aria-label*="Year" i], input[placeholder="YYYY"], input[placeholder="yyyy"]'
        },
        // The disclosure date picker's "Today" button.
        datePickerTodayId: 'datePickerSelectedToday',

        // Workday's own formField-<id> for self-ID questions whose wording never
        // names them. Keyed by the question label content.js asks for.
        questionFieldIds: {
            gender: ['gender'], sex: ['gender'],
            'hispanic or latino': ['hispanicOrLatino'], 'hispanic/latino': ['hispanicOrLatino'], hispanic: ['hispanicOrLatino'],
            race: ['ethnicity', 'race'], ethnicity: ['ethnicity'],
            'veteran status': ['veteranStatus'], veteran: ['veteranStatus'],
            disability: ['disabilityStatus']
        },

        // Disability self-ID (CC-305).
        disabilityFieldId: 'disabilityStatus',
        disabilityGroupOption: { source: '\\bhave (had )?a disability\\b', flags: 'i' },
        disabilityOption: {
            yes: { source: '^\\s*yes\\b', flags: 'i' },
            no: { source: '^\\s*no\\b', flags: 'i' },
            decline: { source: '\\b(wish|want) to answer\\b|\\bdecline\\b|\\bnot to (answer|self-identify)\\b', flags: 'i' }
        },
        // The CC-305 signature box.
        signatureNameFieldId: 'name',

        // Label aliases, most specific first (the first alias that matches any
        // label on the page wins).
        labels: {
            firstName: ['first name', 'given name'],
            lastName: ['last name', 'family name', 'surname'],
            phone: ['phone', 'mobile'],
            email: ['email'],
            linkedin: ['linkedin'],
            website: ['personal website', 'portfolio', 'website'],
            addressLine1: ['address line 1', 'street'],
            city: ['city', 'town'],
            postalCode: ['zip', 'postal code'],
            country: ['country', 'region'],
            workCompany: ['company', 'employer'],
            workTitle: ['job title', 'title', 'role'],
            workLocation: ['location'],
            workDescription: ['role description', 'description', 'summary'],
            workCurrentRole: ['i currently work here', 'current job'],
            workFrom: ['from', 'start date'],
            workTo: ['to', 'end date'],
            educationSchool: ['school', 'institution', 'university'],
            educationFieldOfStudy: ['field of study', 'major'],
            educationDegree: ['degree', 'qualification'],
            skills: ['skills', 'competencies']
        }
    }
};
