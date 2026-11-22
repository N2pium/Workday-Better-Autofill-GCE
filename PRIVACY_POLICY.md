# Privacy Policy

**Status:** Draft for version 2.0 (cloud features). Not yet in effect. Version 1.4 and earlier are covered by the policy dated 2026-08-17.

**Effective Date:** on release of version 2.0

## Overview
This extension ("Workday: Better Autofill") autofills job application forms on supported job portals (Workday and, optionally, Greenhouse and other supported sites).

You can use it in one of two ways:

1. **Local-only mode (the default).** Everything stays in your browser, exactly as in earlier versions. No account, no servers, nothing transmitted to us.
2. **Cloud account (optional).** If you choose to sign in, the extension can sync your profiles across devices, store resume versions, track your applications in a web dashboard, send follow-up reminders, and offer AI-assisted features. Each cloud feature is described below, along with exactly what it sends.

You can switch back to local-only mode, or delete your cloud account, at any time.

## Local-only mode
1. **What is stored**: Only the profile information you type into the extension yourself — name, contact details, address, work history, education, skills, languages, job preferences, an optional resume file, and optional voluntary self-identification answers (gender, race/ethnicity, veteran status, disability status). Job preferences include a single checkbox confirming you are 18 years of age or older; no date of birth or age is stored.
2. **Where it is stored**: In your browser using the Chrome Storage API (`chrome.storage.local`). It is never synced, uploaded, or backed up by us.
3. **When it leaves your browser**: Only when **you** click the autofill button, which enters your data into the job application form you are viewing — exactly as if you had typed it yourself.

## Cloud account (optional)

### Signing in
You sign in with your Google account through Amazon Cognito, our sign-in provider. We receive your **email address, name, and a Google account identifier**. We never see or store your Google password.

### What we store when you are signed in
- **Profiles** you choose to sync (name, contact details, address, work history, education, skills, languages, job preferences).
- **Resume files** you upload, and their file names.
- **Application records** created when you autofill or add an application: company, job title, job posting URL, date, and the status you set.
- **Saved answers** you choose to keep in your answer library: the application question and the final text you approved, so you can reuse it on later applications.
- **Reminder settings** for applications you want follow-up reminders on.
- **Usage counters** for AI features, used only to enforce daily limits.

### What we never store in the cloud
- **Voluntary self-identification answers** (gender, race/ethnicity, veteran status, disability status) are **never synced or uploaded**. They stay in your browser on each device and are used only to fill the matching voluntary questions at your request.
- We do not collect your browsing history, the content of pages you visit, or form fields other than the profile data you entered yourself.

### AI features (optional, used only when you ask)
When you use an AI feature — parsing a resume into your profile, drafting an answer to an application question, writing a cover letter, or scoring how well your profile matches a job description — the relevant parts of your profile or resume, plus the question or job description you selected, are sent to **Amazon Bedrock** to generate the result.
- Self-identification answers are **never** included.
- AI requests are processed by Amazon Bedrock **within the United States** (AWS Regions us-east-1, us-east-2 and us-west-2). Amazon Bedrock does not store your inputs or outputs, does not use them to train AI models, and does not share them with model providers.
- AI results are suggestions. Nothing is entered into a form or saved to your profile until you review and accept it.

### Follow-up reminders (optional)
If you turn on reminders, we email you at your sign-in address (sent through Amazon Simple Email Service) when an application has had no status change for a set number of days. You can turn reminders off for one application or for all of them, and every reminder email includes a way to stop them.

### Field-mapping updates
To keep autofill working when job sites change, the extension may download updated **field-mapping files** (lists of form labels and page selectors). These files contain no code and no personal data, and downloading them sends nothing about you beyond the standard information any web request includes (such as your IP address).

### Error reports (optional, off by default)
If you turn on "Help improve autofill", the extension reports when it cannot find or fill a field. A report contains **only**: the job site's domain, the form step, an internal field name (for example `phone`), the type of failure, and the extension and field-mapping versions. Reports never contain the values you entered, your name, or any other profile data, and are not linked to your account.

## Where and how cloud data is stored
- Cloud data is stored with **Amazon Web Services (AWS) in the United States** (us-east-2, Ohio).
- AI requests may be processed in another US AWS Region (us-east-1 or us-west-2) to keep responses fast; nothing is stored there, and no AI processing happens outside the United States.
- It is encrypted in transit (HTTPS/TLS) and at rest (AWS Key Management Service).
- Each account can access only its own data. Access by the developer is limited to operating, securing, and troubleshooting the service.

## How long we keep it
- **Account data** (profiles, resumes, application records, saved answers, reminders) is kept until you delete it or delete your account.
- **Backups** are kept for up to 35 days, after which deleted data is gone from backups as well.
- **Service logs** (used to detect errors and abuse) are kept for 14 days.
- **Error reports** are kept for up to 12 months, and are not linked to any account.

## Your choices and rights
- **See and export your data**: View everything in the dashboard, and export your profile as a JSON file at any time.
- **Correct your data**: Edit any profile, resume, application record or saved answer.
- **Delete your data**: Use **"Delete All Data"** in the extension to clear local data, or **"Delete my account"** in the extension or dashboard to permanently delete your cloud account and all of its data (profiles, resumes, application records, saved answers and scheduled reminders). Deletion from live systems is immediate; backups expire within 35 days.
- **Stop syncing**: Sign out or turn sync off to return to local-only mode. Data already in the cloud stays there until you delete it.
- **Withdraw consent**: AI features, reminders and error reports can each be turned off at any time.

## Permissions
- **storage** — saves your profile locally so you don't have to re-type it.
- **activeTab / scripting** — lets the extension fill the job application form in the tab you are viewing when you click the autofill button.
- **sidePanel** — displays the extension UI in the browser side panel.
- **identity** — used only when you choose to sign in, to open the secure sign-in window.
- **Host permission `*://*.myworkdayjobs.com/*`** — required to autofill Workday application pages.
- **Optional host permissions for Greenhouse and other supported job sites** — requested **only if you enable that site** in the extension's "Supported Portals" settings. You can revoke them at any time by turning the toggle off or via Chrome's extension settings.
- **Access to the extension's own service** — used only for the cloud features above, and only when you are signed in (or, for error reports, have opted in).

The extension runs only on the job portal domains listed above and on its own service, and has no access to any other website.

## Service providers
We use these providers only to run the features described above:
- **Amazon Web Services** — hosting, storage, sign-in (Amazon Cognito), AI features (Amazon Bedrock) and reminder emails (Amazon Simple Email Service).
- **Google** — sign-in only.

## Data sales and advertising
We do not sell, rent, or share your data for advertising or marketing. There are no third-party analytics, advertising SDKs, or trackers in the extension.

The use of information received from Google APIs and the Chrome extension platform adheres to the Chrome Web Store User Data Policy, including the Limited Use requirements: your data is used only to provide the features you see in the extension, is not transferred to others except as needed to provide those features, to comply with law, or as part of a merger or acquisition with notice to you, and is never used for advertising, creditworthiness, or lending decisions.

## Children
The extension is intended for job seekers aged 18 and over and is not directed to children.

## Changes
If this policy changes, the updated version will be published at this same location with a new effective date. Material changes to what is collected will also be shown in the extension before they apply to you.

## Contact
If you have any questions or a data request (access, correction, export or deletion), email **better-autofill@googlegroups.com**. You can also review the source code or contact the developer via the Chrome Web Store listing.
