---
type: service
phase: 3
status: planned
tags:
  - easyapply
  - service
---

# Firehose

**Phase 3 - Adapters** · back to [[00 Home]]

Buffers scrubbed telemetry events from [[telemetry-ingest]] and writes them to S3 as
Parquet, partitioned by date, for [[Athena]].
