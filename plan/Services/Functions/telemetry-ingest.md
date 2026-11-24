---
type: service
phase: 3
status: planned
tags:
  - easyapply
  - service
---

# telemetry-ingest

**Phase 3 - Adapters** · back to [[00 Home]]

Small [[Lambda]] behind `POST /telemetry` on [[API Gateway]]. Validates the event against an
allowlisted schema (drops anything that looks like PII) and puts it on [[Firehose]].

Feature: [[F07 Failure Telemetry]] · Flow: [[Flow - Telemetry]]
