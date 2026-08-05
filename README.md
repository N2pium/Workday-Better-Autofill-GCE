# Workday: Better Autofill

A Chrome extension that automates filling job application forms on Workday and Greenhouse job boards. Save time, reduce repetitive typing, and apply to more positions faster.

## Features

✨ **Workday Support**
- Auto-fills personal information (name, contact, address)
- Automatically answers yes/no questions based on your preferences
- Handles multi-page forms with continuous auto-filling
- Supports resume file uploads

✨ **Greenhouse Support** (optional)
- Supports both legacy Greenhouse boards and new Remix-based job boards
- Dynamically enabled via optional permissions (privacy-first design)
- Same autofill capabilities as Workday

✨ **Job Preferences**
- Configure your work authorization status
- Set visa sponsorship requirements
- Indicate former employee status
- Choose your referral source
- Master toggle to auto-decline all voluntary self-identification questions

✨ **Privacy-First**
- All data stored locally — no cloud sync, no servers, no tracking
- Zero third-party analytics or services
- Full control over data deletion
- Open source code available on GitHub

## Installation

### From Chrome Web Store
1. Visit the extension page on the Chrome Web Store
2. Click "Add to Chrome"
3. Confirm permissions when prompted

### Manual Installation (Development)
1. Clone this repository: `git clone https://github.com/N2pium/EasyApply.git`
2. Open Chrome and navigate to `chrome://extensions/`
3. Enable "Developer mode" (toggle in top right)
4. Click "Load unpacked"
5. Select the EasyApply folder

## How to Use

### Step 1: Set Up Your Profile
1. Click the extension icon in Chrome → Opens the side panel
2. Fill in your personal information:
   - Name, phone, email, LinkedIn URL
   - Address (street, city, state, zip)
   - Work experience, education, skills, languages
   - (Optional) Resume file
3. Configure **Job Preferences**:
   - Work authorization status
   - Sponsorship needs
   - Former employee status
   - How you heard about the job
   - Whether to auto-decline voluntary disclosures
4. Click **"Save Profile"**

### Step 2: Autofill Applications
1. Navigate to a Workday or Greenhouse job application
2. Click **"AUTOFILL ACTIVE PAGE"** in the extension panel
3. Watch as your profile is automatically filled in
4. Review the form and submit when ready

### Step 3: For Multi-Page Forms
- The extension continues to autofill as you progress through pages
- Click "Next" to proceed — autofill activates automatically on the new page
- Click **"AUTOFILL ACTIVE PAGE"** again if needed

## Supported Portals

### Workday (Always Enabled)
- `*.myworkdayjobs.com`

### Greenhouse (Optional - Requires Permission)
- `boards.greenhouse.io` (legacy boards)
- `job-boards.greenhouse.io` (new Remix boards)

To enable Greenhouse support:
1. Open the extension panel
2. Find "Supported Portals" section
3. Toggle **"Enable Greenhouse Support"**
4. Grant the optional permission when prompted

You can revoke Greenhouse access at any time via the toggle or Chrome's extension settings.

## Permissions Explained

| Permission | Purpose |
|-----------|---------|
| `storage` | Saves your profile locally so you don't re-type information |
| `activeTab` | Lets the extension fill the current job application form |
| `scripting` | Injects autofill logic into job application pages |
| `sidePanel` | Displays the extension UI in the browser side panel |
| `*://*.myworkdayjobs.com/*` | Required to autofill Workday applications |
| `*://boards.greenhouse.io/*` (optional) | Allows Greenhouse legacy board autofill |
| `*://job-boards.greenhouse.io/*` (optional) | Allows Greenhouse new board autofill |

## Privacy & Data

📌 **Your data stays on your device.** The extension:
- Stores all information locally using Chrome's storage API
- Does NOT transmit data to any server
- Does NOT use analytics or tracking
- Does NOT share data with third parties
- Only sends data to job application forms when you click autofill

See the full [Privacy Policy](PRIVACY_POLICY.md) for details.

## Data Deletion

Delete all stored data at any time:
1. Open the extension panel
2. Scroll to the bottom
3. Click **"Delete All Data"**
4. Confirm when prompted

Data is also deleted if you uninstall the extension.

## Troubleshooting

### Extension not working on Workday?
- Verify you're on a `*.myworkdayjobs.com` domain
- Check that you've saved your profile
- Try refreshing the page
- Open the console (F12) and check for error messages

### Questions not being answered?
- Ensure your preferences are saved
- Some companies customize Workday — the extension uses keyword matching for common questions
- Check the browser console for "Workday Autoplay" logs

### Greenhouse not autofilling?
- Verify you've enabled Greenhouse support and granted permissions
- Try refreshing the page
- Greenhouse integration works on both legacy and new boards

### Resume not uploading?
- Ensure the file size is reasonable (typically <5MB)
- Try uploading the resume manually once, then click autofill again
- Check that the form accepts file uploads

## Support

- **Issue found?** Check the [GitHub Issues](https://github.com/N2pium/EasyApply/issues)
- **Have a suggestion?** Open a new issue with details
- **Questions?** Review the [Features Guide](FEATURES_GUIDE.md) for detailed information

## Technical Details

### Architecture
- **popup.html/css/js** — Extension UI and user preferences
- **content.js** — Workday autofill logic
- **greenhouse.js** — Greenhouse autofill (isolated world)
- **greenhouse-main.js** — Greenhouse react-select interaction (main world)
- **background.js** — Service worker for permissions management

### For Developers
The extension is built with:
- Vanilla JavaScript (no frameworks)
- Chrome Extensions Manifest V3
- Chrome Storage API for data persistence
- MutationObserver for dynamic form detection

See [IMPLEMENTATION_SUMMARY.md](IMPLEMENTATION_SUMMARY.md) for technical deep-dive.

## License

This project is open source. Review the GitHub repository for license details.

## Changelog

### v1.2
- Added Greenhouse support (optional, privacy-first)
- Enhanced Job Preferences UI
- Master toggle for auto-declining disclosures
- Improved form detection and multi-page support
- Better error handling and logging

### v1.1
- Initial Workday support
- Basic autofill for personal info, education, experience
- Profile preferences storage

## Contributing

Found a bug or have an improvement? Feel free to:
1. Fork the repository
2. Create a feature branch
3. Submit a pull request

For major changes, open an issue first to discuss.

---

**Made with ❤️ for job seekers everywhere.**

Questions or feedback? Visit the [GitHub repo](https://github.com/N2pium/EasyApply).
