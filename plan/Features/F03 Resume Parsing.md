---
type: feature
phase: 2
status: planned
tags:
  - easyapply
  - feature
---

# F03 Resume Parsing

**Phase 2 - AI** · back to [[00 Home]] · [[Roadmap]]

## Problem
Typing your work history in by hand is the slowest part of setup.

## What it does
Upload a PDF and the profile's experience and education are filled in for review.

## Built with
- [[S3 Resumes]]
- [[SQS]]
- [[parse-worker]]
- [[Bedrock]]
- [[DynamoDB]]

## Flows
- [[Flow - Resume upload and parse]]

## Notes
- Result is a **draft** the user approves - never overwrite a profile silently.
- Structured output: ask Bedrock for JSON matching the profile schema, then validate.
