---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# Lambda

**Phase 1 - MVP** · back to [[00 Home]]

Shared conventions for all functions (Event Functions, On-Demand):

- Node.js 22 / TypeScript, arm64 (cheaper), bundled with esbuild via CDK.
- One function per service, one least-privilege IAM role each.
- Powertools for logging, metrics and tracing ([[Observability]]).
- Not in a VPC (avoids NAT Gateway cost - see [[Cost]]).

Functions: [[profile-svc]], [[tracker-svc]], [[ai-svc]], [[resume-svc]], [[parse-worker]],
[[reminder-worker]], [[telemetry-ingest]].
