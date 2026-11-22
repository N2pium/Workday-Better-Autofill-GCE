# EasyApply cloud backend (phase 1)

AWS CDK (TypeScript) app for the opt-in cloud features of Workday: Better Autofill.
Design notes live in the Obsidian vault: `../plan/00 Home.md`.

Everything Regional is in **us-east-2** (fixed in `lib/config.ts`).

## Stacks

| Stack | What | Notes |
|---|---|---|
| `EasyApply-Data` | KMS key, DynamoDB single table | Termination protection, `RETAIN`, PITR 35 days |
| `EasyApply-Auth` | Cognito user pool, managed login, extension + dashboard clients, optional Google | Public PKCE clients, no secrets |
| `EasyApply-Api` | HTTP API (JWT on every route), 3 Lambdas, access logs, alarms | 20 req/s, burst 40; logs 14 days |

## API (all routes need `Authorization: <Cognito access token>`)

| Route | Function |
|---|---|
| `GET /profiles` · `GET/PUT/DELETE /profiles/{id}` | profiles: optimistic locking via `expectedVersion`; rejects self-ID answers and resume blobs |
| `GET/POST /applications` · `PATCH/DELETE /applications/{id}` | applications: newest first, cursor pagination bound to the caller |
| `DELETE /account` with `{"confirm":"DELETE"}` | account: deletes all items, then the Cognito user |

## Configuration (`cdk.json` → `context`, or `-c key=value`)

| Key | Meaning |
|---|---|
| `extensionIds` | **Required.** Chrome extension IDs allowed to sign in. Currently only the **unpacked dev build** (`jhndpohagnfomchdcfnfecdhmdaepgcd` = `C:\Users\Schoo\EasyApply`; unpacked IDs come from the folder path). **Add the published Web Store ID before release**, then `npx cdk deploy EasyApply-Auth`. |
| `dashboardUrls` | Dashboard origins for redirects/CORS. Default `http://localhost:5173`. |
| `domainPrefix` | Managed-login domain: `<prefix>.auth.us-east-2.amazoncognito.com` |
| `googleClientId` | Empty = Google off, Cognito email sign-in (dev only). Set it to make Google the only provider. |
| `googleSecretName` | Secrets Manager secret holding the Google client secret (plain string). |

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
