---
type: feature
phase: 2
status: planned
tags:
  - easyapply
  - feature
---

# F02 Resume Vault

**Phase 2 - AI** · back to [[00 Home]] · [[Roadmap]]

## Problem
Today there is one local resume file.

## What it does
Store several resume versions and pick one per job; the extension attaches the chosen one.

## Built with
- [[resume-svc]]
- [[S3 Resumes]]
- [[KMS]]
- [[DynamoDB]]

## Flows
- [[Flow - Resume upload and parse]]

## Notes
- Uploads go straight from the browser to S3 with a presigned URL - the API never handles the file bytes.
- Max size ~5 MB, PDF/DOCX only, checked by content type and size.
