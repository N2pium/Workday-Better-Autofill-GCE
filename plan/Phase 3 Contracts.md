---
status: built
---
# Phase 3 contracts (2026-11-24)

Shared interfaces for the three Phase 3 work streams, so they can be built in
parallel and fit together. Change this file first if a contract must change.

Streams: **A** adapter interpreter (extension) · **B** adapter hosting (cloud) ·
**C** failure telemetry (cloud + extension panel). Lever/Ashby come after A.

## 1. Adapter pack (A defines the content, B hosts it)

- **Source of truth:** `adapters/workday-pack.js` (extension package, loaded as a
  content script BEFORE `content.js`). It sets
  `self.EASYAPPLY_ADAPTER_BUNDLED = { ...pack }` — pure data, no functions.
- **Pack shape (schema 1):**
  ```json
  {
    "schema": 1,
    "ats": "workday",
    "version": 1,
    "minExtension": "2.0.1",
    "data": { "...": "selectors, data-automation-ids, label aliases, heading regex SOURCES as strings" }
  }
  ```
  `version` is an integer, bumped on every change. Regexes are stored as
  `{ "source": "...", "flags": "i" }`. Never code, never URLs to load.
- **Build + sign:** `node tools/build-adapter-pack.mjs` reads the source file,
  writes `adapters/dist/workday.json` (canonical JSON, exactly the bytes signed)
  and `adapters/dist/workday.json.sig` (base64 Ed25519 signature of those bytes).
  Private key: `~/.easyapply/adapter-signing-key.pem` (OUTSIDE the repo, never
  committed; `--gen-key` creates it). Public key (raw, base64) is committed in
  `adapters/public-key.js` → `self.EASYAPPLY_ADAPTER_PUBLIC_KEY`.
  `adapters/dist/` IS committed (signed artifacts; deploy needs no key).
- **Remote URL:** `https://d3sun3zkns70tc.cloudfront.net/adapters/workday.json`
  and `.../workday.json.sig`. Added to `cloud-config.js` as `adapterPackUrl`
  (A adds the config key).
- **Hosting (B):** served by the EXISTING EasyApply-Web CloudFront distribution
  under `/adapters/*`, from a SEPARATE private S3 bucket (OAC), deployed from
  `adapters/dist/` by CDK. Response headers: `Access-Control-Allow-Origin: *`,
  `Cache-Control: max-age=300`, `Content-Type: application/json` (and
  `text/plain` for `.sig`). The dashboard's own deployment must not prune or
  overwrite adapter files and vice versa.
- **Loading (A):** background.js fetches URL + .sig at startup and every 6 h
  (chrome.alarms), verifies with WebCrypto Ed25519 against the bundled public
  key, accepts only `schema` it supports, `ats` match, `version` > bundled
  version, and `minExtension` <= manifest version. Accepted pack is stored in
  `chrome.storage.local.adapterPack` (key starts with `adapter`, not `cloud`).
  content.js uses stored pack if present and valid, else the bundled one.
  No host permission is added: CloudFront's CORS header makes the fetch work.

## 2. Failure telemetry (C)

- **Endpoint:** `POST {apiUrl}/telemetry` on the existing HTTP API, NO JWT
  (route-level authorization NONE) so reports cannot be tied to an account.
  Route throttle ~5 rps / burst 10. Body ≤ 8 KB. Responds 202.
- **Payload (v1), validated by zod, anything else → 400:**
  ```json
  {
    "v": 1,
    "ats": "workday",
    "tenant": "hub.wd1.myworkdayjobs.com",
    "build": "2026-11-24e",
    "pack": 1,
    "events": [
      { "type": "step", "section": "Work Experience", "field": "Work experience", "status": "failed", "reason": "did_not_change" },
      { "type": "empty_required", "fieldId": "jobTitle", "kind": "text" }
    ]
  }
  ```
  - `tenant`: hostname only, must match a Workday (`*.myworkdayjobs.com`) or
    Greenhouse host. Never path, job title, URL query.
  - `section` / `field`: from a fixed allowlist of the extension's own step names
    (the fill report's `steps[].section/field`). Unknown → dropped client-side.
  - `status`: `failed` | `skipped`. `reason`: enum `not_saved`, `not_found`,
    `no_option`, `did_not_change`, `no_add_button`, `other`
    (client maps the report's free-text `detail` to a code; text is NEVER sent).
  - `fieldId`: Workday `formField-<id>` suffix, `/^[A-Za-z][A-Za-z0-9_-]{0,59}$/`,
    GUID-like ids dropped. `kind`: `text|dropdown|checkbox|radio|date|file|other`.
  - ≤ 50 events. No labels, no values, no user id, no IP stored.
- **Pipeline:** Lambda → Firehose (Direct PUT) → S3 telemetry bucket, GZIP JSON
  lines, prefix `events/dt=YYYY-MM-DD/`, lifecycle expire 365 days (policy:
  ≤ 12 months). Lambda adds only `receivedDate` (date, no time). Glue database +
  table with partition projection on `dt`, Athena workgroup with its own
  results bucket (expire 30 days). All in us-east-2.
- **Extension side (C):** `cloud-telemetry.js` (pure: `buildPayload(report,
  {tenant, packVersion})` + `send`). The SIDE PANEL sends it after a fill
  report arrives, only when Settings → "Send anonymous fill-failure reports"
  is on (default OFF). Turning it on requests the API host permission if not
  granted. C does NOT edit content.js.

## 3. Shared rules

- Region us-east-2 for everything Regional; CloudFront stays global.
- Nobody deploys during the build (AWS login expired); `cdk synth` + tests only.
- PRIVACY_POLICY.md / docs/index.html / store texts are updated at integration,
  not by the streams. Each stream lists the policy-relevant facts in its report.
- New cloud tests go in NEW files (`test/adapters-hosting.test.ts`,
  `test/telemetry.test.ts`), not in `stacks.test.ts`.
