---
type: service
phase: 1
status: live
tags:
  - easyapply
  - service
---

# tracker-svc

**Phase 1 - MVP** · back to [[00 Home]]

[[Lambda]] behind [[API Gateway]]. Create, list and update applications (`APP#...` items) in
[[DynamoDB]]. Also computes per-user [[F10 Insights]].

Routes: `GET/POST /applications`, `PATCH/DELETE /applications/{id}`, `GET /insights`.
- Each application keeps `statusHistory` (string set, `ADD` on every status change) and an optional `industry` label.
- `GET /insights` reads only `status, appliedAt, company, role, industry, statusHistory`, max 2000 items.

Feature: [[F05 Application Tracker]] · Flow: [[Flow - Log an application]]
