# EasyApply cloud backend (phase 1)

AWS CDK (TypeScript) app for the opt-in cloud features of Workday: Better Autofill.
Design notes live in the Obsidian vault: `../plan/00 Home.md`.

Everything Regional is in **us-east-2** (fixed in `lib/config.ts`).

## Stacks

| Stack | What | Notes |
|---|---|---|
| `EasyApply-Data` | KMS key, DynamoDB single table | Termination protection, `RETAIN`, PITR 35 days |
| `EasyApply-Auth` | Cognito user pool, managed login, extension + dashboard clients, optional Google | Public PKCE clients, no secrets |
| `EasyApply-Web` | Private S3 bucket + CloudFront (OAC, strict CSP) for the dashboard | No WAF yet (fixed monthly cost) |
| `EasyApply-Api` | HTTP API (JWT on every route), 4 Lambdas, access logs, alarms → SNS topic | 20 req/s, burst 40; logs 14 days |
| `EasyApply-WebContent` | Uploads `../dashboard/` + generated `config.json`, invalidates CloudFront | Deploy order: Web → Auth → Api → WebContent |

## API (all routes need `Authorization: <Cognito access token>`)

| Route | Function |
|---|---|
| `GET /profiles` · `GET/PUT/DELETE /profiles/{id}` | profiles: optimistic locking via `expectedVersion`; rejects self-ID answers and resume blobs |
| `GET/POST /applications` · `PATCH/DELETE /applications/{id}` | applications: newest first, cursor pagination bound to the caller |
| `GET /insights` | applications: read-only summary computed on demand (no AI, nothing stored): `total`, `byStatus` (every status), `weekly` (12 UTC Monday-start weeks, oldest first), `responseRate` (screening/interview/offer/rejected ÷ non-withdrawn, 2 dp, `null` if none), `truncated` (over 2000 applications), `generatedAt` |
| `DELETE /account` with `{"confirm":"DELETE"}` | account: deletes all items, then the Cognito user |

## Configuration (`cdk.json` → `context`, or `-c key=value`)

| Key | Meaning |
|---|---|
| `extensionIds` | **Required.** Chrome extension IDs allowed to sign in. Currently only the **unpacked dev build** (`jhndpohagnfomchdcfnfecdhmdaepgcd` = `C:\Users\Schoo\EasyApply`; unpacked IDs come from the folder path). **Add the published Web Store ID before release**, then `npx cdk deploy EasyApply-Auth`. |
| `dashboardUrls` | Extra dashboard origins for redirects/CORS (local dev). The CloudFront URL is added automatically. |
| `domainPrefix` | Managed-login domain: `<prefix>.auth.us-east-2.amazoncognito.com` |
| `googleClientId` | Empty = email sign-in only. Set it to add **Continue with Google** next to email. A pre sign-up trigger links a Google sign-in to an existing account with the same verified email. |
| `googleSecretName` | Secrets Manager secret holding the Google client secret (plain string). |
| `alarmEmail` | Where alarms are emailed. **Never commit it** (public repo): put it in your user-level `~/.cdk.json` (`{"context":{"alarmEmail":"..."}}`) so every deploy keeps it. Without it the email subscription is removed. Confirm the SNS email that arrives. |

## Commands

```bash
npm ci
npm run typecheck && npm test
npx cdk synth
npx cdk bootstrap aws://<account>/us-east-2   # once per account/Region
npx cdk diff
npx cdk deploy --all
```

## Turning on Google sign-in

1. Google Cloud Console → APIs & Services → Credentials → **OAuth client ID** (type *Web application*).
2. Authorized redirect URI: `https://<domainPrefix>.auth.us-east-2.amazoncognito.com/oauth2/idpresponse`
3. Store the client secret: Secrets Manager → *Other type of secret* → plaintext → name `easyapply/google-oauth-client-secret`.
4. Put the client ID in `cdk.json` → `googleClientId`, then `npx cdk deploy EasyApply-Auth`.

## Privacy-policy commitments enforced here

These numbers appear in `../PRIVACY_POLICY.md`; the tests in `test/stacks.test.ts` fail if they drift.

- Backups (DynamoDB PITR) ≤ 35 days.
- Service logs 14 days.
- Self-identification answers are refused by the API (`test/handlers.test.ts`).
- Account deletion removes all items and the user. **Extend it** in phase 2 (S3 resumes) and phase 4 (schedules).
