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
- [[Flow - Answer from library]] - saved answers are offered before a new draft ([[F11 Answer Library]])

## Notes
- Per-user daily quota (counter item with TTL in DynamoDB).
- The user always reviews AI text before it goes into a form.
- Demographic data is never included in prompts.
- v1 is not streamed - see [[Key Decisions]] #8.
- The job description is untrusted page text: it goes in a delimited block and the
  prompt says to treat it as data. Output is only shown to the user, so the risk is low.
- Reply length is capped from the text box's character limit (`maxTokens` always set).
