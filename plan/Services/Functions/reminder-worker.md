---
type: service
phase: 4
status: planned
tags:
  - easyapply
  - service
---

# reminder-worker

**Phase 4 - Engagement** · back to [[00 Home]]

[[Lambda]] invoked by [[EventBridge Scheduler]]. Checks the application is still in
`applied` status, then sends the follow-up email via [[SES]].

Feature: [[F08 Follow-up Reminders]] · Flow: [[Flow - Follow-up reminder]]
