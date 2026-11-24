---
type: service
phase: 2
status: planned
tags:
  - easyapply
  - service
---

# parse-worker

**Phase 2 - AI** · back to [[00 Home]]

[[Lambda]] triggered by [[SQS]]. Extracts text from the uploaded resume, asks [[Bedrock]] for
JSON matching the profile schema, validates it, and saves a **draft** profile in [[DynamoDB]].

Failed messages go to a dead-letter queue. Feature: [[F03 Resume Parsing]]
