---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# DynamoDB

**Phase 1 - MVP** · back to [[00 Home]]

One on-demand table, point-in-time recovery on, encrypted with the [[KMS]] key.

| PK | SK | Item |
|---|---|---|
| `USER#<sub>` | `PROFILE#<id>` | a profile |
| `USER#<sub>` | `APP#<ISO ts>#<id>` | an application ([[F05 Application Tracker]]) |
| `USER#<sub>` | `RESUME#<id>` | resume metadata ([[F02 Resume Vault]]) |
| `USER#<sub>` | `QUOTA#AI#<date>` | AI usage counter, TTL ([[ai-svc]]) |
| `USER#<sub>` | `ANSWER#<id>` | saved answer ([[F11 Answer Library]]) |

- Query `PK = USER#x AND begins_with(SK, "APP#")` lists applications newest-first.
- DynamoDB Stream on new `APP#` items -> creates reminders ([[EventBridge Scheduler]]).
- Why not RDS: see [[Key Decisions]] #3.
