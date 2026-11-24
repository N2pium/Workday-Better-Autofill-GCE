import { AdminDeleteUserCommand, CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import {
  BatchWriteCommand,
  DynamoDBDocumentClient,
  PutCommand,
  QueryCommand,
} from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler as account } from '../src/functions/account/handler';
import { handler as applications, newApplicationId } from '../src/functions/applications/handler';
import { handler as profiles } from '../src/functions/profiles/handler';
import { encodeCursor } from '../src/shared/db';

process.env.TABLE_NAME = 'test-table';
process.env.USER_POOL_ID = 'us-east-2_test';
process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';

const ddb = mockClient(DynamoDBDocumentClient);
const cognito = mockClient(CognitoIdentityProviderClient);
beforeEach(() => {
  ddb.reset();
  cognito.reset();
});

function event(routeKey: string, opts: { body?: unknown; path?: Record<string, string>; query?: Record<string, string> } = {}) {
  return {
    routeKey,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
    isBase64Encoded: false,
    pathParameters: opts.path,
    queryStringParameters: opts.query,
    requestContext: {
      authorizer: { jwt: { claims: { sub: 'user-1', username: 'Google_123' }, scopes: [] } },
    },
  } as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;
}

const profile = {
  name: 'SWE',
  data: {
    personalInfo: { firstName: 'Ada', lastName: 'L', email: 'ada@example.com' },
    education: [{ school: 'MIT', startDate: { month: '09', year: '2020' } }],
    workExperience: [{ company: 'Acme', title: 'Eng', isCurrentRole: true }],
    skills: ['TypeScript'],
    jobPreferences: { authorizedToWork: true, requiresSponsorship: false },
  },
};

describe('profiles', () => {
  it('creates a profile with version 1, only if it does not exist', async () => {
    ddb.on(PutCommand).resolves({});
    const res = await profiles(event('PUT /profiles/{id}', { path: { id: 'swe' }, body: profile }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toMatchObject({ id: 'swe', version: 1 });
    const put = ddb.commandCalls(PutCommand)[0].args[0].input;
    expect(put.Item).toMatchObject({ pk: 'USER#user-1', sk: 'PROFILE#swe' });
    expect(put.ConditionExpression).toBe('attribute_not_exists(sk)');
  });

  it('refuses self-identification answers (privacy policy)', async () => {
    const body = { ...profile, data: { ...profile.data, demographics: { gender: 'x' } } };
    const res = await profiles(event('PUT /profiles/{id}', { path: { id: 'swe' }, body }));
    expect(res.statusCode).toBe(422);
    expect(res.body).toContain('never synced');
    expect(ddb.commandCalls(PutCommand)).toHaveLength(0);
  });

  it('refuses self-ID keys even when nested somewhere unexpected', async () => {
    const body = { ...profile, data: { ...profile.data, personalInfo: { firstName: 'A', veteranStatus: 'no' } } };
    const res = await profiles(event('PUT /profiles/{id}', { path: { id: 'swe' }, body }));
    expect(res.statusCode).toBe(422);
  });

  it('refuses the base64 resume blob', async () => {
    const body = { ...profile, data: { ...profile.data, resume: 'JVBERi0x' } };
    const res = await profiles(event('PUT /profiles/{id}', { path: { id: 'swe' }, body }));
    expect(res.statusCode).toBe(422);
  });

  it('returns 409 when another device updated first', async () => {
    ddb.on(PutCommand).rejects(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }));
    const res = await profiles(
      event('PUT /profiles/{id}', { path: { id: 'swe' }, body: { ...profile, expectedVersion: 3 } }),
    );
    expect(res.statusCode).toBe(409);
  });

  it('rejects unknown top-level sections', async () => {
    const body = { ...profile, data: { ...profile.data, browsingHistory: [] } };
    const res = await profiles(event('PUT /profiles/{id}', { path: { id: 'swe' }, body }));
    expect(res.statusCode).toBe(400);
  });
});

describe('applications', () => {
  it('creates sortable ids', () => {
    expect(newApplicationId(new Date('2026-11-22T15:30:00.123Z'))).toMatch(/^20261122T153000Z-[0-9a-f]{8}$/);
  });

  it('logs an application with defaults', async () => {
    ddb.on(PutCommand).resolves({});
    const res = await applications(
      event('POST /applications', {
        body: { company: 'Duke Energy', role: 'Analyst', url: 'https://dukeenergy.wd1.myworkdayjobs.com/x', site: 'workday' },
      }),
    );
    expect(res.statusCode).toBe(201);
    const item = JSON.parse(res.body!);
    expect(item).toMatchObject({ status: 'applied', site: 'workday' });
    expect(item.pk).toBeUndefined();
  });

  it('rejects non-https job URLs', async () => {
    const res = await applications(
      event('POST /applications', { body: { company: 'A', role: 'B', url: 'javascript:alert(1)' } }),
    );
    expect(res.statusCode).toBe(400);
  });

  it("rejects a cursor that points at another user's partition", async () => {
    const cursor = encodeCursor({ pk: 'USER#someone-else', sk: 'APP#20260101T000000Z-00000000' });
    const res = await applications(event('GET /applications', { query: { cursor: cursor! } }));
    expect(res.statusCode).toBe(400);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(0);
  });

  it('lists newest first', async () => {
    ddb.on(QueryCommand).resolves({ Items: [] });
    await applications(event('GET /applications'));
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input.ScanIndexForward).toBe(false);
  });
});

describe('account deletion', () => {
  it('requires explicit confirmation', async () => {
    const res = await account(event('DELETE /account', { body: {} }));
    expect(res.statusCode).toBe(400);
    expect(cognito.commandCalls(AdminDeleteUserCommand)).toHaveLength(0);
  });

  it('deletes every item in batches of 25, retries unprocessed, then deletes the user', async () => {
    const items = Array.from({ length: 30 }, (_, i) => ({ pk: 'USER#user-1', sk: `APP#${i}` }));
    ddb.on(QueryCommand).resolves({ Items: items });
    ddb
      .on(BatchWriteCommand)
      .resolvesOnce({
        UnprocessedItems: { 'test-table': [{ DeleteRequest: { Key: items[0] } }] },
      })
      .resolves({});
    cognito.on(AdminDeleteUserCommand).resolves({});

    const res = await account(event('DELETE /account', { body: { confirm: 'DELETE' } }));
    expect(res.statusCode).toBe(200);
    expect(JSON.parse(res.body!)).toEqual({ deleted: true, itemsDeleted: 30, filesDeleted: 0 });
    expect(ddb.commandCalls(QueryCommand)[0].args[0].input.ExpressionAttributeValues).toEqual({ ':pk': 'USER#user-1' });
    expect(ddb.commandCalls(BatchWriteCommand)).toHaveLength(3); // 25, retry of 1, then 5
    expect(cognito.commandCalls(AdminDeleteUserCommand)[0].args[0].input).toEqual({
      UserPoolId: 'us-east-2_test',
      Username: 'Google_123',
    });
  });
});
