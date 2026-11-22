---
type: feature
phase: 2
status: planned
tags:
  - easyapply
  - feature
---

# F04 AI Answers and Match Score

**Phase 2 - AI** · back to [[00 Home]] · [[Roadmap]]

## Problem
Autofill skips free-text questions ("Why this company?") completely.

## What it does
Draft answers to free-text questions, cover letters, and a match score between the profile and the job description.

## Built with
- [[ai-svc]]
- [[Bedrock]]
- [[DynamoDB]]

## Flows
- [[Flow - AI answer]]

## Notes
- Per-user daily quota (counter item with TTL in DynamoDB).
- The user always reviews AI text before it goes into a form.
- Demographic data is never included in prompts.
