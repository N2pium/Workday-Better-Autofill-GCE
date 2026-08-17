# Autofill Improvement Loop — Shared Notes

**This file is the loop's memory.** Each iteration starts with a cold context window.
Read this file FIRST, and update it LAST. Without it, the loop re-derives the same
"problems" every firing and churns the same functions back and forth.

Branch: `autofill-loop` (never commit to `master` — it is published-extension source)

The loop prompt itself lives in **`LOOP_PROMPT.md`** (v2, two tracks: correctness
and quality of life). Edit it there — v1 was lost when a terminal closed.

---

## Ground truth / constraints

- **There is no live Workday form in the loop's context.** Every change is made by
  reading code, not by observing a failure. This is the single biggest limitation.
  Treat all changes as *hypotheses*, not fixes.
- **Reference form:** Duke Energy `dukeenergy.wd1.myworkdayjobs.com`, the
  `/apply/autofillWithResume` step. It is behind a candidate login, so the loop
  cannot reach it. Captured DOM snapshots live in `tools/captures/` — if a capture
  exists, read it and prefer evidence from it over reasoning about the code alone.
  Capture a fresh one by running `tools/inspect-workday-form.js` in DevTools on the
  page and saving the JSON to `tools/captures/<page-name>.json`.
- **No test runner, no CI, no `package.json`.** The only automated gate is
  `node --check`. Manual testing lives in `TESTING_CHECKLIST.md`.
- The extension is **published** on the Chrome Web Store and handles PII
  (resume, address, phone, email). Regressions reach real users.
- The user has said the autofill **already works well**. The bar for changing
  working code is therefore high. Prefer no change over a speculative change.

## Stop condition

If no *specific, evidence-backed* improvement is available, **make no change and
say so.** Append a dated "no change needed" line to the log below. Three consecutive
no-change iterations means the loop has exhausted what static reading can find —
report that the loop should be stopped pending real-form testing.

---

## Already done (unverified against a real Workday form)

All four commits below add dynamic waits in place of fixed `setTimeout` delays.
None have been exercised against an actual application.

| Commit | Change |
|---|---|
| `f1ac808` | Added `waitForElement`, `waitForCondition`, `retryAsync`, `isElementVisible`, `scrollIntoViewIfNeeded`; rewrote `selectWorkdayDropdown` |
| `d814004` | `handleSearchablePicker` — poll for `promptOption` instead of fixed 1500ms |
| `f6a12c7` | `handleDropdown` — poll for options; search-input path also polls |
| `7ec1d5e` | `handleDateDropdown` — poll for options |
| _"Stop fuzzy label matching from writing one value into several fields"_ | `fillFieldByFuzzyLabel` rewritten: first matching key wins, exact label beats substring. Added `collectLabelTexts` + `normalizeLabel`. |

**`retryAsync` and `waitForElement` are both dead code** — defined, never called.
`waitForElement` became unused when F1's fix replaced its one call site. Either
use them or remove them; do not leave them as decoration.

## Considered and deliberately NOT done

Do not re-propose these without new evidence:

- **Adding a test framework / Jest / Playwright.** No runner exists; setting one up
  is a large change to a working extension and is the user's call, not the loop's.
- **Reducing delays further.** The 500ms→300ms reductions already made are at the
  edge of what is safe without real-form observation. Do not keep shaving.
- **Refactoring the XPath helpers into a shared abstraction.** Cosmetic; touches
  every fill path; high regression risk for zero user-visible gain.

## OBSERVED FAILURES — real run, Duke Energy, 2026-08-07

Source: `tools/console.png`, the extension's own log from an actual application.
Line numbers match commit `a0ba197` exactly (`content.js:1005` and `:570`), i.e.
**the published version** — these are shipping bugs, not loop regressions. They
are also not yet re-tested against the loop's four dynamic-wait commits.

**These are observed, not hypothesised. Prefer them over anything in the
speculative candidate list below.**

### F1 — **VERIFIED FIXED** on a real run, 2026-08-07 18:17

`tools/State-inspectElement-New.png` shows `Found 250 options for State` at
`content.js:1064`, line numbers matching `c2787de` exactly. Previously `Found 1`.
The scoped listbox lookup works. **Do not revisit.**

The same run exposed F6 below, which is what actually kept State failing.

### F6 — **VERIFIED FIXED** on a real run, 2026-08-07

`Found 61 options for State`, down from `Found 250`. 61 is the correct size for
a Workday US state list — 50 states + DC + the five territories + the three
Armed Forces entries (AA/AE/AP) + freely-associated states, give or take the
`Select One` placeholder. 250 was the Country list. It is now reading the
listbox that actually belongs to the field. **Do not revisit.**

Fixed in `2017a55`. `Found 250 options for State` — but 250 is the **Country**
list, not a state list. Both new screenshots show two poppers open at the same
time: Workday does not reliably tear down the previous dropdown, and
`findOpenListbox` broke ties by *most options wins*, so Country's 250 entries
beat every dropdown opened after it.

