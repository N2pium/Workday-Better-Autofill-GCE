---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# Observability

**Phase 1 - MVP** · back to [[00 Home]]

- CloudWatch Logs (retention 14 days), structured JSON logs via Powertools.
- X-Ray tracing across [[API Gateway]] -> [[Lambda]] -> [[DynamoDB]] / [[Bedrock]].
- Alarms: Lambda errors and throttles, API 5xx rate, [[SQS]] dead-letter depth.
