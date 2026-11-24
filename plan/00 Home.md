---
type: home
tags:
  - easyapply
---

# EasyApply Cloud - Home

Moving **Workday: Better Autofill** (EasyApply) from a local-only Chrome extension to an
AWS serverless backend. AWS project: paid plan, Region **us-east-2**.

## Start here
- [[Architecture.canvas|Architecture board]] - the whole system on one whiteboard
- [[Roadmap]] - the 4 phases as checklists
- [[Key Decisions]] - why each big choice was made
- [[Security and Privacy]] - the rules that matter most (this is PII)
- [[Cost]] - what it costs and what to avoid

## Features
| # | Feature | Phase |
|---|---|---|
| 1 | [[F01 Accounts and Profile Sync]] | 1 |
| 2 | [[F02 Resume Vault]] | 2 |
| 3 | [[F03 Resume Parsing]] | 2 |
| 4 | [[F04 AI Answers and Match Score]] | 2 |
| 5 | [[F05 Application Tracker]] | 1 |
| 6 | [[F06 Remote Adapter Packs]] | 3 |
| 7 | [[F07 Failure Telemetry]] | 3 |
| 8 | [[F08 Follow-up Reminders]] | 4 |
| 9 | [[F09 More Job Sites]] | 3 |
| 10 | [[F10 Insights]] | 4 |
| 11 | [[F11 Answer Library]] | 2 |

## Components
- Clients: [[Chrome Extension]], [[Web Dashboard]]
- Edge and auth: [[CloudFront]], [[Cognito]], [[API Gateway]]
- Compute: [[profile-svc]], [[tracker-svc]], [[ai-svc]], [[resume-svc]], [[answers-svc]], [[parse-worker]], [[reminder-worker]], [[telemetry-ingest]]
- Data: [[DynamoDB]], [[S3 Resumes]], [[S3 Adapter Packs]], [[KMS]]
- Async and AI: [[SQS]], [[Bedrock]], [[EventBridge Scheduler]], [[SES]]
- Analytics: [[Firehose]], [[Athena]]
- Ops: [[Observability]], [[CDK and CI-CD]], [[Budgets]]

## Flows (sequence diagrams)
[[Flow - Sign in]] · [[Flow - Profile sync]] · [[Flow - Log an application]] ·
[[Flow - Resume upload and parse]] · [[Flow - AI answer]] · [[Flow - Load adapter pack]] ·
[[Flow - Telemetry]] · [[Flow - Answer from library]] · [[Flow - Follow-up reminder]] · [[Flow - Delete account]]

---

## Using Obsidian (the 5 things you need)
1. **Click any `[[link]]`** to jump to that note. Ctrl+click opens it in a new tab.
2. **Ctrl+O** - quick switcher: type part of any note name to open it.
3. **Ctrl+G** - graph view. Colours: green = features, blue = AWS services, orange = flows,
   purple = decisions/plan notes.
4. **Architecture.canvas** - a whiteboard. Scroll to zoom, drag to pan, double-click a card to
   open its note. Card colour = phase (see the legend on the board).
5. **Properties** at the top of each note (type, phase, status) - change `status` from
   `planned` to `building` / `done` as you go.

Tick boxes in [[Roadmap]] by clicking them. Everything here is plain Markdown in
`EasyApply/plan/`, so it also renders on GitHub.