This is the real cause of `Option 'Indiana' not found for State` and
`Option 'LinkedIn' not found` — both **survived the F1 fix**, which is why the
F1 verification looked ambiguous at first glance.

Now takes the **last** list carrying options: poppers append to the end of
`<body>` and `querySelectorAll` returns document order, so last == just opened.

**Still open, deliberately not attempted:** nothing closes the stale dropdown.
It now only overlays fields visually (Middle Name is covered in both shots)
rather than corrupting matching. Sending `Escape` after a confirmed commit is
the obvious next step, but it risks reverting the selection on some widgets and
was not worth the gamble without evidence. Test it before assuming it is safe.

### F1 — original analysis (superseded, kept for context)

Fix: `findOpenListbox()` / `getOpenListboxOptions()` scope every option lookup to
the dropdown that is actually open. Applied to `selectWorkdayDropdown`,
`handleDropdown`, `handleDateDropdown`, `handleLanguages`.

**Verification pending.** Re-run the extension on the Duke Energy form with this
branch loaded and check the console. Success looks like `Found 50 options for
State` (not `Found 1`) followed by an exact match. If it still reports 1, the
`selectedItemList` exclusion is not sufficient and the popper anchoring needs
re-examining — do not add delays.

Original evidence follows.

### F1 — dropdown option list reads as 1 item, selection fails (2 occurrences)

```
Opening dropdown for State
Found 1 options for State
No exact match found, trying partial match for State
Option 'Indiana' not found for State
```

Identical shape for "how did you hear about us" → `Option 'LinkedIn' not found`.

**CAUSE CONFIRMED** from `tools/Phone-inspectElement.png` and
`tools/School-inspectElement.png`. It is the wrong-listbox theory. Not a timing
problem — **adding delay will never fix this.**

Workday renders an open dropdown into a **popper portal at the very end of
`<body>`, outside `#root`**:

```html
<body>
  <div id="root"> …entire page… </div>
  <div style="z-index:30;position:absolute" data-popper-placement="bottom">
    <div visibility="opened">
      <ul role="listbox" id="z7h36" class="css-18ub1qj">   ← the real options
        <li role="option"><div>Fax</div></li>
        <li role="option" aria-selected="true"><div>Mobile</div></li>
```

But *inside* `#root`, every multiselect pill widget (School, Field of Study,
Country Phone Code) contains its own listbox holding the selected pills:

```html
<ul role="listbox" data-automation-id="selectedItemList" aria-label="items selected">
  <li role="presentation">
    <div role="option" data-automation-id="selectedItem"
         aria-label="Purdue University, Calumet, press delete to clear value.">
```

`document.querySelector('ul[role="listbox"]')` is unscoped, so it returns the
**first in document order** — a `selectedItemList` with exactly one selected pill.
Hence "Found 1 options", every time, regardless of which dropdown was opened.

This also explains the user's original complaint that autofill works
*intermittently*: whether it breaks depends on whether any pill widget happens to
be populated earlier in the DOM at that moment.

Fix direction: scope to the open dropdown. Exclude
`[data-automation-id="selectedItemList"]`, and/or anchor on the portal
(`[data-popper-placement]`, `[visibility="opened"]`). Do **not** just take the
last match — verify visibility.

Affects `selectWorkdayDropdown`, `handleDropdown`, `handleDateDropdown`, and
`handleLanguages`, all of which use the same unscoped query.

### F2 — FIXED in `13bfedc`, both halves. Awaiting a real run.

Was worse than first recorded — the input lookup was only half of it.

**Half 1, the input.** No `searchBox` exists. `findSearchInputIn` resolves
`label[for]` first (Workday points it straight at the input), then falls back
through `searchBox` → `multiselectInputContainer` → `hiddensearch` → any text
input. Required the F3 container fix in `bc6abf7` to land first.

**Half 2, the pills.** `promptOption` is *also* the selected pill's text, next
to a `DELETE_charm`. Every lookup was unscoped, so the "wait for suggestions"
resolved instantly off a pill already on the page, and "click the first option"
**could click a pill and clear a correct value**. All lookups now go through
`getOpenPromptOptions()`.

**Also closed a gap the fix would have opened.** A multiselect keeps its value
in a pill, not in `input.value`, so the old idempotency check protected nothing
— it only looked safe while the input was unfindable. Re-running would have
added a *second* pill. Now guarded on an existing `selectedItem`.

**DECIDED by the user, 2026-08-07:** the picker *should* guess rather than leave
a blank, and should take the option **closest to the stored value**. Implemented
in `2cbd112` — Dice coefficient over word tokens (order- and
punctuation-insensitive), falling back to the first suggestion only when nothing
shares a token. Note this is the opposite of the F4 degree decision, and
deliberately so: degree lists are short closed vocabularies where a wrong pick
is a clear error, while school lists are long and a near-miss is usually the
right entry under a different name.

