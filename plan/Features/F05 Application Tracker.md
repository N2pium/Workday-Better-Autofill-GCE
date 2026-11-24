---
type: feature
phase: 1
status: planned
tags:
  - easyapply
  - feature
---

# F05 Application Tracker

**Phase 1 - MVP** · back to [[00 Home]] · [[Roadmap]]

## Problem
Users lose track of where they applied.

## What it does
Every autofill logs company, role, URL, date and status; the web dashboard lists and filters them.

## Built with
- [[tracker-svc]]
- [[DynamoDB]]
- [[Web Dashboard]]
- [[CloudFront]]

## Flows
- [[Flow - Log an application]]

## Notes
- Status values: applied, screening, interview, offer, rejected, ghosted.
- Sort key `APP#<ISO timestamp>#<id>` gives date-ordered listing for free.
