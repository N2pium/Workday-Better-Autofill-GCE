// Phase 3 joins between streams A (adapter interpreter), B (hosting) and C (telemetry),
// checked against the REAL repo files rather than each stream's own fixtures.
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import vm from 'node:vm';
import { createPublicKey, verify } from 'node:crypto';
import { telemetryPayload } from '../src/functions/telemetry/schema';

const ROOT = join(__dirname, '..', '..');
const read = (p: string) => readFileSync(join(ROOT, p));

function evalScript(file: string, extra: Record<string, unknown> = {}): any {
  const sb: any = { console, URL, ...extra };
  sb.self = sb; sb.window = sb;
  vm.createContext(sb);
  vm.runInContext(read(file).toString('utf8'), sb, { filename: file });
  return sb;
}

const canon = (v: any): any => (Array.isArray(v) ? v.map(canon)
  : v && typeof v === 'object' ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v);

describe('phase 3 integration', () => {
  const bytes = read('adapters/dist/workday.json');
  const dist = JSON.parse(bytes.toString('utf8'));

  it('the signed pack verifies with the public key the extension ships', () => {
    const raw = Buffer.from(evalScript('adapters/public-key.js').EASYAPPLY_ADAPTER_PUBLIC_KEY, 'base64');
    const key = createPublicKey({ key: Buffer.concat([Buffer.from('302a300506032b6570032100', 'hex'), raw]), format: 'der', type: 'spki' });
    const sig = Buffer.from(read('adapters/dist/workday.json.sig').toString('utf8').trim(), 'base64');
    expect(verify(null, bytes, key, sig)).toBe(true);
  });

  it('the signed pack matches adapters/workday-pack.js (rebuild + re-sign after editing it)', () => {
    const bundled = evalScript('adapters/workday-pack.js').EASYAPPLY_ADAPTER_BUNDLED;
    expect(dist.version).toBe(bundled.version);
    expect(canon(dist.data)).toEqual(canon(bundled.data));
  });

  it("the pack's minExtension is satisfied by the manifest version", () => {
    const v = (s: string) => s.split('.').map(Number);
    const [a, b] = [v(JSON.parse(read('manifest.json').toString('utf8')).version), v(dist.minExtension)];
    const cmp = (x: number[], y: number[]) => { for (let i = 0; i < 3; i++) { const d = (x[i] || 0) - (y[i] || 0); if (d) return d; } return 0; };
    expect(cmp(a, b)).toBeGreaterThanOrEqual(0);
  });

  it('the extension fetches the pack from the CloudFront /adapters/ path the cloud serves', () => {
    const cfg = evalScript('cloud-config.js').EASYAPPLY_CLOUD_CONFIG;
    expect(cfg.adapterPackUrl).toMatch(/^https:\/\/[a-z0-9]+\.cloudfront\.net\/adapters\/workday\.json$/);
  });

  it('a fill report from the current build, with the pack version, passes the server schema', () => {
    const build = /const FILL_BUILD = '([^']+)'/.exec(read('content.js').toString('utf8'))![1];
    const T = evalScript('cloud-telemetry.js').EasyApplyTelemetry;
    const payload = T.buildPayload({
      build, pack: dist.version, page: 'AI Intern', path: '/en-US/x/apply',
      steps: [
        { section: 'Work Experience', field: 'Work experience', status: 'failed', detail: 'could not delete it by hand' },
        { section: 'Voluntary Disclosures', field: 'Gender', status: 'skipped', detail: 'nothing is saved' }
      ],
      empty: [{ kind: 'text', label: 'Job Title', field: 'jobTitle', required: true }]
    }, { tenant: 'hub.wd1.myworkdayjobs.com', packVersion: dist.version });
    expect(payload).toMatchObject({ build, pack: dist.version, tenant: 'hub.wd1.myworkdayjobs.com' });
    expect(JSON.stringify(payload)).not.toMatch(/AI Intern|apply|Job Title|Gender|by hand/);
    expect(telemetryPayload.safeParse(payload).success).toBe(true);
  });
});
