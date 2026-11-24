---
type: service
phase: 2
status: planned
tags:
  - easyapply
  - service
---

# SQS

**Phase 2 - AI** · back to [[00 Home]]

Standard queue between [[S3 Resumes]] upload events and [[parse-worker]], with a dead-letter
queue after 3 failed attempts. Decouples the UI from [[Bedrock]] latency
([[Key Decisions]] #5).
