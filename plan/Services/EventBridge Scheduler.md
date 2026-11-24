---
type: service
phase: 4
status: planned
tags:
  - easyapply
  - service
---

# EventBridge Scheduler

**Phase 4 - Engagement** · back to [[00 Home]]

One-time schedules, one per application: "in 14 days, invoke [[reminder-worker]]". Created
from the [[DynamoDB]] stream when an `APP#` item is inserted; deleted when status changes
or the account is deleted ([[Flow - Delete account]]).
