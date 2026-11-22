---
type: service
phase: 2
status: planned
tags:
  - easyapply
  - service
---

# Bedrock

**Phase 2 - AI** · back to [[00 Home]]

Managed access to Claude models. Used by [[parse-worker]] (resume -> JSON) and [[ai-svc]]
(answers, match score, cover letters, follow-up drafts).

- The main variable cost - cap calls per user per day ([[Cost]]).
- A small, fast model is enough for parsing and short answers.
- Never receives demographic data ([[Security and Privacy]]).
