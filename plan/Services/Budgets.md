---
type: service
phase: 1
status: done
tags:
  - easyapply
  - service
---

# Budgets

**Phase 1 - MVP** · back to [[00 Home]]

- Budget `Monthly-Total`: $10/month, emails at 50%, 80%, 100% actual and 100% forecast.
  Created 2026-11-22. Alerts are daily, not real-time.
- Spend limit set in AWS Settings > Billing (hard stop, owner only).
- Cost Anomaly Detection (created 2026-11-22): monitor `AWS-Services` (per-service), subscription
  `Daily-Anomaly-Email` - daily email when an anomaly's total impact is >= $3. Free.
- See [[Cost]].
