---
type: component
phase: 1
status: planned
tags:
  - easyapply
  - component
---

# Web Dashboard

**Phase 1 - MVP** · back to [[00 Home]]

React single-page app hosted on S3 behind [[CloudFront]]. Signs in with [[Cognito]], calls
[[API Gateway]] with the JWT.

Pages: applications table ([[F05 Application Tracker]]), profiles, resumes
([[F02 Resume Vault]]), insights ([[F10 Insights]]), account / delete.
