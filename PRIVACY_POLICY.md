# Privacy Policy

**Effective Date:** 2026-07-10

## Overview
This extension ("Workday: Better Autofill") autofills job application forms on supported job portals (Workday and, optionally, Greenhouse). It is designed to operate **entirely locally on your device**.

## Data Collection & Storage
1. **What is stored**: Only the profile information you type into the extension yourself — name, contact details, address, work history, education, skills, languages, job preferences, an optional resume file, and optional voluntary self-identification answers (gender, race/ethnicity, veteran status, disability status).
2. **Where it is stored**: All data is stored locally in your browser using the Chrome Storage API (`chrome.storage.local`). It is never synced, uploaded, or backed up by us.
3. **No remote servers**: We do not operate any backend servers, analytics, or tracking. Your data is **never** transmitted to us or to any third party. It leaves your browser only when **you** explicitly click the autofill button, which enters your data into the job application form you are viewing — exactly as if you had typed it yourself.
4. **Sensitive data**: The voluntary self-identification fields (race, gender, veteran status, disability) are entirely optional, are used solely to fill the corresponding voluntary questions on application forms at your request, and are stored locally like all other data. Leaving them blank means those questions are left untouched (unless you enable the "Decline All Disclosures" option, which selects the decline/prefer-not-to-answer choice).

## Permissions
- **storage** — saves your profile locally so you don't have to re-type it.
- **activeTab / scripting** — lets the extension fill the job application form in the tab you are viewing when you click the autofill button.
- **sidePanel** — displays the extension UI in the browser side panel.
- **Host permission `*://*.myworkdayjobs.com/*`** — required to autofill Workday application pages.
- **Optional host permissions `*://boards.greenhouse.io/*` and `*://job-boards.greenhouse.io/*`** — requested **only if you enable Greenhouse support** in the extension's "Supported Portals" settings. You can revoke this at any time by turning the toggle off or via Chrome's extension settings.

The extension runs only on the job portal domains listed above and has no access to any other website.

## Data Deletion
You can delete all stored data at any time by clicking the **"Delete All Data"** button in the extension panel. This immediately and permanently clears all local storage associated with the extension. Uninstalling the extension also removes all stored data.

## Data Sales & Third Parties
We do not sell, share, transfer, or disclose your data to anyone. There are no third-party services, SDKs, or analytics in this extension.

## Changes
If this policy changes, the updated version will be published at this same location with a new effective date.

## Contact
If you have any questions, you can review the source code or contact the developer via the Chrome Web Store listing.
