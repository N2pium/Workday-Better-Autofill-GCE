---
type: service
phase: 3
status: planned
tags:
  - easyapply
  - service
---

# S3 Adapter Packs

**Phase 3 - Adapters** · back to [[00 Home]]

Bucket of versioned JSON packs, e.g. `adapters/workday@v12.json`, served via [[CloudFront]].

```json
{
  "site": "workday", "version": 12, "sha256": "...",
  "fields": [
    { "key": "phone", "labels": ["Phone Number", "Mobile"],
      "selector": "[data-automation-id='phone-number'] input", "type": "text" }
  ]
}
```

- **Data only.** The interpreter lives in `content.js` - [[Key Decisions]] #4.
- Extension caches the pack and falls back to a bundled copy.

Features: [[F06 Remote Adapter Packs]], [[F09 More Job Sites]]
