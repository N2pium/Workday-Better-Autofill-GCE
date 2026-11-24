---
type: feature
phase: 3
status: planned
tags:
  - easyapply
  - feature
---

# F06 Remote Adapter Packs

**Phase 3 - Adapters** · back to [[00 Home]] · [[Roadmap]]

## Problem
There is no live form to test against, and every selector fix needs a Web Store release.

## What it does
Selectors and field mappings live in versioned JSON packs served from the cloud, so a broken Workday tenant can be fixed in minutes without republishing.

## Built with
- [[S3 Adapter Packs]]
- [[CloudFront]]
- [[Chrome Extension]]

## Flows
- [[Flow - Load adapter pack]]

## Notes
- **Data only, never code** (Chrome Web Store MV3 policy) - see [[Key Decisions]] #4.
- Packs are hash-pinned or signed; a fallback copy is bundled in the extension.
- Portfolio highlight: solves a problem documented in `SHARED_TASK_NOTES.md`.
