---
type: component
phase: 1
status: planned
tags:
  - easyapply
  - component
---

# Chrome Extension

**Phase 1 - MVP** · back to [[00 Home]]

The existing MV3 extension (`content.js`, `greenhouse.js`, side panel `popup.*`).

## Changes for the cloud
- Sign-in with `chrome.identity.launchWebAuthFlow` -> [[Cognito]] - see [[Flow - Sign in]].
- Opt-in sync toggle; signed-out mode keeps today's behaviour.
- After a successful autofill, log the application via [[tracker-svc]].
- Load [[S3 Adapter Packs]] (phase 3) with a bundled fallback.
- Send scrubbed failure events (phase 3) - [[F07 Failure Telemetry]].
- New permission needed: `identity`. Host permission for the API domain.
