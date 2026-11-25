import * as fs from 'node:fs';
import * as path from 'node:path';
import * as vm from 'node:vm';
import { FirehoseClient, PutRecordBatchCommand } from '@aws-sdk/client-firehose';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { TelemetryStack } from '../lib/telemetry-stack';
import { handler, receivedDate } from '../src/functions/telemetry/handler';
import { STEPS } from '../src/functions/telemetry/schema';

process.env.STREAM_NAME = 'telemetry-stream';
process.env.AWS_REGION = 'us-east-2';
process.env.AWS_ACCESS_KEY_ID = 'test';
process.env.AWS_SECRET_ACCESS_KEY = 'test';

const firehose = mockClient(FirehoseClient);
beforeEach(() => {
  firehose.reset();
  firehose.on(PutRecordBatchCommand).resolves({ FailedPutCount: 0, RequestResponses: [] });
});

// An anonymous call: no authorizer context at all.
function event(body: unknown, { raw, routeKey = 'POST /telemetry' }: { raw?: string; routeKey?: string } = {}) {
  return {
    routeKey,
    body: raw ?? JSON.stringify(body),
    isBase64Encoded: false,
    requestContext: { http: { sourceIp: '203.0.113.9', userAgent: 'Chrome' } },
    headers: { 'user-agent': 'Chrome' },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}
const json = (res: { body?: string }) => JSON.parse(res.body || '{}');

const VALID = {
  v: 1,
  ats: 'workday',
  tenant: 'hub.wd1.myworkdayjobs.com',
  build: '2026-11-24e',
  pack: 1,
  events: [
    { type: 'step', section: 'Work Experience', field: 'Work experience', status: 'failed', reason: 'did_not_change' },
    { type: 'empty_required', fieldId: 'jobTitle', kind: 'text' },
  ],
};
const sentRows = () =>
  firehose
    .commandCalls(PutRecordBatchCommand)
    .flatMap((c) => c.args[0].input.Records ?? [])
    .map((r) => Buffer.from(r.Data as Uint8Array).toString('utf8'));

describe('POST /telemetry handler', () => {
  it('accepts a valid payload and writes one JSON line per event, adding only receivedDate', async () => {
    const res = await handler(event(VALID));
    expect(res.statusCode).toBe(202);
    expect(json(res)).toEqual({ accepted: 2 });

    const call = firehose.commandCalls(PutRecordBatchCommand)[0].args[0].input;
    expect(call.DeliveryStreamName).toBe('telemetry-stream');
    const lines = sentRows();
    expect(lines.every((l) => l.endsWith('\n'))).toBe(true);
    const rows = lines.map((l) => JSON.parse(l));
    const date = receivedDate();
    expect(date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
    expect(rows).toEqual([
      { v: 1, ats: 'workday', tenant: 'hub.wd1.myworkdayjobs.com', build: '2026-11-24e', pack: 1,
        type: 'step', section: 'Work Experience', field: 'Work experience', status: 'failed', reason: 'did_not_change',
        receivedDate: date },
      { v: 1, ats: 'workday', tenant: 'hub.wd1.myworkdayjobs.com', build: '2026-11-24e', pack: 1,
        type: 'empty_required', fieldId: 'jobTitle', kind: 'text', receivedDate: date },
    ]);
    // Nothing about the caller is stored.
    expect(lines.join('')).not.toMatch(/203\.0\.113\.9|Chrome|sourceIp|T\d{2}:\d{2}/);
  });

  it('accepts a payload without a pack version, and Greenhouse hosts', async () => {
    const { pack: _pack, ...noPack } = VALID;
    expect((await handler(event(noPack))).statusCode).toBe(202);
    const gh = { ...VALID, ats: 'greenhouse', tenant: 'job-boards.greenhouse.io' };
    expect((await handler(event(gh))).statusCode).toBe(202);
  });

  it('retries records Firehose rejected once, then answers 503', async () => {
    firehose
      .on(PutRecordBatchCommand)
      .resolvesOnce({ FailedPutCount: 1, RequestResponses: [{ RecordId: 'a' }, { ErrorCode: 'ServiceUnavailableException' }] })
      .resolvesOnce({ FailedPutCount: 0, RequestResponses: [{ RecordId: 'b' }] });
    expect((await handler(event(VALID))).statusCode).toBe(202);
    expect(firehose.commandCalls(PutRecordBatchCommand)[1].args[0].input.Records).toHaveLength(1);

    firehose.reset();
    firehose.on(PutRecordBatchCommand).resolves({ FailedPutCount: 1, RequestResponses: [{ ErrorCode: 'x' }, {}] });
    expect((await handler(event(VALID))).statusCode).toBe(503);
  });

  const rejects: [string, unknown][] = [
    ['an extra top-level field', { ...VALID, userId: 'abc' }],
    ['an extra event field', { ...VALID, events: [{ ...VALID.events[0], label: 'First name' }] }],
    ['a value in an event', { ...VALID, events: [{ ...VALID.events[1], value: 'Jane' }] }],
    ['a non-Workday tenant', { ...VALID, tenant: 'evil.example.com' }],
    ['a tenant with a path', { ...VALID, tenant: 'hub.wd1.myworkdayjobs.com/en-US/job/123' }],
    ['a look-alike tenant', { ...VALID, tenant: 'hub.myworkdayjobs.com.evil.io' }],
    ['a Greenhouse host declared as Workday', { ...VALID, tenant: 'boards.greenhouse.io' }],
    ['more than 50 events', { ...VALID, events: Array.from({ length: 51 }, () => VALID.events[1]) }],
    ['no events', { ...VALID, events: [] }],
    ['a question text as the field', { ...VALID, events: [{ ...VALID.events[0], section: 'Application Questions', field: 'Have you worked for Jane Doe Inc?' }] }],
    ['an unknown section', { ...VALID, events: [{ ...VALID.events[0], section: 'Jane Doe' }] }],
    ['a self-ID step', { ...VALID, events: [{ ...VALID.events[0], section: 'Voluntary Disclosures', field: 'Gender' }] }],
    ['free text as the reason', { ...VALID, events: [{ ...VALID.events[0], reason: 'the box for Jane did not keep it' }] }],
    ['a filled status', { ...VALID, events: [{ ...VALID.events[0], status: 'filled' }] }],
    ['a fieldId with spaces', { ...VALID, events: [{ type: 'empty_required', fieldId: 'Jane Doe', kind: 'text' }] }],
    ['a GUID fieldId', { ...VALID, events: [{ type: 'empty_required', fieldId: 'a3f2504e0-4f89-11d3-9a0c-0305e82c3301', kind: 'text' }] }],
    ['an unknown kind', { ...VALID, events: [{ type: 'empty_required', fieldId: 'jobTitle', kind: 'essay' }] }],
    ['a free-text build', { ...VALID, build: 'Jane Doe build' }],
    ['version 2', { ...VALID, v: 2 }],
  ];
  it.each(rejects)('rejects %s with 400 and sends nothing', async (_name, body) => {
    const res = await handler(event(body));
    expect(res.statusCode).toBe(400);
    expect(firehose.commandCalls(PutRecordBatchCommand)).toHaveLength(0);
  });

  it('rejects a body over 8 KB with 413, bad JSON or no body with 400', async () => {
    const big = JSON.stringify({ ...VALID, pad: 'x'.repeat(9000) });
    expect((await handler(event(null, { raw: big }))).statusCode).toBe(413);
    expect((await handler(event(null, { raw: '{not json' }))).statusCode).toBe(400);
    expect((await handler(event(null, { raw: '' }))).statusCode).toBe(400);
    expect(firehose.commandCalls(PutRecordBatchCommand)).toHaveLength(0);
  });

  it('answers only its own route', async () => {
    expect((await handler(event(VALID, { routeKey: 'GET /telemetry' }))).statusCode).toBe(404);
  });

  it('uses the same step allowlist as the extension (cloud-telemetry.js)', () => {
    const ctx: Record<string, unknown> = { URL };
    ctx.self = ctx;
    vm.createContext(ctx);
    vm.runInContext(fs.readFileSync(path.join(__dirname, '..', '..', 'cloud-telemetry.js'), 'utf8'), ctx);
    const ext = (ctx.EasyApplyTelemetry as { STEPS: Record<string, string[]> }).STEPS;
    expect(JSON.parse(JSON.stringify(ext))).toEqual(JSON.parse(JSON.stringify(STEPS)));
  });
});

// ---------------------------------------------------------------- infrastructure
function synth(extra: Record<string, unknown> = {}) {
  const app = new App({
    context: {
      'aws:cdk:bundling-stacks': [],
      domainPrefix: 'better-autofill',
      extensionIds: ['abcdefghijklmnopabcdefghijklmnop'],
      dashboardUrls: ['http://localhost:5173'],
      ...extra,
    },
  });
  const config = loadConfig(app);
  const env = { account: '111111111111', region: 'us-east-2' };
  const data = new DataStack(app, 'Data', { env });
  const auth = new AuthStack(app, 'Auth', { env, config });
  const telemetry = new TelemetryStack(app, 'Telemetry', { env });
  const api = new ApiStack(app, 'Api', {
    env, config, table: data.table, key: data.key, resumeBucket: data.resumes, userPool: auth.userPool,
    clients: [auth.extensionClient, auth.dashboardClient], telemetryStream: telemetry.stream,
  });
  return { telemetry: Template.fromStack(telemetry), api: Template.fromStack(api), telemetryStack: telemetry };
}

describe('TelemetryStack', () => {
  const { telemetry, telemetryStack } = synth();

  it('lives in us-east-2', () => {
    expect(telemetryStack.region).toBe('us-east-2');
  });

  it('keeps events 365 days and Athena results 30 days, in private, encrypted, SSL-only buckets', () => {
    const buckets = Object.values(telemetry.findResources('AWS::S3::Bucket'));
    expect(buckets).toHaveLength(2);
    const days = buckets.map((b) => b.Properties.LifecycleConfiguration.Rules[0].ExpirationInDays).sort((a, b) => a - b);
    expect(days).toEqual([30, 365]);
    for (const b of buckets) {
      expect(b.Properties.PublicAccessBlockConfiguration).toEqual({
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      });
      expect(b.Properties.BucketEncryption.ServerSideEncryptionConfiguration[0].ServerSideEncryptionByDefault.SSEAlgorithm).toBe('AES256');
      expect(b.Properties.VersioningConfiguration).toBeUndefined();
    }
    const policies = Object.values(telemetry.findResources('AWS::S3::BucketPolicy'));
    expect(policies).toHaveLength(2);
    for (const p of policies) {
      expect(JSON.stringify(p)).toContain('"aws:SecureTransport":"false"');
    }
  });

  it('delivers Direct PUT to S3 as GZIP under events/dt=YYYY-MM-DD/, errors under a separate prefix', () => {
    telemetry.hasResourceProperties('AWS::KinesisFirehose::DeliveryStream', {
      DeliveryStreamType: 'DirectPut',
      DeliveryStreamEncryptionConfigurationInput: { KeyType: 'AWS_OWNED_CMK' },
      ExtendedS3DestinationConfiguration: Match.objectLike({
        CompressionFormat: 'GZIP',
        Prefix: 'events/dt=!{timestamp:yyyy-MM-dd}/',
        ErrorOutputPrefix: 'errors/!{firehose:error-output-type}/dt=!{timestamp:yyyy-MM-dd}/',
        BufferingHints: { IntervalInSeconds: 900, SizeInMBs: 64 },
      }),
    });
  });

  it('lets only Firehose for this account assume the delivery role', () => {
    telemetry.hasResourceProperties('AWS::IAM::Role', {
      AssumeRolePolicyDocument: {
        Statement: [Match.objectLike({
          Principal: { Service: 'firehose.amazonaws.com' },
          Condition: { StringEquals: { 'sts:ExternalId': '111111111111' } },
        })],
      },
    });
  });

  it('defines the Glue table with the JSON SerDe and partition projection on dt', () => {
    telemetry.hasResourceProperties('AWS::Glue::Database', { DatabaseInput: { Name: 'easyapply_telemetry' } });
    telemetry.hasResourceProperties('AWS::Glue::Table', {
      DatabaseName: 'easyapply_telemetry',
      TableInput: Match.objectLike({
        Name: 'fill_events',
        PartitionKeys: [{ Name: 'dt', Type: 'string' }],
        Parameters: Match.objectLike({
          'projection.enabled': 'true',
          'projection.dt.type': 'date',
          'projection.dt.format': 'yyyy-MM-dd',
          'storage.location.template': Match.anyValue(),
        }),
        StorageDescriptor: Match.objectLike({
          SerdeInfo: Match.objectLike({ SerializationLibrary: 'org.openx.data.jsonserde.JsonSerDe' }),
        }),
      }),
    });
  });

  it('has an Athena workgroup with enforced, encrypted results and a scan cap', () => {
    telemetry.hasResourceProperties('AWS::Athena::WorkGroup', {
      Name: 'easyapply-telemetry',
      WorkGroupConfiguration: Match.objectLike({
        EnforceWorkGroupConfiguration: true,
        BytesScannedCutoffPerQuery: 1073741824,
        ResultConfiguration: Match.objectLike({ EncryptionConfiguration: { EncryptionOption: 'SSE_S3' } }),
      }),
    });
  });

  it('keeps Firehose error logs 14 days', () => {
    for (const g of Object.values(telemetry.findResources('AWS::Logs::LogGroup'))) {
      expect(g.Properties.RetentionInDays).toBe(14);
    }
  });
});

describe('ApiStack with telemetry', () => {
  const { api } = synth();

  it('has POST /telemetry with NO authorizer while every other route keeps the JWT', () => {
    const routes = Object.values(api.findResources('AWS::ApiGatewayV2::Route'));
    expect(routes).toHaveLength(27);
    const tel = routes.filter((r) => r.Properties.RouteKey === 'POST /telemetry');
    expect(tel).toHaveLength(1);
    expect(tel[0].Properties.AuthorizationType).toBe('NONE');
    expect(tel[0].Properties.AuthorizerId).toBeUndefined();
    const others = routes.filter((r) => r.Properties.RouteKey !== 'POST /telemetry');
    expect(others.length).toBe(26);
    for (const r of others) expect(r.Properties.AuthorizationType).toBe('JWT');
  });

  it('throttles the telemetry route to 5 rps / burst 10 and logs no IP', () => {
    api.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
      RouteSettings: { 'POST /telemetry': { ThrottlingRateLimit: 5, ThrottlingBurstLimit: 10 } },
    });
    const stage = Object.values(api.findResources('AWS::ApiGatewayV2::Stage'))[0];
    expect(stage.Properties.AccessLogSettings.Format).not.toMatch(/identity|sourceIp|userAgent/);
  });

  const telemetryFn = () =>
    Object.entries(api.findResources('AWS::Lambda::Function')).find(([, f]) => f.Properties.Environment?.Variables?.STREAM_NAME);

  it('runs a small function with reserved concurrency and no table access', () => {
    const [, fn] = telemetryFn()!;
    expect(fn.Properties.MemorySize).toBe(128);
    expect(fn.Properties.ReservedConcurrentExecutions).toBe(2);
    expect(fn.Properties.Runtime).toBe('nodejs22.x');
    expect(fn.Properties.Environment.Variables.TABLE_NAME).toBeUndefined();
  });

  it('can drop the reservation for accounts at the 10-concurrency quota', () => {
    const { api: noReserve } = synth({ telemetryConcurrency: 0 });
    const fn = Object.values(noReserve.findResources('AWS::Lambda::Function')).find((f) => f.Properties.Environment?.Variables?.STREAM_NAME);
    expect(fn?.Properties.ReservedConcurrentExecutions).toBeUndefined();
    expect(() => synth({ telemetryConcurrency: 'lots' })).toThrow(/telemetryConcurrency/);
  });

  it('lets the function only PutRecord(Batch) on the telemetry stream, nothing else', () => {
    const [id] = telemetryFn()!;
    const roleRef = (api.findResources('AWS::Lambda::Function')[id].Properties.Role as { 'Fn::GetAtt': string[] })['Fn::GetAtt'][0];
    const policies = Object.values(api.findResources('AWS::IAM::Policy')).filter((p) =>
      JSON.stringify(p.Properties.Roles).includes(roleRef),
    );
    const statements = policies.flatMap((p) => p.Properties.PolicyDocument.Statement);
    const actions = statements.flatMap((s) => [].concat(s.Action));
    expect(actions.filter((a: string) => a.startsWith('firehose:')).sort()).toEqual(['firehose:PutRecord', 'firehose:PutRecordBatch']);
    expect(actions.filter((a: string) => !a.startsWith('firehose:') && !a.startsWith('xray:'))).toEqual([]);
    const firehoseStmt = statements.find((s) => [].concat(s.Action).includes('firehose:PutRecordBatch' as never));
    expect(JSON.stringify(firehoseStmt.Resource)).toMatch(/Stream/);
    expect(JSON.stringify(firehoseStmt.Resource)).not.toContain('*');
  });

  it('alarms on telemetry function errors through the SNS topic', () => {
    const [id] = telemetryFn()!;
    const alarms = Object.values(api.findResources('AWS::CloudWatch::Alarm')).filter((a) =>
      JSON.stringify(a.Properties.Dimensions ?? []).includes(id),
    );
    expect(alarms.some((a) => a.Properties.MetricName === 'Errors')).toBe(true);
    for (const a of alarms) expect(a.Properties.AlarmActions).toHaveLength(1);
  });
});