### F2 — original analysis (superseded, kept for context)

```
Could not find searchBox for school
Could not find searchBox for field of study
```

**CAUSE CONFIRMED** from `tools/School-inspectElement.png`. There is no
`searchBox` on this form. School and Field of Study are multiselect widgets:

```html
<div data-automation-id="formField-school" data-fkit-id="education-20--school">
  <label for="education-20--school">
  <div data-automation-id="multiSelectContainer" data-uxi-widget-type="multiselect">
    <div data-automation-id="multiselectInputContainer">
      <div data-automation-hiddensearch="false">   ← the search input lives here
```

Also a trap for the existing fallback: `data-automation-id="promptOption"` is
used for the **selected pill's** text, not only for dropdown suggestions —

```html
<p data-automation-id="promptOption" data-automation-label="Purdue University, Calumet">
```

so `handleSearchablePicker`'s "click the first promptOption" fallback can click
an already-selected pill. Any fix must scope promptOption lookups to the open
dropdown portal, same as F1.

### F3 — PARTLY FIXED in `bc6abf7`; one call site deliberately left alone

Four of the five sites widened to `[data-automation-id^="formField"]`:
`fillGPA`, `handleSearchablePicker`, `autoAnswerRadioExact`, `autoAnswerRadio`.

`handleSearchablePicker`'s site turned out to be a **contributing cause of F2** —
it always fell through to `label.parentElement`, a wrapper too narrow to hold
the input. Necessary but not sufficient: the `searchBox` selector is still wrong
(see F2), so F2 is not yet fixed.

**RESOLVED 2026-08-08 — do NOT widen `collectLabelTexts`. Question closed.**

`tools/captures/my-information.json` settles it. Every **visible** field on the
page already resolves its label via `label[for]` — all 12 of them. The only
fields that would *gain* a label from a widened container lookup are the four
with `labelVia: "NONE"`, and **all four are `visible: false`**.

`fillFieldByFuzzyLabel` filters on `input:not([type="hidden"])` but never checks
visibility, so those four are excluded today only because they have no label
text. Widening would hand them their container's label and make them fillable —
writing profile data into hidden inputs for zero gain, since nothing visible
needs the third strategy. The existing exact match is correct. Leave it.

Original reasoning, now confirmed by evidence rather than inference:
Widening it does not merely repair a dead lookup — it enlarges the candidate set
`fillFieldByFuzzyLabel` writes into. Workday points a multiselect's `<label for>`
at the widget container div, not the inner search `<input>`, so those inputs
carry no label text today and are never written to. Give them their container's
label and a fuzzy key could `setNativeValue` raw text into the School or Field
of Study search box. **Do not widen it without a full-form capture in
`tools/captures/` to model against.**

### F3 — original analysis (superseded, kept for context)

`fillFieldByFuzzyLabel`, `fillGPA`, and `autoAnswerRadioExact` all use:

```js
input.closest('div[data-automation-id="formField"]')
```

That is an **exact** attribute match. Workday actually emits
`formField-school`, `formField-degree`, `formField-gradeAverage` — confirmed on
three separate fields. The selector therefore never matches on this form, and
the third label-resolution strategy is silently dead. Only `aria-label` and
`label[for]` are doing any work.

Fix is a prefix match (`[data-automation-id^="formField"]`), but check each of
the three call sites separately — widening the container changes which label a
field resolves to, so re-run the label-collision model afterwards.

### F4 — **VERIFIED FIXED** on a real run, 2026-08-07

User confirmed the degree fills correctly. **Do not revisit.**

Fixed in `913d56f`. The user writes a degree as `BS`, `Bachelor of Science` or
`Bachelors`; the option list uses whichever of those the tenant prefers. The
generic exact → case-insensitive → substring chain connects none of them, and
the apostrophe in `Bachelor's Degree` breaks it on its own.

It also **mis-picked**: `"bachelor of science".includes("ba")` is true via
"**BA**chelor", so a BA silently selected a BS whenever science was listed first.

`matchDegreeOption` reduces both sides to a level (+ field where stated).
Passed explicitly to the degree dropdown only — the matcher param defaults to
`null`, so Country/State keep literal matching. On genuine ambiguity
("Bachelors" against both BA and BS) it returns nothing rather than guessing.

Modelled over six realistic option lists: 29 new fills, 1 corrected mis-pick,
0 regressions. Harness worth rebuilding if this is touched again.

**DOM-confirmed** against `tools/Degree-inspectElement.png`, the real Duke list:

    Select One | High School/GED | Associates | Bachelors | Masters | Doctorate

8 previously-failing inputs (`BS`, `Bachelor of Science`, `Bachelor's Degree`,
`MS`, `Master's Degree`, `MBA`, `PhD`, `High School Diploma`) now resolve.
The `Select One` placeholder carries `aria-disabled="true"` and is never
selectable — its level resolves to `null`, so it is filtered out. Still worth a
real-run confirmation, but this is no longer resting on modelling alone.

