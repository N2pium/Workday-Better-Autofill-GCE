---
type: decision
tags:
  - easyapply
---

# Key Decisions

## 1. Lambda On-Demand behind an API Gateway HTTP API
Traffic is bursty and idle most of the time, so it should scale to zero. HTTP API is about
70% cheaper per request than REST API, and we need none of REST's extra features (usage
plans, request transforms, caching).
*Rejected:* always-on container (pays for idle), REST API (cost), Lambda@Edge (not
allowed in this AWS project). See [[Lambda]] and [[API Gateway]].

## 2. TypeScript everywhere
The extension, backend and [[CDK and CI-CD|CDK]] all use one language, so types can be
shared (profile schema, adapter-pack schema).

## 3. DynamoDB single table keyed by user
Every access is per user (get profile, list applications by date), so a relational
database adds cost (~$12-15/mo minimum for RDS) without benefit. Point-in-time recovery on.
See [[DynamoDB]].

## 4. Adapter packs are data, not code
The Chrome Web Store bans remotely hosted executable code in MV3. Packs hold only JSON
(selectors, label aliases, field-type hints). The interpreter stays in `content.js`. Packs
are hash-pinned or signed, and a fallback copy ships inside the extension.
See [[F06 Remote Adapter Packs]].

## 5. Heavy work is asynchronous
Resume parsing runs from a queue ([[SQS]] -> [[parse-worker]]) so the UI never waits on
[[Bedrock]]. Short AI answers are called synchronously and streamed back.

## 6. Local-only mode stays
Sync is opt-in. The extension must keep working with no account. See [[Security and Privacy]].

## 7. Single Region
All Regional resources in **us-east-2**. Only [[CloudFront]] (global) and its optional WAF
live in us-east-1. No cross-Region replication, no StackSets.

Exception: [[Bedrock]] Claude models in us-east-2 are only offered through cross-Region
inference profiles. We call from us-east-2 with the **US** profile (`us.anthropic.*`),
which can process in us-east-1/2 or us-west-2. The project SCP explicitly allows this;
nothing is stored outside us-east-2, and `PRIVACY_POLICY.md` says so.

## 8. AI answers without streaming at first
The HTTP API can't stream responses. A ~200-word draft from a fast model takes a few
seconds, so v1 returns the whole answer behind a spinner and reuses the existing API and
JWT authorizer unchanged. Upgrade path if it feels slow: a Lambda Function URL in
`RESPONSE_STREAM` mode with JWT verification in code (`aws-jwt-verify`).
See [[ai-svc]], [[Flow - AI answer]].

## 9. TypeScript and Python, split by component
TypeScript for CDK and the API Lambdas (including [[ai-svc]] and [[answers-svc]]) - shared
auth, quota and validation code, CDK's first-class language. Python for [[parse-worker]]
(PDF/DOCX libraries) and telemetry analysis ([[Athena]] scripts). The profile schema is
defined once in zod and exported as JSON Schema, which the Python side validates against.
