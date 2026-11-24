---
type: feature
phase: 1
status: planned
tags:
  - easyapply
  - feature
---

# F01 Accounts and Profile Sync

**Phase 1 - MVP** · back to [[00 Home]] · [[Roadmap]]

## Problem
Today you move your profile between machines by exporting and importing JSON.

## What it does
Sign in once, and your profile follows you to every Chrome. Several named profiles (e.g. "SWE", "Data Analyst") and a picker in the side panel.

## Built with
- [[Cognito]]
- [[API Gateway]]
- [[profile-svc]]
- [[DynamoDB]]
- [[KMS]]

## Flows
- [[Flow - Sign in]]
- [[Flow - Profile sync]]

## Notes
- Sync is **opt-in**; the extension keeps working signed-out.
- Conflict rule: last write wins per profile, using a `version` counter.
- Demographic answers are excluded from sync unless field-level encrypted.
