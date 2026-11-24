---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# API Gateway

**Phase 1 - MVP** · back to [[00 Home]]

**HTTP API** (not REST) with a JWT authorizer pointing at [[Cognito]].

| Route | Target |
|---|---|
| `GET/PUT /profiles/{id}` | [[profile-svc]] |
| `GET/POST/PATCH /applications` | [[tracker-svc]] |
| `POST /ai/answer`, `/ai/match` | [[ai-svc]] |
| `POST /resumes/upload-url` | [[resume-svc]] |
| `POST /telemetry` | [[telemetry-ingest]] |
| `DELETE /account` | [[profile-svc]] (see [[Flow - Delete account]]) |

Stage throttling (e.g. 20 req/s burst 40) protects the bill. ~$1 per million requests.
