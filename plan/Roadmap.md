---
type: plan
tags:
  - easyapply
---
# Roadmap

Colours on the [[Architecture.canvas|board]]: green = phase 1, purple = 2, cyan = 3, yellow = 4.

## Phase 0 - Guardrails
- [x] Budget alert `Monthly-Total` ($10/mo, 50/80/100% actual + 100% forecast) - see [[Budgets]]
- [x] Spend limit in AWS Settings > Billing (~$15-20)
- [x] Cost Anomaly Detection (free) - monitor `AWS-Services`, daily email when impact >= $3
- [x] Rewrite `PRIVACY_POLICY.md` draft - see [[Security and Privacy]] (draft only; rebuild `docs/index.html` with `node design/build-privacy.mjs` at the 2.0 release)

## Phase 1 - MVP
Backend code lives in `cloud/` (see `cloud/README.md`). Deployed to us-east-2 on 2026-11-22 and smoke-tested.
- [x] CDK app skeleton (TypeScript) - [[CDK and CI-CD]] (code; 24 tests passing)
- [x] [[Cognito]] user pool + extension redirect URI (deployed; dev email sign-in)
- [x] Google sign-in, alongside email; same-email accounts are linked (2026-11-22)
- [x] [[API Gateway]] HTTP API + JWT authorizer + throttling (deployed)
- [x] [[DynamoDB]] single table, PITR on (deployed)
- [x] [[profile-svc]] - [[F01 Accounts and Profile Sync]] (deployed)
- [x] [[tracker-svc]] - [[F05 Application Tracker]] (deployed)
- [x] Deploy the three stacks to us-east-2 (bootstrap first)
- [x] Extension sign-in / sign-out / delete cloud account - [[Chrome Extension]], [[Flow - Sign in]] (`cloud-auth.js`; optional host permissions, requested on Sign in)
- [x] Extension: welcome screen (Sign in / Create account / Continue without an account) - [[Chrome Extension]]
- [x] Extension: opt-in profile sync toggle - [[F01 Accounts and Profile Sync]] (`cloud-sync.js`; one "default" profile, version-checked, conflicts ask)
- [x] Extension: log application after autofill, with Undo - [[F05 Application Tracker]] (`cloud-tracker.js`)
- [x] Side panel overhaul: Home / Profile / Applications / Settings tabs
- [x] Resume -> profile (pulled forward from phase 2): `POST /resumes/parse`, Claude Haiku 4.5 reads the PDF/DOCX directly, file never stored - [[F03 Resume Parsing]]
- [x] Bedrock: Anthropic use-case form submitted; resume parsing live-tested OK (2026-11-22)
- [x] [[Web Dashboard]] on [[CloudFront]] + S3 (`dashboard/`, stacks EasyApply-Web + -WebContent)
- [x] [[Flow - Delete account]] endpoint (deployed)
- [x] Alarms - [[Observability]] (SNS topic; email via `-c alarmEmail=`; resume-surge + throttle alarms added)

## Phase 2 - AI
- [x] [[S3 Resumes]] + [[resume-svc]] - [[F02 Resume Vault]] (`/resumes`, presigned POST, max 10, `cloud-vault.js`)
- [~] ~~[[SQS]] + [[parse-worker]]~~ replaced by synchronous `POST /resumes/parse` (phase 1) - [[F03 Resume Parsing]]
- [x] [[ai-svc]] with per-user daily quota - [[F04 AI Answers and Match Score]] (`/ai/*`; on-page Draft button `ai-assist.js`; match score on Home)
- [x] [[answers-svc]] + library UI in the extension - [[F11 Answer Library]] (`/answers`, `cloud-library.js`, Saved answers card)
- [x] Service-wide daily AI caps on top of the per-user ones (2026-11-24): 300 AI calls + 2000 categorisations/day across all users (`SERVICE#QUOTA`) - see [[Cost]]

## Release 2.0 (2026-11-24)
- [x] Manifest 2.0, privacy policy trimmed to what 2.0 does, live at the GitHub Pages URL (PR #3 merged)
- [x] Store listing + privacy-practices answers (`design/store/`); `package.ps1` builds the zip from what the manifest loads
- [x] Submitted to the Chrome Web Store (ID `ecakdhppcmlicpbkfihabojaklbdklff`, pending review); ID added to the [[Cognito]] extension client
- [ ] After approval: test store-version sign-in (email + Google); ship 2.0.1 with the autofill fixes made since (build 2026-11-24c)

## Phase 3 - Adapters
- [ ] Adapter pack JSON schema + interpreter in `content.js` - [[F06 Remote Adapter Packs]]
- [ ] [[S3 Adapter Packs]] behind [[CloudFront]], bundled fallback
- [ ] [[telemetry-ingest]] + [[Firehose]] + [[Athena]] - [[F07 Failure Telemetry]]
- [ ] Lever, then Ashby packs - [[F09 More Job Sites]]

## Phase 4 - Engagement
- [ ] [[EventBridge Scheduler]] + [[reminder-worker]] + [[SES]] - [[F08 Follow-up Reminders]]
- [x] [[F10 Insights]] on the dashboard (2026-11-24): `GET /insights`, stat tiles, weekly chart, status breakdown
- [x] Application flow (Sankey) by industry / company / role, with per-application industry and status history (2026-11-24) - [[F10 Insights]]
- [ ] Follow-up email drafts (via [[ai-svc]])

## Later - Polish
- [ ] Theme customization: user-picked accent colour in Settings (keep warm-dark as the default)
