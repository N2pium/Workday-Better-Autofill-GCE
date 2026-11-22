---
type: plan
tags:
  - easyapply
---

# Roadmap

Colours on the [[Architecture.canvas|board]]: green = phase 1, purple = 2, cyan = 3, yellow = 4.

## Phase 0 - Guardrails
- [x] Budget alert `Monthly-Total` ($10/mo, 50/80/100% actual + 100% forecast) - see [[Budgets]]
- [ ] Spend limit in AWS Settings > Billing (~$15-20)
- [ ] Cost Anomaly Detection (free)
- [ ] Rewrite `PRIVACY_POLICY.md` draft - see [[Security and Privacy]]

## Phase 1 - MVP
- [ ] CDK app skeleton (TypeScript) - [[CDK and CI-CD]]
- [ ] [[Cognito]] user pool + Google sign-in + extension redirect URI
- [ ] [[API Gateway]] HTTP API + JWT authorizer + throttling
- [ ] [[DynamoDB]] single table, PITR on
- [ ] [[profile-svc]] - [[F01 Accounts and Profile Sync]]
- [ ] [[tracker-svc]] - [[F05 Application Tracker]]
- [ ] Extension: sign-in, opt-in sync toggle, log application after autofill - [[Chrome Extension]]
- [ ] [[Web Dashboard]] on [[CloudFront]] + S3
- [ ] [[Flow - Delete account]] endpoint
- [ ] Alarms + dashboards - [[Observability]]

## Phase 2 - AI
- [ ] [[S3 Resumes]] + [[resume-svc]] - [[F02 Resume Vault]]
- [ ] [[SQS]] + [[parse-worker]] + [[Bedrock]] - [[F03 Resume Parsing]]
- [ ] [[ai-svc]] with per-user daily quota - [[F04 AI Answers and Match Score]]

## Phase 3 - Adapters
- [ ] Adapter pack JSON schema + interpreter in `content.js` - [[F06 Remote Adapter Packs]]
- [ ] [[S3 Adapter Packs]] behind [[CloudFront]], bundled fallback
- [ ] [[telemetry-ingest]] + [[Firehose]] + [[Athena]] - [[F07 Failure Telemetry]]
- [ ] Lever, then Ashby packs - [[F09 More Job Sites]]

## Phase 4 - Engagement
- [ ] [[EventBridge Scheduler]] + [[reminder-worker]] + [[SES]] - [[F08 Follow-up Reminders]]
- [ ] [[F10 Insights]] on the dashboard
- [ ] Follow-up email drafts (via [[ai-svc]])