That capture also confirms `aria-selected="true"` marks the chosen row (class
`css-164unwy` vs `css-152hpre`), matching the Country capture — which is why the
`2017a55` commit check keys on `aria-selected`.

### F5 — option highlights but never commits (user-reported, 2026-08-07)

Fixed in `d5ea89a`, **corrected in `2017a55`** — read this whole entry before
touching it. Reported as "hovers over the correct country but doesn't select it".

**The original diagnosis was wrong.** `tools/FoundbutNotSelected.png` shows
`aria-selected="true"` on the United States of America row with the trigger
already reading "United States of America". Country **does** select. It simply
never closes, and the stale menu then poisoned every later dropdown via F6.
That is what made it look unselected.

So the commit check must be `aria-selected` / node detachment, **never** popper
teardown — teardown reads this success as a failure. The pointer replay below is
still worth keeping for widgets that genuinely ignore a bare click, but it has
not yet been shown to be necessary on any observed field.

`el.click()` dispatches **only** a click event — no pointerdown/mousedown/mouseup.
Workday rows commonly commit on `mousedown` so the menu tears down before blur,
so the bare click reached no handler. The hover state is CSS `:hover` and proves
only that the right row was found.

`commitOptionSelection()` clicks, verifies the popper actually tore down, and
only then replays a full pointer sequence on the **leaf** text element (handlers
may sit on the inner `<div>` while `OPTION_SELECTOR` returns the `<li>`; events
bubble up so the leaf covers both). **Escalation only** — nothing extra fires
when the plain click already worked, so multiselect widgets cannot toggle a
freshly-set value back off.

Routed: `handleDropdown`, `selectWorkdayDropdown` (all three match paths),
`handleDateDropdown`. Still clicking directly and **not yet investigated**:
`handleSearchablePicker` (675), `handleLanguages` (821/836/852),
`selectByAriaLabel` (1153). If a picker or language selection shows the same
highlight-but-no-commit symptom, route it through the same helper.

### Confirmed working (do not touch)

`addressLine1`, `postalCode`, resume skip-if-uploaded, language skip-if-exists,
all three disclosure auto-declines, and `answerYesNo` on "previously worked for
Duke Energy".

## F7 — Country not autofilled at all (TRIAGED — likely an empty profile field)

**The user set Uzbekistan by hand**, to test whether autofill would correct it
to United States of America. It did not. So the defect is not a wrong pick —
it is that Country is **never written**.

**ROOT CAUSE FOUND, fixed in `c5b0f75`.** Console said:

    Workday Autoplay: No dropdown trigger found for country

The trigger was never located, so the matching and commit logic **were never
reached and were never at fault**. Two earlier hypotheses were wrong and are
recorded here only so they are not retried: the empty-profile-value theory (the
user confirms Country is filled) and the discarded-commit-result theory (real,
worth fixing on its own, but not what caused this).

`handleDropdown` matched only a `<label>` whose **direct `text()`** contains the
key. A Workday dropdown is a `<button>`, which takes no `<label>`; its
accessible name is in `aria-label` — `"Country Uzbekistan Required"`.
`selectWorkdayDropdown` always had that fallback, which is exactly why Degree
worked and Country never did. `findDropdownTrigger` now tries label text →
label string value → button aria-label.

**Lesson worth keeping:** the two dropdown helpers had drifted apart, and the
weaker one was silently failing. When fixing one, check the other.

**Confirmed by the user: autofill WAS re-run after Uzbekistan was set, and did
not correct it. This is a real defect.**

Ruled out by reading, so do not re-derive:
- The early skip `trigger.innerText.includes(value)` — "Uzbekistan" does not
  contain "United States of America", nor "US"/"us" (`.includes` is
  case-sensitive), so it would not short-circuit.
- Wrong trigger from the XPath — `formField-country` precedes
  `formField-countryPhoneCode` in document order, so the "country" key resolves
  to the right button.

**Separate real defect, also fixed — the commit result was being thrown away.**
`handleDropdown` called `commitOptionSelection` and **discarded its return
value**, then logged `Found option …` and returned. So a run where the click
never committed produced a console that reads as a clean success while the field
kept its old value. That is exactly the shape of what happened here. Fixed in
`9750779`, which now warns on a failed commit.

Not the cause of F7, but a genuine reporting bug in its own right: a failed
commit was indistinguishable from a success. If a future run shows
`Selected … but it did not commit`, the defect is in `commitOptionSelection` for
that widget — most likely the `aria-selected` / `isConnected` check, or the
600ms window. **Do not add blanket delays**; instrument first.

`2a84daf` and `9750779` add logging on every previously-silent path
(`!value`, no trigger, already-set skip, option count, commit result).
Console-only apart from the failed-commit warning.

**Do not "fix" the country matching logic on this evidence.** Nothing has shown
it picking wrongly; it has not been shown to run at all.

