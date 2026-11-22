---
type: service
phase: 3
status: planned
tags:
  - easyapply
  - service
---

# Athena

**Phase 3 - Adapters** · back to [[00 Home]]

SQL over the telemetry data in S3 (Glue table). Example: "top 20 (tenant, field) pairs that
failed this week" -> tells you which [[S3 Adapter Packs|adapter pack]] to fix next.
Pay per data scanned - Parquet + partitions keep it to cents.
