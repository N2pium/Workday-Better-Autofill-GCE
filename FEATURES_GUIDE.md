# Workday Autofill Extension - New Features Guide

## 🚀 Overview

This update adds **automated handling of job application questions and voluntary disclosures** to your Workday Chrome Extension. The extension now intelligently answers common application questions and can automatically decline all disclosure forms with a single toggle.

---

## ✅ What's New

### 1. **Job Preferences Section** (Popup UI)

Located in the extension popup, you'll find a new "Job Preferences" section with the following controls:

#### **Toggles:**
- ✓ **I am a Former Employee** - Check this if you previously worked at the company
- ✓ **Legally Authorized to Work in Country** - Indicates you're legally authorized to work (default: ON)
- ✓ **I Require Sponsorship** - Check this if you need visa sponsorship

#### **Dropdown:**
- 📋 **How Did You Hear About Us?** - Select your referral source:
  - Company Website
  - LinkedIn
  - Indeed
  - Glassdoor
  - Other

#### **🚀 Master Toggle:**
- **Decline All Disclosures** - When enabled, automatically selects "I decline to self-identify" for:
  - Race/Ethnicity questions
  - Veteran Status
  - Disability Status

---

## 🎯 How It Works

### **Automatic Question Answering**

The extension uses the new `answerYesNo()` function to intelligently detect and answer common application questions:

**Work Authorization Questions:**
- "Are you legally authorized to work in [country]?"
- "Are you 18 years of age or older?"
- "Do you have the legal right to work?"

**Former Employee Questions:**
- "Have you previously worked for this company?"
- "Are you a former employee?"
- "Have you worked here before?"

**Sponsorship Questions:**
- "Will you require sponsorship now or in the future?"
- "Do you need visa sponsorship?"
- "Do you require immigration support?"

**Referral Source:**
- "How did you hear about us?"
- Automatically selects your preferred source from the dropdown

---

## 🔐 Automated Disclosures

When **"Decline All Disclosures"** is enabled, the extension automatically:

### **Race/Ethnicity:**
✓ Selects "Decline to identify" or "I do not wish to answer"

### **Veteran Status:**
✓ Selects "I DECLINE TO SELF-IDENTIFY" or "I AM NOT A VETERAN"

### **Disability Status:**
✓ Selects "I DO NOT WISH TO ANSWER" or "No, I don't have a disability"

---

## 🛠️ How to Use

### **Step 1: Configure Your Preferences**
1. Click the extension icon in Chrome
2. Scroll to the **"Job Preferences"** section
3. Check/uncheck your work authorization, former employee, and sponsorship status
4. Select your referral source from the dropdown
5. Enable **"Decline All Disclosures"** if you want to auto-decline all voluntary forms
6. Click **"Save Profile"**

### **Step 2: Navigate to a Workday Application**
1. Go to any `myworkdayjobs.com` application page
2. Click **"AUTOFILL ACTIVE PAGE"** in the extension popup

### **Step 3: Watch the Magic! ✨**
The extension will:
- Fill in all your personal information
- Answer Yes/No questions based on your preferences
- Select your referral source
- Automatically decline disclosures (if enabled)
- Continue working as you click "Next" through multi-page forms

---

## 🔍 Technical Details

### **MutationObserver**
The extension uses a MutationObserver to detect when new form elements are loaded. This means:
- ✅ Works on multi-page Workday applications
- ✅ Automatically re-scans when you click "Next"
- ✅ Handles dynamically loaded content

### **Aria-Label Matching**
For standardized Workday disclosure fields, the extension uses `aria-label` attributes to reliably find and select options, making it more robust across different companies.

### **React Event Dispatching**
Since Workday uses React, the extension properly dispatches:
- `input` events
- `change` events
- `blur` events

This ensures Workday's form validation recognizes the filled values.

---

## 📋 Storage

All your preferences are stored locally using `chrome.storage.local`:

```javascript
{
  jobPreferences: {
    formerEmployee: boolean,
    authorizedToWork: boolean,
    requiresSponsorship: boolean,
    sourceReferral: string,
    autoDisclosures: boolean  // The master toggle
  }
}
```

---

## 🎨 UI Preview

The Job Preferences section looks like this:

```
╔═══════════════════════════════════════════╗
║         Job Preferences                    ║
╠═══════════════════════════════════════════╣
║ ☐ I am a Former Employee                  ║
║ ☑ Legally Authorized to Work in Country   ║
║ ☐ I Require Sponsorship                   ║
║                                            ║
║ How Did You Hear About Us?                 ║
║ [LinkedIn                        ▼]       ║
║                                            ║
║ ─────────────────────────────────────────  ║
║ ☐ 🚀 Decline All Disclosures              ║
║    (Master Toggle)                         ║
║                                            ║
║ When enabled, automatically selects        ║
║ "I decline to self-identify" for Race,     ║
║ Veteran Status, and Disability questions.  ║
╚═══════════════════════════════════════════╝
```

---

## 🐛 Troubleshooting

### **Questions Not Being Answered?**
- Make sure you've saved your profile after changing preferences
- Check the browser console (F12) for "Workday Autoplay" logs
- Some companies customize their questions - the extension uses keyword matching

### **Disclosures Not Declining?**
- Ensure "Decline All Disclosures" is checked and saved
- Workday may take a moment to load disclosure pages
- The extension will retry multiple times with different selectors

### **Extension Not Working on Multi-Page Forms?**
- The MutationObserver should handle this automatically
- Try clicking "AUTOFILL ACTIVE PAGE" again on the new page
- Check that you're on a `myworkdayjobs.com` domain

---

## 🔄 Advanced: The answerYesNo() Function

For developers or those curious about how it works:

```javascript
// Automatically find and answer Yes/No questions
answerYesNo(['authorized to work', 'legal right'], 'Yes');
answerYesNo(['require sponsorship', 'visa'], 'No');
```

This function:
1. Searches all `<label>` elements for keyword matches
2. Finds the associated radio button container
3. Locates the "Yes" or "No" radio button
4. Clicks it and dispatches React events

---

## 📝 Support

If you encounter any issues:
1. Check the browser console for error messages
2. Verify your preferences are saved correctly
3. Try refreshing the Workday page
4. Disable and re-enable the extension if needed

---

## 🎉 Enjoy Your Automated Applications!

This extension saves you time and reduces repetitive clicking. Just configure your preferences once, and let the automation handle the rest!

**Remember**: Always review the application before submitting to ensure accuracy.
