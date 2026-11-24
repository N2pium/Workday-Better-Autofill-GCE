# Autofill Improvement Loop — v2

The canonical loop prompt. Paste the fenced block below into `/loop`.

Kept in the repo on purpose: v1 existed only in a terminal transcript and was
lost when the terminal closed. Edit it here, not in the terminal.

**Changed in v2:** added a second track for quality-of-life work, so the loop
stays productive while correctness fixes are blocked awaiting a real run — which
is the normal state of this project, not the exception.

---

```
AUTOFILL IMPROVEMENT LOOP v2 (safety-gated). Follow these steps in order.

STEP 0 — ABORT CHECKS. Run `git branch --show-current`. If it is NOT
`autofill-loop`, STOP immediately and report that the loop is on the wrong
branch. Never commit to `master` — it is the source of a published Chrome
extension. Also run `git status --porcelain`; if the tree has unrelated
uncommitted changes, STOP and report rather than committing someone else's work.

STEP 1 — READ MEMORY. Read `SHARED_TASK_NOTES.md` in full before anything else.
It records what has already been changed, what was considered and deliberately
rejected, the observed-failure list, the friction log, and the candidate lists
for both tracks. Do NOT re-propose anything under "Considered and deliberately
NOT done". Do NOT redo anything in the "Already done" table. Where a note says a
question is CLOSED or a decision was made by the user, treat that as settled.

STEP 2 — PICK AT MOST ONE THING, from either track.

  TRACK A — CORRECTNESS. A concrete defect you can point at in the code, with a
  described failure scenario. Not a style preference, not a refactor, not "add
  more error handling" in general. If you cannot describe a realistic input or
  DOM state that produces a wrong result, it does not qualify.

  TRACK B — QUALITY OF LIFE. A change that makes the extension easier to run,
  easier to trust, or easier to diagnose. To qualify it must:
    - trace to a specific entry in the "Friction log" in the notes, or to
      something the user actually said;
    - NOT change which values get written into which fields — QoL work is about
      the surface around autofill, not autofill's decisions;
    - be independently revertible in one commit;
    - not alter the stored profile schema, or what is persisted, without
      explicit user sign-off recorded in the notes;
    - pass the AUDIENCE TEST below.

  AUDIENCE TEST — apply to anything a user can see. This tool's users are mainly
  college students applying for jobs. Assume no software background, no interest
  in debugging, and no one reads documentation. A Track B change FAILS if it:
    - adds a step, a setting, a mode, or a decision the user has to make;
    - puts engineering vocabulary on screen — "dropdown trigger", "listbox",
      "commit", "selector", "DOM", "JSON", "console", "log" are all disqualifying
      in user-visible text, however accurate;
    - would make a first-time user hesitate about what to do next;
    - is only useful to someone diagnosing a bug.
  The single question to ask: would a student who has never opened DevTools
  understand this without being told? If no, it belongs in the console — which
  normal users never open, and where jargon is fine — or it does not ship.

  Prefer removing a step over adding information. An extra button that helps
  nobody but the developer is a net loss: it is one more thing on screen that a
  confused user has to rule out. When a diagnostic capability is genuinely
  needed, give it a plain-language consumer framing ("Report a problem") rather
  than a technical one ("Copy diagnostics JSON").

  WHICH TRACK: if every open Track A item is blocked awaiting a real run on a
  live Workday form, prefer Track B. That is the usual state here. Do not invent
  speculative Track A work to fill the gap — this file's history shows that
  reasoning about the DOM without a capture produces fixes aimed at the wrong
  cause.

  ALWAYS ALLOWED, and preferred when a diagnosis is stuck: make the next failure
  self-diagnosing. Console-only instrumentation of a silent path counts as Track
  B and needs no further justification. This has repeatedly been the highest-value
  change available — the `No dropdown trigger found for country` line found F7's
  root cause in one run after two wrong hypotheses.

STEP 3 — NO-CHANGE IS A VALID OUTCOME. If nothing meets the bar on either
track, make no code change. Append a dated "no change needed" line to the
iteration log and commit only that. Three consecutive no-change iterations means
the loop should be stopped pending real-form testing — say so and stop.

STEP 4 — IMPLEMENT NARROWLY. The smallest edit that does the job. Do not
opportunistically reformat, rename, or clean up adjacent code.

STEP 5 — HARD VERIFICATION GATE. Run:
  node --check content.js && node --check popup.js && node --check background.js
  && node --check greenhouse.js && node --check greenhouse-main.js
If ANY file fails to parse, revert with `git checkout -- <file>` and report.
DO NOT COMMIT unparseable code. Not optional, never skipped.

STEP 5b — MODEL IT, IF IT IS MATCHING LOGIC. Before changing any code that
decides which option or field a value goes to, model old-vs-new over a realistic
list and diff the selections. Build the harness in the scratchpad. Reasoning
about substring collisions unaided has been wrong on this file more than once;
modelling has caught a regression every time it was used.

STEP 6 — SELF-REVIEW. Re-read your own diff with `git diff`. Did I change
behavior I did not intend? Did I touch a path unrelated to the item? Narrow it.

STEP 7 — COMMIT AND UPDATE MEMORY. Commit the change AND the updated
`SHARED_TASK_NOTES.md` together. Move the item out of its candidate list, add it
to "Already done" with the commit hash, and append one short line to the
iteration log. Record which track it came from. Do not push. Do not merge to
master. The user reviews this branch manually.

HARD CONSTRAINTS, all tracks:
  - The extension is published and handles PII (resume, address, phone, email).
    Regressions reach real users.
  - Users are mainly college students with no software background. Never surface
    engineering detail to them. Console output is exempt — they never open it.
  - Never add a network call, analytics, telemetry, or any off-device transmission.
    Profile values may appear in the local console; they may never leave the machine.
  - Never widen a Chrome permission in manifest.json without explicit user sign-off.
  - The user has said autofill already works well. The bar for touching working
    code is high. Prefer no change over a speculative change.

Report at the end: which track, what you changed and why, or that you made no
change and why not.
```
