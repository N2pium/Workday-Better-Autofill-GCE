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

## 🚦 v1.3 Release Tests — run these before uploading to the Store

v1.3 changes ~890 lines of `content.js`. Tests 11–13 cover the fixes; **Test 14
is the one that matters most**, because it covers paths that already worked and
were touched anyway. A regression there is worse than a fix that did not land.

---

## 📋 Test 11: Dropdowns pick from the right list (F1, F6, F7)

### Setup:
- Fill in **Country** and **State** in the popup, then Save Profile
- Manually set Country on the form to something wrong (e.g. Uzbekistan)
- Click "AUTOFILL ACTIVE PAGE"

### Expected Results:
- [ ] `Found dropdown trigger for country (currently "Uzbekistan")` — **not**
      `No dropdown trigger found`
- [ ] Country changes to your stored value
- [ ] `Found 61 options for State` (50 states + DC + territories + Armed Forces).
      **250 means it is reading the Country list** — that is the F6 regression
- [ ] State is selected, not merely highlighted
- [ ] "How Did You Hear About Us?" selects your source
- [ ] No `Selected ... but it did not commit` warnings

---

## 📋 Test 12: Degree matches across spellings (F4)

### Setup:
Run once per stored value: `BS`, `Bachelor of Science`, `Bachelors`.

### Expected Results:
- [ ] All three select **Bachelors** on Duke's list
      (Select One / High School–GED / Associates / Bachelors / Masters / Doctorate)
- [ ] The disabled "Select One" placeholder is never chosen
- [ ] With a list offering **both** Bachelor of Arts and Bachelor of Science:
      `BS` picks Science, `BA` picks Arts, and plain `Bachelors` leaves it
      **blank** rather than guessing — a blank here is correct behavior

---

## 📋 Test 13: School and Field of Study (F2, F3)

### Setup:
- Clear School and Field of Study on the form, then autofill

### Expected Results:
- [ ] `Handling Searchable Picker for school` — **not** `Could not find searchBox`
- [ ] School and Field of Study both get filled
- [ ] **Exactly one** pill per field. Two pills means the commit check regressed
- [ ] Run autofill a **second time** on the same page: it must log
      `already has a selection (...), skipping` and **not** add a duplicate
- [ ] With a deliberately misspelled school, it picks the closest real option
      and logs the score, rather than the first one alphabetically

---

## 📋 Test 14: Nothing that already worked has broken

These were confirmed working before v1.3 and were all touched indirectly.

### Expected Results:
- [ ] Address Line 1, City, Postal Code still fill
- [ ] **First name and last name land in the correct fields** — not the same
      value in both
- [ ] Month/year date dropdowns still fill (they changed how they commit)
- [ ] All three disclosure auto-declines still work (radio container scope
      was tightened)
- [ ] "Previously worked for..." still answers correctly
- [ ] Language row still skips when one already exists
- [ ] Resume still skips when one is already uploaded
- [ ] Greenhouse autofill still works — `greenhouse.js` was untouched, so this
      is a smoke test, not a deep one

---

## 📋 Test 15: Popup reads honestly (v1.3 QoL)

### Expected Results:
- [ ] Every empty field shows its hint in *italic grey* — clearly a hint, not
      an answer you have already given
- [ ] Country shows `e.g. United States of America` and it is obvious the field
      is empty
- [ ] Date fields show `MM` / `YYYY`, end dates show `MM or Present`
- [ ] Saved values render as normal upright text, plainly different from hints

---

## 📋 Test 16: Application Questions page (F8 — new, unverified)

Only reachable on tenants that use a questionnaire page ("Application Questions
1 of 2"). Duke Energy does **not** have one — BCBSLA and the IT Computer Science
Intern posting do.

### Setup:
- In the popup set "Legally Authorized to Work in Country" and
  "I Require Sponsorship" to known values, then Save Profile
- Reach the Application Questions page and autofill

### Expected Results:
- [ ] "Are you legally authorized / legally eligible to work…?" is answered
- [ ] "Will you now or in the future require sponsorship…?" is answered
- [ ] Both match the toggles you set, including when set to **No**
- [ ] `Are you at least 18 years or older?` is **left on Select One** — that is
      intended, not a miss. Age is not work authorization, so it is not wired to
      the authorization toggle
- [ ] Free-text questions with no matching toggle ("Do you have any relatives
      who work at…", "What is your desired start date?") are left alone
- [ ] Nothing is answered twice or flipped back

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

### v1.3 additions

- ✅ Country and State → Selected, and corrected when already set to something wrong
- ✅ State dropdown → ~61 options, never 250
- ✅ Degree → Matches whichever spelling you stored
- ✅ School / Field of Study → Filled, exactly one pill, no duplicate on re-run
- ✅ First and last name → In their own fields
- ✅ Popup → Empty fields visibly empty

---

## 📝 Notes

- Test on 2-3 different companies' Workday sites
- Some companies may customize question text
- Disclosure page layouts vary by company
- Always review before final submission!

**Happy Testing! 🎉**