The name-field collision below is REAL but only reachable from the manual
Uzbekistan state, so it is not worth fixing yet. Recorded so it is not
re-derived from scratch if a non-US country ever comes up for real.

**Next evidence needed:** set Country to something wrong, run autofill, then
capture the console. The decisive lines are whether `Found dropdown trigger for
country` appears at all, and what follows it.

    "ariaLabel": "Country Uzbekistan Required", "currentText": "Uzbekistan"

The profile is a US address (Highland, IN). With Uzbekistan selected, Workday
re-renders the name section with local-script variants, and the two Western
Script inputs come back **sharing one id**:

    id "name--legalName--lastName", name "legalName--firstName", label "Given Name - Western Script*"
    id "name--legalName--lastName", name "legalName--lastName",  label "Given Name - Western Script*"

`collectLabelTexts` resolves the label via `document.querySelector('label[for=…]')`,
which returns the first match, so **both inputs report the same label**. Then:

- `fillFieldByFuzzyLabel(['first name','given name'], firstName)` — no label
  contains "first name", so the `given name` key wins and hits three fields:
  the Uzbek local one and **both** Western Script inputs. None matches exactly,
  so all three are filled. **The first name is written into the last name field.**
- `fillFieldByFuzzyLabel(['last name','family name','surname'], lastName)` — no
  label contains "last name"; `family name` hits only the Uzbek local field. The
  real `legalName--lastName` never receives the last name at all.

Note this is *not* the substring collision fixed in `6059719` — that fix works
correctly here. The defect is Workday emitting a duplicate `id`, which defeats
label resolution no matter how the matching is ordered. A fix would have to
disambiguate on something other than the label: the `name` attribute, or the
enclosing `formField-legalName--firstName` / `formField-legalName--lastName`
container, both of which *are* distinct in the capture.

## Release state — v1.3, not yet shipped

Manifest bumped to `1.3`. `package.ps1` uses an explicit include list, so the
screenshots, `tools/captures/`, `LOOP_PROMPT.md` and this file are already
excluded from the upload zip — nothing to change there.

**The one remaining blocker is verification, and only the user can clear it.**
~890 lines of `content.js` changed against `master`. Verified on a real form:
F1, F6. Unverified: F2, F3, F5, F7.

**F4's verification is STALE.** It was confirmed at `913d56f`, but `c5b0f75`
later rewrote how every dropdown trigger is found, Degree's included. It needs
re-confirming against the shipping code.

Run Tests 11–15 in `TESTING_CHECKLIST.md` before uploading. **Test 14 matters
most** — it covers paths that already worked and were touched anyway (dates,
disclosure radios, names, languages, resume). A regression there is worse than a
fix that failed to land, because nobody is looking for it.

**F8 is now IN the branch (`9d24fc2`) and therefore in v1.3's scope.** It was
built after the release plan was written, at the user's prompting, once they
supplied `<legend>` captures. It is unverified. Either test it (see Test 16) or
revert that commit before shipping — it is a single self-contained commit.

**F9 and F10 are NOT for v1.3.** Newly found, never worked, no regression.
Gender is already supported — see F9.

Do not ship B2, B3 or B5 in this release. New UI alongside 890 changed lines
means a breakage cannot be attributed. **B1 and B4 are both in**, and both are
exempt for the same reason: they are popup-only. B1 is CSS plus placeholder
text; B4 reads `.value` and writes classes and text. Neither can affect what
gets written to a form. B6 turned out to be shipped already.

The rule this sets for the rest of Track B: **a QoL item may ship inside a
release whose autofill is unverified only if it cannot touch autofill.** B2 and
B3 instrument `setNativeValue` and `commitOptionSelection`, so they fail that
test and wait for v1.4.

## OBSERVED FAILURES — BCBSLA tenant, 2026-08-09

New evidence, and the first from a **second Workday tenant**. Screenshots:
`tools/LegallyAuthorized.png`, `RequireSponsorship.png`, `Ethnicity.png`,
`HowDidYouHearAboutUs.png`. None of these is a regression — all three classes
have never worked.

### F8 — FIXED in `9d24fc2`, unverified. `<legend>` questions were invisible

`findQuestionBlocks` now collects question text from **`label` and `legend`**,
deduped by container, and `answerYesNo` falls through to `answerDropdownYesNo`
when a block has no matching radios. Yes/No is matched **exactly** — "No" is a
substring of "None of the above" and "Not applicable" — and the aria-disabled
"Select One" placeholder is excluded, since it carries `aria-selected="true"`
while nothing has been chosen.

The legend's text is nested one level deeper in a `rich-label` div, so
`innerText` is used rather than a text node. Same trap as `c5b0f75`.

Keywords added, both observed: `legally eligible`, `eligible to work`.

**The 18+ question now has its own profile field** (`79e9c99`, user-approved
schema change). An attestation card at the top of Job Preferences,
`jobPreferences.isAtLeast18`, defaulting to **false**.

