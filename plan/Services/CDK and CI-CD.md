---
type: service
phase: 1
status: planned
tags:
  - easyapply
  - service
---

# CDK and CI-CD

**Phase 1 - MVP** · back to [[00 Home]]

Infrastructure as code with AWS CDK (TypeScript), all stacks in us-east-2.

Suggested stacks: `AuthStack` ([[Cognito]]), `DataStack` ([[DynamoDB]], [[S3 Resumes]],
[[KMS]]), `ApiStack` ([[API Gateway]] + functions), `WebStack` ([[CloudFront]] + dashboard),
later `AiStack`, `AdaptersStack`, `EngagementStack`.

CI/CD: GitHub Actions authenticating to AWS with OIDC (no long-lived keys) -> `cdk diff` on
PRs, `cdk deploy` on merge.
