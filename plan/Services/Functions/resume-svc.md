---
type: service
phase: 2
status: planned
tags:
  - easyapply
  - service
---

# resume-svc

**Phase 2 - AI** · back to [[00 Home]]

[[Lambda]] behind [[API Gateway]]. Returns short-lived presigned PUT/GET URLs for
[[S3 Resumes]] and records `RESUME#<id>` metadata in [[DynamoDB]].

Feature: [[F02 Resume Vault]] · Flow: [[Flow - Resume upload and parse]]
