---
type: component
phase: 1
status: live
tags:
  - easyapply
  - component
---

# Web Dashboard

**Phase 1 - MVP** · back to [[00 Home]]

Plain HTML/CSS/JS (no framework, no third-party code; `dashboard/`) hosted on S3 behind
[[CloudFront]]. Signs in with [[Cognito]] (code + PKCE), calls [[API Gateway]] with the JWT.

One page, top to bottom:
- **Insights** ([[F10 Insights]]): stat tiles, applications per week, status breakdown.
- **Application flow**: Sankey by industry / company / role ([[F10 Insights]]).
- **Applications table** ([[F05 Application Tracker]]): company, role, industry (editable), applied date, status, notes, delete.
- **Synced profile** summary ([[F01 Accounts and Profile Sync]]).

Not built yet: resumes page ([[F02 Resume Vault]] lives in the extension), account / delete (in the extension's Settings).
