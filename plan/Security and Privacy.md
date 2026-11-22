---
type: decision
tags:
  - easyapply
  - security
---

# Security and Privacy

> The extension is published and handles PII (name, address, phone, email, resume,
> demographic answers). This is the most important note in the vault.

## Rules
- **Local-only mode stays; sync is opt-in.** Rewrite `PRIVACY_POLICY.md` and the Chrome Web
  Store data disclosures *before* launch - the current "no servers" promise becomes false
  the day this ships.
- **Encryption:** customer-managed [[KMS]] key for [[DynamoDB]] and [[S3 Resumes]]; TLS only.
- **Demographic / self-identification answers** stay device-local, or are encrypted at the
  field level. They are **never** sent to [[Bedrock]].
- **Delete my account** wipes DynamoDB items, S3 objects and scheduled reminders - see
  [[Flow - Delete account]].
- **Telemetry is scrubbed in the browser:** only tenant host, field key, failure type. See
  [[F07 Failure Telemetry]].
- **Least privilege:** one IAM role per Lambda, scoped to its own table keys / prefixes.
- **Rate limits:** per-user daily quota on AI endpoints ([[ai-svc]]); throttling on
  [[API Gateway]].
- **Secrets** (if any third-party keys appear) in Secrets Manager, never in code or env vars.
- **Tokens in the extension:** access token in `chrome.storage.session`; refresh token only
  if needed, in `chrome.storage.local`, cleared on sign-out.