- Unticked means **unanswered, not "No"** — the question is left for the user
  and the console says so. Answering "No" to being 18 or older because a box was
  never ticked would be far worse than a blank.
- **`'18 years of age'` was removed from `authKeywords`** and now lives only in
  `ageKeywords`. In both lists, the wording "Are you at least 18 years of age?"
  was claimed by two groups and whichever ran first won — so unchecking work
  authorization could have answered No to an age question. **Do not put it back**;
  there is a comment at the call site saying so.

Modelled over all eight question texts from three tenants: each routes to
exactly one keyword group, no collisions.

**Known limitation, not yet hit:** `answerYesNo` returns after the first
matching block, so if one page ever asks two questions of the same class only
the first is answered. No observed case — do not restructure speculatively.

### F8 — original analysis (superseded, kept for context)

**`content.js` contains zero references to `legend`.** Every question lookup in
the file starts from `<label>`. Workday's "Application Questions" pages do not
use labels — the question text lives in a `<legend>` inside a `<fieldset>`:

```html
<div data-automation-id="formField-7de30e72cc43011e68ec2a6aee01125e"
     data-fkit-id="primaryQuestionnaire--7de30e72cc43011e68ec2a6aee01125e">
  <fieldset>
    <legend>…question text…</legend>
    <button aria-haspopup="listbox" aria-label=" No Required"
            name="7de30e72cc43011e68ec2a6aee01125e">No</button>
```

There is **no other hook**. The `formField-*` id is a GUID, not a semantic name,
and the button's `aria-label` is just the current value plus "Required"
(`" No Required"`) — it does not contain the question at all. The `<legend>` is
the only place the question text exists, so `findDropdownTrigger` cannot reach
these and neither can `answerYesNo` or the radio helpers.

Confirmed unanswered on BCBSLA: "Are you legally authorized to work in the
United States?", "Will you now or in the future require employer sponsorship…?",
"Do you have any relatives who work at BCBSLA?" — all left on "Select One"
despite the matching Job Preferences toggles being set.

Fix direction: add `<legend>` as a question-text source everywhere `<label>` is
used, anchored via `fieldset` → the `button[aria-haspopup="listbox"]` inside it.
Highest value of the three: these are required questions on nearly every
application, and the same `primaryQuestionnaire--*` shape recurs across tenants.

### F9 — demographics label variants do not match

Both of these have a working `formField-*` hook and fail only on label wording:

| Form label | Code looks for | Result |
|---|---|---|
| `Spanish/Hispanic/Latino` | `'Hispanic or Latino'` | no substring match — fails |
| `Are you a Veteran?` | `'Veteran Status'` | no substring match — fails |

`formField-hispanicOrLatino` and `formField-veteranStatus` are both present and
stable (`tools/Ethnicity.png`), and are a far better anchor than label prose.
Note the veteran question here offers Yes/No, not "I decline to self-identify",
so the *desired value* needs rethinking too, not just the lookup.

Gender and Ethnicity on the same page **do** fill correctly — their labels
("Please Specify Your Gender", "Please Specify Your Ethnicity") contain the
searched substrings. This is purely a wording-coverage gap.

### F10 — hierarchical "How Did You Hear About Us?" picker unsupported

BCBSLA does not use a flat dropdown here. It is a **drill-down multiselect**:
pick a category ("Job Board"), then a leaf ("Job Board - Linkedin").

```html
<div role="option" data-automation-id="menuItem" aria-label="Job Board - Linkedin not checked"
     style="height:32px;left:0px;position:absolute;top:96px;width:100%;">
  <div data-automation-id="promptLeafNode" data-uxi-widget-type="multiselectlistitem"
       data-automation-checked="Not Checked">
    <div data-automation-id="promptOption" data-automation-label="Job Board - Linkedin">
```

Three things make this harder than it looks: the leaf value is
`"Job Board - Linkedin"` rather than `"LinkedIn"`, the rows are **absolutely
positioned** (a virtualized list, so not all leaves are in the DOM at once), and
reaching a leaf requires clicking into its category first. Substring matching on
`"linkedin"` would work *once inside the category* — the navigation is the
missing piece, not the matching.

Lowest priority of the three: one field, one tenant so far, and the most work.

## Friction log — observed, not imagined

Track B work must trace to an entry here. Every one of these was hit during real
sessions; do not add speculative entries.

| # | Friction | Evidence |
|---|---|---|
| L1 | Diagnosing any failure requires the user to open DevTools, screenshot the console, and paste it back | happened 5+ times on 2026-08-07/08 |
| L2 | A silently skipped field looks identical to a correctly filled one | Country read "United States of America" for weeks — that was Workday's own default, not autofill |
| L3 | `popup.html:65` gives Country `placeholder="United States of America"`, which reads as a value | produced a wrong root-cause hypothesis on 2026-08-08 — **fixed, `b22ec81`** |
| L4 | Capturing DOM evidence means pasting `tools/inspect-workday-form.js` into DevTools by hand | every capture so far |
| L5 | An empty profile field is skipped with no warning anywhere in the UI | the `!value` path had no log until `2a84daf` — **fixed in the panel, `1f72a78`** (B4). Still silent on the job page; that is B2/B3 |
| L6 | The loop prompt lived only in a terminal transcript and was lost when it closed | start of the 2026-08-07 session |

