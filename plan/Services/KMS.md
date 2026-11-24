---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# KMS

**Phase 1 - MVP** · back to [[00 Home]]

One customer-managed key (~$1/month) used by [[DynamoDB]] and [[S3 Resumes]]. Key policy grants
use only to the Lambda roles that need it. Rotation on. See [[Security and Privacy]].
