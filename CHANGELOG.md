# Changelog

## 1.3 — 2026-08-17

The dropdown release. Country, State, Degree, School and Field of Study are the
fields that failed most often, and all of them shared one cause: the extension
was reading options from the wrong dropdown.

### Fixed

- **Country and State now select reliably.** Workday leaves an old dropdown open
  behind the new one, and the extension was reading whichever list was longest —
  which meant every dropdown after Country was matched against Country's 250
  countries. It now reads the list belonging to the field it is filling.
- **Degree matches whichever wording a form uses.** A stored "Bachelor of
  Science" now matches "Bachelors", "Bachelor's Degree" or "BS" by degree level
  and field of study, instead of looking for the exact phrase.
- **School and Field of Study fill correctly**, and running autofill twice on the
  same page no longer leaves a duplicate entry behind.
- **Dropdowns are found by their accessible label**, not only by visible label
  text, so fields that Workday labels differently are no longer skipped.
- **First and last name land in their own fields** on pages where Workday emits
  the same element id twice.

### New

- **Application Questions pages are answered.** Some employers put the question
  text in a `<legend>` rather than a label — "Are you legally authorized to work
  in the United States?", "Will you now or in the future require sponsorship?"
  Those pages were invisible to the extension before and were left blank.
- **"I am 18 years of age or older" is now its own setting**, in Job Preferences.
  See the upgrade note below.
- **The panel tells you which fields it will leave blank.** On a job page a
  skipped field looks exactly like a filled one, so the panel now names the ones
  it will pass over. Blank is still a perfectly valid choice — nothing is
  required and nothing is marked as an error.
- **Redesigned side panel.**

### Changed

- Placeholder hints no longer read as answers you have already given. Country
  previously showed "United States of America" as a placeholder, which looked
  identical to a saved value; hints are now muted and italic, prefixed `e.g.`,
  and date fields show `MM` / `YYYY` rather than sample dates.

### Upgrade note

**Your saved profile carries over untouched.** Nothing is cleared, reset, or
re-entered, and the update requests no new permissions.

One behaviour does change. Version 1.2 answered "Are you 18 years of age or
older?" with Yes automatically. That question is now tied to the new checkbox in
Job Preferences, which starts **unticked**, so it will be left for you to answer
until you tick it once and save. This is deliberate: the old behaviour asserted
your age on a legal document on your behalf, and the same wording was shared
with the work-authorization keywords, so unticking "Legally Authorized to Work"
could answer *No* to a question about your age.
