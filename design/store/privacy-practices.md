# Chrome Web Store: Privacy practices tab (version 2.0)

Answers for the Developer Dashboard's **Privacy practices** tab. Each one was checked
against the 2.0 code and `PRIVACY_POLICY.md`. Update this file whenever the extension
starts handling something new.

## Single purpose

> Autofills job applications on Workday (and, if you turn it on, Greenhouse) from a
> profile you enter once, with an optional account that syncs that profile, tracks
> your applications and drafts answers to application questions.

## Permission justifications

| Permission | Justification |
|---|---|
| `storage` | Saves the user's profile, settings and sign-in session locally so they are not re-typed for every application. |
| `activeTab` | Lets the extension fill the application form in the tab the user is viewing when they click Autofill. |
| `scripting` | Injects the autofill script into a supported job page when the user clicks Autofill, and into Greenhouse pages only after the user turns Greenhouse on. |
| `sidePanel` | Shows the extension's interface in the side panel so it stays open while the user works through a multi-page form. |
| `identity` | Opens the secure sign-in window (Amazon Cognito, email or Google) when the user chooses to sign in. Not used otherwise. |
| Host `*://*.myworkdayjobs.com/*` | Workday application pages are where the extension fills forms, reads the job title, company and description for the tracker and AI features, and shows the Draft button. |
| Optional host: Greenhouse domains | Requested only when the user turns on Greenhouse under Supported Portals, to fill Greenhouse forms. Revoked when they turn it off. |
| Optional host: extension's API, sign-in domain and resume storage (`execute-api…`, `…amazoncognito.com`, `…s3…amazonaws.com`) | The extension's own backend. API and sign-in access are requested when the user signs in; resume storage access is requested the first time they add a resume version. Used for sync, application tracking, resume versions and AI features. |

## Remote code

**No, I am not using remote code.** All JavaScript ships in the package. The backend
returns data (JSON) only.

## Data usage: what the extension collects

"Collects" means data leaves the user's device. Data kept only in `chrome.storage.local`
doesn't count, so local-only mode collects nothing. With an account:

| Category | Tick? | Why |
|---|---|---|
| Personally identifiable information | **Yes** | Name, email, phone and address in a synced profile; the sign-in email; work history and education; resume files kept as resume versions. |
| Health information | No | Disability status is a self-ID answer, which is never synced or uploaded. |
| Financial and payment information | No | None handled. |
| Authentication information | **Yes** | The extension never sees the password (it's typed on the Cognito page), but it stores the sign-in tokens. Ticking this is the safe side of the line. |
| Personal communications | No | None handled. |
| Location | No | The street address is covered by PII. No IP address, GPS or region is collected. |
| Web history | No | Only the URL of a job posting the user autofilled or added is kept, as part of that application record (covered by Website content). |
| User activity | No | No click, scroll or keystroke tracking. |
| Website content | **Yes** | Job title, company, description and posting URL read from job pages, for application records and for AI requests the user makes. |

## Certifications (tick all three)

- [x] I do not sell or transfer user data to third parties, outside of the approved use cases
- [x] I do not use or transfer user data for purposes that are unrelated to my item's single purpose
- [x] I do not use or transfer user data to determine creditworthiness or for lending purposes

## Privacy policy URL

`https://n2pium.github.io/Workday-Better-Autofill-GCE/`

GitHub Pages serves this from **`master:/docs`**. The rebuilt 2.0 page has to reach
`master` before the listing goes live. Until then that URL still shows the 1.4 policy.
