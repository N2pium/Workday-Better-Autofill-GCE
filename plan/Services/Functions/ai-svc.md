---
type: service
phase: 2
status: planned
tags:
  - easyapply
  - service
---

# ai-svc

**Phase 2 - AI** · back to [[00 Home]]

[[Lambda]] behind [[API Gateway]]. Calls [[Bedrock]] for free-text answers, cover letters,
match scores and follow-up drafts.

- Checks and increments a per-user daily quota item in [[DynamoDB]] (`QUOTA#AI#<date>`, TTL).
- Never sends demographic fields. Streams the answer back.

Feature: [[F04 AI Answers and Match Score]] · Flow: [[Flow - AI answer]]
