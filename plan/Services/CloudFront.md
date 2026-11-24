---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# CloudFront

**Phase 1 - MVP** · back to [[00 Home]]

Global CDN. Serves the [[Web Dashboard]] (phase 1) and [[S3 Adapter Packs]] (phase 3) from
private S3 buckets using Origin Access Control.

- 1 TB/month transfer free, so ~$0 at this scale.
- Optional AWS WAF must live in us-east-1 - skip until there is real traffic ([[Cost]]).
