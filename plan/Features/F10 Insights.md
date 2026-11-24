---
type: feature
phase: 4
status: done
tags:
  - easyapply
  - feature
---

# F10 Insights

**Phase 4 - Engagement** · back to [[00 Home]] · [[Roadmap]]

## Problem
The project looks like a script, not a product. A job search needs to show where applications stall.

## What it does
On the [[Web Dashboard]] (shipped 2026-11-24):
- **Insights panel**: total applications, response rate, interviews, offers; applications per week (last 12 weeks); count per status.
- **Application flow**: a Sankey of the whole pipeline, groups -> Applied -> OA / Screen -> Technical round -> Offer, with each stage's exits (No response, Rejected, Withdrawn, In progress). Toggle the groups between **industry**, **company** and **role** (role family from the job title: Software engineering, Data & AI, ...). Top 6 groups + "Other".
- **Industry** is a free-text label per application (suggestions: Cloud & SaaS, Fintech, AI & data, Consumer tech, ...), set in the dashboard table.

## How it works
- `GET /insights` in [[tracker-svc]] reads the caller's own `APP#` items (max 2000, `truncated` past that) and computes everything on demand. No AI, nothing new stored, no [[Athena]].
- Applications keep a `statusHistory` string set (every status ever held), added on create and on each status change, so a rejection is placed after the furthest stage reached. Records from before 2026-11-24 have no history: their first status change backfills the status being replaced; until then a rejection counts as straight from Applied.
- Response: `{ total, byStatus, weekly, responseRate, funnel: { industry|company|role: [{ name, total, paths: [{ reached, outcome, count }] }] }, truncated, generatedAt }`.
- Chart: hand-drawn SVG in `dashboard/app.js` (CSP allows no third-party code); categorical palette validated on the card surface; hover titles and a screen-reader table.

## Built with
- [[tracker-svc]]
- [[DynamoDB]]
- [[Web Dashboard]]

## Flows
- (none: one read on dashboard load, refreshed after a status or industry edit)

## Notes
- Response rate = (screening + interview + offer + rejected) / (total - withdrawn).
- Not yet: response rate by resume version (needs the resume version on the application record).
- Aggregate trends across users (opt-in, anonymised) could use [[Athena]] later.
