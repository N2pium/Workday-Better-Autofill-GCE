import type { App } from 'aws-cdk-lib';

/** The single Region this AWS project may use. Every Regional resource goes here. */
export const REGION = 'us-east-2';

export interface AppConfig {
  /** Chrome extension IDs allowed to sign in (published + any unpacked dev builds). */
  readonly extensionIds: string[];
  /** Origins of the web dashboard, e.g. http://localhost:5173 or the CloudFront URL. */
  readonly dashboardUrls: string[];
  /** Cognito managed-login domain prefix: <prefix>.auth.us-east-2.amazoncognito.com */
  readonly domainPrefix: string;
  /** Google OAuth client ID. Empty = Google sign-in off (Cognito email sign-in for dev). */
  readonly googleClientId?: string;
  /** Secrets Manager secret holding the Google OAuth client secret (plain string). */
  readonly googleSecretName: string;
  /**
   * Where CloudWatch alarms are emailed. Pass at deploy time (-c alarmEmail=...)
   * rather than committing it: the repo is public. Empty = alarms not emailed.
   */
  readonly alarmEmail?: string;
  /**
   * Reserved concurrency for the unauthenticated POST /telemetry function, which
   * caps what a flood of anonymous calls can cost. 0 = no reservation (use it if
   * the account's concurrency quota is still the new-account 10, where Lambda
   * refuses any reservation). Default 2.
   */
  readonly telemetryConcurrency: number;
}

const EXTENSION_ID = /^[a-p]{32}$/;

function list(app: App, key: string): string[] {
  const v: unknown = app.node.tryGetContext(key);
  if (v === undefined || v === null || v === '') return [];
  if (Array.isArray(v)) return v.map(String).map((s) => s.trim()).filter(Boolean);
  return String(v).split(',').map((s) => s.trim()).filter(Boolean);
}

export function loadConfig(app: App): AppConfig {
  const extensionIds = list(app, 'extensionIds');
  if (extensionIds.length === 0) {
    throw new Error(
      'Set at least one Chrome extension ID: cdk.json context "extensionIds", or ' +
        '-c extensionIds=<id>. Find it on chrome://extensions with Developer mode on.',
    );
  }
  for (const id of extensionIds) {
    if (!EXTENSION_ID.test(id)) throw new Error(`Not a Chrome extension ID: "${id}"`);
  }

  const dashboardUrls = list(app, 'dashboardUrls');
  for (const u of dashboardUrls) {
    const url = new URL(u);
    const local = url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    if (url.protocol !== 'https:' && !local) throw new Error(`Dashboard URL must be https: ${u}`);
    if (url.pathname !== '/' || url.search || url.hash) throw new Error(`Use a bare origin: ${u}`);
  }

  const domainPrefix = String(app.node.tryGetContext('domainPrefix') ?? '');
  if (!/^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(domainPrefix)) {
    throw new Error(`Invalid domainPrefix "${domainPrefix}"`);
  }

  const googleClientId = String(app.node.tryGetContext('googleClientId') ?? '').trim() || undefined;
  const googleSecretName = String(
    app.node.tryGetContext('googleSecretName') ?? 'easyapply/google-oauth-client-secret',
  );

  const alarmEmail = String(app.node.tryGetContext('alarmEmail') ?? '').trim() || undefined;
  if (alarmEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(alarmEmail)) {
    throw new Error(`Not an email address: "${alarmEmail}"`);
  }

  const rawConcurrency = app.node.tryGetContext('telemetryConcurrency');
  const telemetryConcurrency = rawConcurrency === undefined || rawConcurrency === '' ? 2 : Number(rawConcurrency);
  if (!Number.isInteger(telemetryConcurrency) || telemetryConcurrency < 0 || telemetryConcurrency > 50) {
    throw new Error(`telemetryConcurrency must be a whole number 0-50, got "${String(rawConcurrency)}"`);
  }

  return {
    alarmEmail,
    telemetryConcurrency,
    extensionIds,
    dashboardUrls: dashboardUrls.map((u) => new URL(u).origin),
    domainPrefix,
    googleClientId,
    googleSecretName,
  };
}
