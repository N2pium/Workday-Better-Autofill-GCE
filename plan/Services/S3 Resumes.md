---
type: service
phase: 2
status: planned
tags:
  - easyapply
  - service
---

# S3 Resumes

**Phase 2 - AI** · back to [[00 Home]]

Private bucket, Block Public Access on, SSE-KMS with the [[KMS]] key, TLS-only bucket policy.

- Key layout: `users/<sub>/resumes/<id>.pdf`.
- Browser uploads directly with a presigned URL from [[resume-svc]].
- `ObjectCreated` event -> [[SQS]] -> [[parse-worker]].
- Lifecycle rule: delete incomplete multipart uploads after 1 day.
