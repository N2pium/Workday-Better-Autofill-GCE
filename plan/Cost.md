---
type: decision
tags:
  - easyapply
  - cost
---

# Cost

Approximate list prices for us-east-2; check the AWS Pricing Calculator before relying on them.

| Item | You + ~50 users | ~1,000 active users |
|---|---|---|
| [[API Gateway]] HTTP API | ~$0.05 | ~$1 |
| [[Lambda]] | ~$0 | ~$0-1 |
| [[DynamoDB]] on-demand | ~$0.10 | ~$1-2 |
| S3 ([[S3 Resumes]], dashboard) | ~$0.05 | ~$0.50 |
| [[CloudFront]] | ~$0 | ~$0 |
| [[Cognito]] | $0 | $0 |
| CloudWatch logs ([[Observability]]) | ~$0.25 | ~$1-2 |
| [[SES]] | ~$0 | ~$0.50 |
| Fixed: [[KMS]] key $1, DNS zone $0.50, 1 secret $0.40 | ~$2 | ~$2 |
| **Total** | **~$2-3/mo** | **~$6-10/mo** |
| [[Bedrock]] tokens | usage-based | usage-based - **capped per user and service-wide per day** |

## Bedrock caps (live)
- Per user: 20 AI calls/day (resume reads included) + 100 question categorisations/day.
- Service-wide (all users): 300 AI calls/day + 2000 categorisations/day, so open sign-up can't multiply the bill. Worst case ~$5-7/day; lower `GLOBAL_AI_DAILY_LIMIT` in `cloud/lib/api-stack.ts` for a tighter ceiling.
- Alarms: >200 resume reads/hour, >500 AI calls/hour; Budget `Monthly-Total` $10 + the AWS Settings spend limit.

## Avoid until truly needed
- **NAT Gateway** (~$32/mo) - don't put Lambdas in a VPC.
- **AWS WAF** ($5/ACL + $1/rule) - rely on API Gateway throttling at first.
- **RDS / Aurora** (~$12-15/mo minimum).
- **Provisioned concurrency**, verbose logs (set retention to 7-14 days).

Guardrails: see [[Budgets]].
