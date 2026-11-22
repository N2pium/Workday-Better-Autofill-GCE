---
type: plan
tags:
  - easyapply
---
befo
# Roadmap

Colours on the [[Architecture.canvas|board]]: green = phase 1, purple = 2, cyan = 3, yellow = 4.

## Phase 0 - Guardrails
- [x] Budget alert `Monthly-Total` ($10/mo, 50/80/100% actual + 100% forecast) - see [[Budgets]]
- [x] Spend limit in AWS Settings > Billing (~$15-20)
- [x] Cost Anomaly Detection (free) - monitor `AWS-Services`, daily email when impact >= $3
- [x] Rewrite `PRIVACY_POLICY.md` draft - see [[Security and Privacy]] (draft only; rebuild `docs/index.html` with `node design/build-privacy.mjs` at the 2.0 release)

## Phase 1 - MVP
Backend code lives in `cloud/` (see `cloud/README.md`). "code" = written and tested, not yet deployed.
- [x] CDK app skeleton (TypeScript) - [[CDK and CI-CD]] (code; 24 tests passing)
- [ ] [[Cognito]] user pool + Google sign-in + extension redirect URI (code; needs extension ID + Google OAuth client to deploy)
- [ ] [[API Gateway]] HTTP API + JWT authorizer + throttling (code)
- [ ] [[DynamoDB]] single table, PITR on (code)
- [ ] [[profile-svc]] - [[F01 Accounts and Profile Sync]] (code)
- [ ] [[tracker-svc]] - [[F05 Application Tracker]] (code)
- [ ] Deploy the three stacks to us-east-2 (bootstrap first)
- [ ] Extension: sign-in, opt-in sync toggle, log application after autofill - [[Chrome Extension]]
- [ ] [[Web Dashboard]] on [[CloudFront]] + S3
- [ ] [[Flow - Delete account]] endpoint (code)
- [ ] Alarms + dashboards - [[Observability]] (alarms in code, no notification target yet)

## Phase 2 - AI
- [ ] [[S3 Resumes]] + [[resume-svc]] - [[F02 Resume Vault]]
- [ ] [[SQS]] + [[parse-worker]] + [[Bedrock]] - [[F03 Resume Parsing]]
- [ ] [[ai-svc]] with per-user daily quota - [[F04 AI Answers and Match Score]] (no streaming at first - [[Key Decisions]] #8)
- [ ] [[answers-svc]] + library UI in the extension - [[F11 Answer Library]]

## Phase 3 - Adapters
- [ ] Adapter pack JSON schema + interpreter in `content.js` - [[F06 Remote Adapter Packs]]
- [ ] [[S3 Adapter Packs]] behind [[CloudFront]], bundled fallback
- [ ] [[telemetry-ingest]] + [[Firehose]] + [[Athena]] - [[F07 Failure Telemetry]]
- [ ] Lever, then Ashby packs - [[F09 More Job Sites]]

## Phase 4 - Engagement
- [ ] [[EventBridge Scheduler]] + [[reminder-worker]] + [[SES]] - [[F08 Follow-up Reminders]]
- [ ] [[F10 Insights]] on the dashboard
- [ ] Follow-up email drafts (via [[ai-svc]])