L6 is fixed — the prompt now lives in `LOOP_PROMPT.md`.

## Track B candidates — quality of life

**Audience: college students applying for jobs. No software background, no
interest in debugging, nobody reads docs.** Ranked by that, not by how
interesting the change is. See the AUDIENCE TEST in `LOOP_PROMPT.md`.

**B1 — Placeholder/value disambiguation. DONE in `b22ec81`.** There was no
`::placeholder` rule at all, so hints rendered at browser default and, against
this dark card, read as real text. Now muted + italic, and every placeholder
that could plausibly *be* a user's answer is prefixed `e.g.`. Date fields use
format hints (`MM` / `YYYY`) instead of sample values; end dates read
`MM or Present`. Addresses L3.

**B2 — Show what got filled.** Briefly outline each field autofill wrote, on the
page. Addresses L2. Needs no explanation, adds no step, and answers the question
every first-time user actually has: *did it work?* Must be purely visual and
must not alter values.

**B3 — Plain-language result summary.** After a scan, say something like
"Filled 14 fields. Please check: State, School." Addresses L1 and L2.
**Wording is the whole risk here** — never counts-and-jargon like
`Filled 14 · Skipped 3 · Failed 2`, never a field's internal name. Name the
human-readable label, or say nothing about it. `scanAndFill` already knows all
of this and throws it away.

**B4 — Profile completeness hints. DONE in `1f72a78`.** A muted card at the top
of the panel names the blank fields — *"Autofill will leave these blank: State
(Full Name), GPA, Work Experience."* — plus a line saying that is a valid
choice. Blank fields get a **dashed** border, the same quiet register as B1's
italic placeholders, rather than a fourth accent colour. Addresses L5.

Four decisions worth not re-litigating:

- **Names come from the visible `<label>`**, never the element id. Same rule as
  B3. `#skills` is the one tracked field with no label of its own, so it has an
  explicit override; anything else added later without a label will surface as
  a raw id, which is the bug to watch for.
- **An untouched profile shows nothing at all.** When every tracked field is
  blank — fresh install, or straight after Delete all data — the card is hidden.
  Listing 19 blanks at someone who has typed nothing is the exact nagging the
  Track B rule forbids.
- **A blank end date on a current role is not a blank.** `work-current` being
  ticked excludes that card's end month/year.
- **The list stops at six** and collapses the rest to `and N more`.

Popup-only. It reads `.value` and writes classes and text; it touches no storage
schema, no message, and nothing in `content.js`. That is why it was safe to put
in v1.3 while B2/B3/B5 wait — see the release-state section.

Verified under jsdom against nine profile states (fresh, partial, complete,
current vs past role, overflow, question-shaped labels, live typing). The
harness is scratch, not committed — there is still no test runner here.

**B5 — "Report a problem" button.** Consumer framing of what would otherwise be
a developer feature: one click gathers the diagnostic info and puts it on the
clipboard to send on. Addresses L4. **Only worth it framed this way** — a
button labelled "Copy diagnostics JSON" fails the audience test outright.

**B6 — Back up / restore my info. ALREADY SHIPPED — this entry was stale.**
Export and Import exist under a "Backup" section (`popup.js:382`, `popup.html`),
named "Export" / "Import" with the helper *"Save your profile to a file, or
restore it on another computer"*. The word JSON appears nowhere in the UI, as
the entry asked. Nothing to do.

### Rejected or reclassified

- **Copy-diagnostics-as-a-developer-tool.** Fails the audience test: useful only
  to someone debugging, and an extra on-screen control that a confused user must
  rule out. Survives only as B5's consumer framing.
- **Multi-entry sections (2nd+ job, 2nd+ school).** Changes which values get
  written, so by the Track B rule it is Track A feature work, not QoL. Stays in
  the candidate list below.
- **Any settings panel, verbosity toggle, or "advanced mode".** Adding a
  decision the user has to make is the specific thing this audience cannot
  afford. Do not propose one.

## Candidate areas (unstarted, roughly highest value first)

1. `retryAsync` is unused — decide its fate.
2. `handleTerms` / `checkCheckbox` use `input.click()` without checking visibility.
3. `uploadResume` sets `hasUploadedResume = true` inside a `forEach`, so it flips
   after the first input even if later ones fail.
4. Multi-entry sections (2nd+ job, 2nd+ school) — only `[0]` is ever read from
   `workExperience` and `education`.
5. `checkCheckbox` shares the same substring-collision class that
   `fillFieldByFuzzyLabel` was just fixed for, and still uses `matchesAny` +
   `forEach`. It clicks *every* matching checkbox. Not yet investigated — do not
   assume the same fix applies, since checking several boxes is sometimes correct.

