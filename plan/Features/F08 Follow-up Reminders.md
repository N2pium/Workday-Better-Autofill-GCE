---
type: feature
phase: 4
status: planned
tags:
  - easyapply
  - feature
---

# F08 Follow-up Reminders

**Phase 4 - Engagement** · back to [[00 Home]] · [[Roadmap]]

## Problem
Nothing happens after you apply.

## What it does
"No response in 14 days - follow up?" emails, with an optional AI-drafted follow-up.

## Built with
- [[DynamoDB]]
- [[EventBridge Scheduler]]
- [[reminder-worker]]
- [[SES]]

## Flows
- [[Flow - Follow-up reminder]]

## Notes
- One-time schedule per application; deleted when status changes or account is deleted.
- SES starts in sandbox: request production access before real users.
