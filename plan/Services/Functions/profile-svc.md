---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# profile-svc

**Phase 1 - MVP** · back to [[00 Home]]

[[Lambda]] behind [[API Gateway]]. CRUD for profiles in [[DynamoDB]] (`PROFILE#<id>` items),
plus the account-deletion entry point.

Feature: [[F01 Accounts and Profile Sync]] · Flows: [[Flow - Profile sync]], [[Flow - Delete account]]
