# Testing Checklist for Workday Extension Updates

## ✅ Pre-Testing Setup

- [ ] Load the extension in Chrome (chrome://extensions → Load unpacked)
- [ ] Navigate to any Workday application at `*.myworkdayjobs.com/*`
- [ ] Open Chrome DevTools Console (F12) to view logs

---

## 📋 Test 1: Popup UI & Storage

### Actions:
1. Click the extension icon
2. Scroll to "Job Preferences" section
3. Configure:
   - [x] Check "I am a Former Employee"
   - [x] Check "Legally Authorized to Work in Country"
   - [ ] Uncheck "I Require Sponsorship"
   - Select "LinkedIn" from "How Did You Hear About Us?"
   - [x] Enable "🚀 Decline All Disclosures"
4. Click "Save Profile"

### Expected Results:
- [ ] Status shows "Profile saved!" in green
- [ ] No console errors
- [ ] Refresh popup - settings should persist

---

## 📋 Test 2: Work Authorization Question

### Setup:
- Ensure "Legally Authorized to Work" is CHECKED
- Click "AUTOFILL ACTIVE PAGE"

### Look For:
- Question: "Are you legally authorized to work in [country]?"
- Question: "Are you 18 years of age or older?"

### Expected Results:
- [ ] "Yes" radio button is automatically selected
- [ ] Console log: `Workday Autoplay: answerYesNo - Answering "..." with "Yes"`

---

## 📋 Test 3: Former Employee Question

### Setup:
- Set "I am a Former Employee" to CHECKED
- Click "AUTOFILL ACTIVE PAGE"

### Look For:
- Question: "Have you previously worked for this company?"
- Question: "Are you a former employee?"

### Expected Results:
- [ ] "Yes" radio button is automatically selected
- [ ] Console log confirms the answer

---

## 📋 Test 4: Sponsorship Question

### Setup:
- Set "I Require Sponsorship" to UNCHECKED
- Click "AUTOFILL ACTIVE PAGE"

### Look For:
- Question: "Will you require sponsorship now or in the future?"
- Question: "Do you need visa sponsorship?"

### Expected Results:
- [ ] "No" radio button is automatically selected
- [ ] Console log confirms the answer

---

## 📋 Test 5: Referral Source Dropdown

### Setup:
- Set referral source to "LinkedIn"
- Click "AUTOFILL ACTIVE PAGE"

### Look For:
- Dropdown with label: "How did you hear about us?"
- Or similar: "Source", "Referral Source"

### Expected Results:
- [ ] Dropdown automatically opens
- [ ] "LinkedIn" is selected
- [ ] Console log: `Workday Autoplay: Setting referral source to LinkedIn`

---

## 📋 Test 6: Decline Disclosures - Race/Ethnicity

### Setup:
- Enable "🚀 Decline All Disclosures"
- Navigate to the disclosure/EEO page (usually page 2 or 3)
- Click "AUTOFILL ACTIVE PAGE"

### Look For:
- Race dropdown or radio buttons
- Ethnicity dropdown or radio buttons

### Expected Results:
- [ ] "Decline to identify" is selected
- [ ] OR "I do not wish to answer" is selected
- [ ] Console log: `Workday Autoplay: Auto-declining Race/Ethnicity disclosures`

---

## 📋 Test 7: Decline Disclosures - Veteran Status

### Setup:
- Ensure "🚀 Decline All Disclosures" is enabled
- On disclosure page

### Look For:
- "Veteran Status" dropdown or radio buttons

### Expected Results:
- [ ] "I DECLINE TO SELF-IDENTIFY" is selected
- [ ] OR "I do not wish to answer" is selected
- [ ] Console log: `Workday Autoplay: Auto-declining Veteran Status`

---

## 📋 Test 8: Decline Disclosures - Disability

### Setup:
- Ensure "🚀 Decline All Disclosures" is enabled
- On disclosure page (often separate page)

### Look For:
- "Do you have a disability?" question
- Options: "Yes", "No", "I do not wish to answer"

### Expected Results:
- [ ] "I DO NOT WISH TO ANSWER" is selected
- [ ] OR "No, I don't have a disability" is selected
- [ ] Console log: `Workday Autoplay: Auto-declining Disability disclosures`

---

## 📋 Test 9: Multi-Page Forms (MutationObserver)

### Setup:
- Fill out page 1
- Click "Next" button to go to page 2
- Wait 2 seconds (observer debounce time)

### Expected Results:
- [ ] Console log: `Workday Autoplay: DOM Changed, Re-Scanning...`
- [ ] New page is automatically filled
- [ ] Questions on page 2 are answered
- [ ] No need to click "AUTOFILL ACTIVE PAGE" again

---

## 📋 Test 10: Toggle OFF - Disclosures

### Setup:
- DISABLE "🚀 Decline All Disclosures"
- Save profile
- Navigate to disclosure page
- Click "AUTOFILL ACTIVE PAGE"

### Expected Results:
- [ ] Disclosures are NOT automatically filled
- [ ] No console logs about declining disclosures
- [ ] User must manually answer disclosure questions

---

## 🔍 Console Logs to Look For

When everything works correctly, you should see logs like:

```
Workday Autoplay: Received fill_form request.
Workday Autoplay: Profile loaded for filling
Workday Autoplay: Scanning page (Async Mode)...
Workday Autoplay: Starting MutationObserver...
Workday Autoplay: Handling Job Preferences Questions...
Workday Autoplay: answerYesNo - Answering "Are you legally authorized..." with "Yes"
Workday Autoplay: Setting referral source to LinkedIn
Workday Autoplay: Opening dropdown for how did you hear about us
Workday Autoplay: Selecting LinkedIn for how did you hear about us
Workday Autoplay: Filling Disclosures (Enhanced)...
Workday Autoplay: Auto-declining Race/Ethnicity disclosures
Workday Autoplay: Auto-declining Veteran Status
Workday Autoplay: Auto-declining Disability disclosures
Workday Autoplay: Scan completed.
```

---

## 🐛 Common Issues & Solutions

### Issue: "Questions not being answered"
**Solution:**
- Check that preferences are saved
- Verify question text matches keywords (check console)
- Try clicking "AUTOFILL ACTIVE PAGE" manually

### Issue: "Dropdowns not opening"
**Solution:**
- Wait for page to fully load
- Some dropdowns may have custom implementations
- Check for console errors

### Issue: "Disclosures not declining"
**Solution:**
- Ensure toggle is enabled AND saved
- Disclosure pages may load slowly - wait and retry
- Check console for "Auto-declining" logs

### Issue: "Extension not running on new pages"
**Solution:**
- MutationObserver has 2-second debounce
- May need to manually trigger on some pages
- Refresh and try again

---

## ✅ Success Criteria

All features working correctly when:

- ✅ All toggles persist after saving
- ✅ Work authorization questions → Answered correctly
- ✅ Former employee questions → Answered correctly
- ✅ Sponsorship questions → Answered correctly
- ✅ Referral source → Selected automatically
- ✅ Race/Ethnicity → Declined when toggle on
- ✅ Veteran Status → Declined when toggle on
- ✅ Disability → Declined when toggle on
- ✅ Multi-page forms → Auto-filled without manual intervention
- ✅ No console errors during entire process

---

## 📝 Notes

- Test on 2-3 different companies' Workday sites
- Some companies may customize question text
- Disclosure page layouts vary by company
- Always review before final submission!

**Happy Testing! 🎉**