## Method note (worth repeating)

Before editing matching logic, model the change against a list of realistic
Workday labels and diff old-vs-new selections. Doing that this iteration caught a
regression in the *first* proposed fix: preferring exact matches globally made
`['linkedin','website','url']` fill "Website" and leave "LinkedIn Profile" empty.
The key-ordered variant fixed that. Reasoning about substring collisions unaided
is unreliable — test them.

---

## Iteration log

Append one line per firing. Keep it short.

- `2026-08-07` — Loop restructured: moved to `autofill-loop` branch, added this
  notes file, added `node --check` gate, cadence 45m→4h. No code change.
- `2026-08-07` — Fixed `fillFieldByFuzzyLabel` multi-field writes (candidate #2).
  Still no DOM capture available; fix was validated against a modelled label set,
  not a real form. Needs confirming on the Duke Energy pages.
- `2026-08-07` — DOM screenshots captured. F1, F2 root causes confirmed; F3 found.
- `2026-08-07` — **F1 fixed** (scoped listbox lookup, 4 call sites). Awaiting a
  real-run console log to confirm. F2 and F3 still open.
- `2026-08-07` — Two new user-reported failures. **F5 fixed** (`d5ea89a`,
  verified option commit + pointer replay). **F4 fixed** (`913d56f`, degree
  level/field matching, modelled old-vs-new). F1, F4, F5 all now awaiting the
  same real-run verification; F2 and F3 still open.
- `2026-08-07` — New screenshots from an 18:17 run on `c2787de`. **F1 VERIFIED
  FIXED** (250 options, was 1). Found **F6**: stacked poppers + "biggest list
  wins" made every dropdown after Country read Country's 250 options — the
  actual cause of the surviving Indiana/LinkedIn failures. Fixed in `2017a55`,
  which also corrects F5's commit check (Country selects but never closes, so
  teardown was the wrong signal). F2, F3 still open; F4 still unverified.
  **Lesson: two of three "fixes" this session were aimed at the wrong cause
  until a screenshot arrived. Weight real DOM evidence far above code reading.**
- `2026-08-07` — Autonomous check. New `tools/Degree-inspectElement.png`
  **DOM-confirms F4** against the real option list. **F3 partly fixed**
  (`bc6abf7`, four of five sites); `collectLabelTexts` left exact on purpose,
  reasoning recorded both in the notes and inline at the call site. F2 still
  open and now known to need two fixes, not one. Next blocker is a real run:
  F4, F5, F6 are all fixed-but-unverified.
- `2026-08-07` — Real run on the fixed branch. **F6 VERIFIED FIXED**
  (`Found 61 options for State`, was 250). F1 and F6 are now both closed against
  real console output. F4 and F5 still need confirming from the same run —
  whether Indiana actually *selected*, not merely that the right list was read.
- `2026-08-07` — Autonomous check. **F2 fixed** (`13bfedc`) from
  `tools/School-inspectElement.png`: no `searchBox` exists, and `promptOption`
  doubles as the selected pill's text so the old fallback could clear a correct
  value. Also pre-empted a duplicate-pill regression the fix would otherwise
  have exposed. **All six observed failures now have a fix in the branch.**
  Nothing further is worth changing from static reading — every remaining item
  needs either a real run or a user decision.
- `2026-08-07` — **F4 VERIFIED FIXED** by the user. Picker guessing decided:
  guess, closest-to-stored-value, implemented in `2cbd112` and modelled. F1, F4
  and F6 are now closed against real runs. **Only F2, F3 and F5 remain
  unverified**, and all three need a run on a login-gated form.
- `2026-08-08` — First full-form capture landed (`tools/captures/my-information.json`).
  **`collectLabelTexts` question CLOSED — do not widen**, every visible field
  already resolves via `label[for]` and the only gainers are four invisible
  fields. Logged **F7**: Country reads Uzbekistan against a US profile, and the
  duplicate `id` Workday emits underneath it makes the first name overwrite the
  last name. Untriaged on purpose — the cause of the country value must be
  established before anything downstream of it is touched.
- `2026-08-17` — Track B review ahead of the Store upload. **B4 done**
  (`1f72a78`), popup-only, so it ships inside v1.3 without muddying the
  attribution of an autofill regression; that exemption is now written down as a
  rule in the release-state section. **B6 was already shipped** — the entry was
  stale, corrected. B2/B3 deferred to v1.4 with the cheap route recorded:
  `setNativeValue` (14 call sites) and `commitOptionSelection` (8) are the two
  choke points every write passes through, so instrumenting those two covers
  everything except checkboxes and radios without touching matching logic. The
  `fill_complete` message already exists and carries no payload. **The release
  blocker is unchanged and is not code: Tests 11–17 have not been run.**
  Note the 08-09 session (F8, the 18+ attestation, the panel redesign) never got
  a log entry — read the commits for it.
