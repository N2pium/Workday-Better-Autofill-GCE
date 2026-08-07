# Autofill Improvement Loop — Shared Notes

**This file is the loop's memory.** Each iteration starts with a cold context window.
Read this file FIRST, and update it LAST. Without it, the loop re-derives the same
"problems" every firing and churns the same functions back and forth.

Branch: `autofill-loop` (never commit to `master` — it is published-extension source)

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

**`retryAsync` is currently dead code** — defined but never called. Either use it
or remove it; do not leave it as decoration.

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

### F1 — dropdown option list reads as 1 item, selection fails (2 occurrences)

```
Opening dropdown for State
Found 1 options for State
No exact match found, trying partial match for State
Option 'Indiana' not found for State
```

Identical shape for "how did you hear about us" → `Option 'LinkedIn' not found`.

Exactly **1** option on two structurally different dropdowns. That constancy is
the clue — a partially-rendered list would give varying counts. Leading theories,
NOT yet distinguished:
  - `document.querySelector('ul[role="listbox"]')` takes the *first* listbox in
    document order, which may not be the one that just opened.
  - Workday renders a single placeholder/search row before real options load.

**Do not fix this by adding another delay before confirming which it is.** The
fix differs completely between the two causes. Needs a DOM dump of an *open*
dropdown.

### F2 — searchable picker never finds its input (2 occurrences)

```
Could not find searchBox for school
Could not find searchBox for field of study
```

`handleSearchablePicker` looks for `input[data-automation-id="searchBox"]`.
Duke Energy's education section either does not use that automation id, or the
label → `formField` container traversal does not reach it.

### Confirmed working (do not touch)

`addressLine1`, `postalCode`, resume skip-if-uploaded, language skip-if-exists,
all three disclosure auto-declines, and `answerYesNo` on "previously worked for
Duke Energy".

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
