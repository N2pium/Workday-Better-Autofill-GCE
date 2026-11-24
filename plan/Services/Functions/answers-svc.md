---
type: service
phase: 2
status: planned
tags:
  - easyapply
  - service
---

# answers-svc

**Phase 2 - AI** · back to [[00 Home]]

[[Lambda]] (TypeScript) behind [[API Gateway]]. CRUD for the [[F11 Answer Library]] plus a
match endpoint.

| Route | Does |
|---|---|
| `GET /answers?category=` | list saved answers |
| `POST /answers` | save an accepted answer |
| `PATCH/DELETE /answers/{id}` | edit, delete |
| `POST /answers/match` | question + char limit + role -> ranked candidates |
| `POST /answers/{id}/used` | bump `uses` / `lastUsedAt` |

Items: `USER#<sub>` / `ANSWER#<id>` in [[DynamoDB]]. Deleted by [[Flow - Delete account]]
automatically (same partition).
