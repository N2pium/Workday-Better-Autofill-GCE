---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# Cognito

**Phase 1 - MVP** · back to [[00 Home]]

User pool with Google as a social identity provider, managed login, authorization code +
PKCE.

- Two app clients: [[Chrome Extension]] (redirect `https://<extension-id>.chromiumapp.org/`)
  and [[Web Dashboard]].
- Issues the JWTs that [[API Gateway]] validates.
- The user `sub` becomes the `USER#<sub>` partition key in [[DynamoDB]].
- Free up to 10k monthly active users.
