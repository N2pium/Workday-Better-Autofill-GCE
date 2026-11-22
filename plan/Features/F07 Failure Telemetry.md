---
type: feature
phase: 3
status: planned
tags:
  - easyapply
  - feature
---

# F07 Failure Telemetry

**Phase 3 - Adapters** · back to [[00 Home]] · [[Roadmap]]

## Problem
You fix fields by guessing, because you can't see real failures.

## What it does
Opt-in reports like "field X wasn't found on tenant Y" show which Workday tenants break.

## Built with
- [[telemetry-ingest]]
- [[Firehose]]
- [[Athena]]
- [[API Gateway]]

## Flows
- [[Flow - Telemetry]]

## Notes
- Scrubbed in the browser: tenant host, page step, field key, failure type, pack version. No values, no names.
- Pairs with [[F06 Remote Adapter Packs]]: telemetry finds the break, a pack fixes it. Portfolio highlight.
