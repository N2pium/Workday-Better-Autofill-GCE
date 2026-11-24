import { DynamoDBDocumentClient, PutCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeFunnel, FUNNEL_TOP, handler, reachedStage, roleFamily } from '../src/functions/applications/handler';

process.env.TABLE_NAME = 'test-table';
const ddb = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddb.reset());

const ID = '20261122T153000Z-1a2b3c4d';
const event = (routeKey: string, body?: unknown) =>
  ({
    routeKey,
    isBase64Encoded: false,
    pathParameters: { id: ID },
    body: body === undefined ? undefined : JSON.stringify(body),
    requestContext: { authorizer: { jwt: { claims: { sub: 'user-1' }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

describe('funnel helpers', () => {
  it('reached stage is the furthest status ever held, from history or the current status', () => {
    expect(reachedStage({ status: 'applied' })).toBe('applied');
    expect(reachedStage({ status: 'rejected' })).toBe('applied');
    expect(reachedStage({ status: 'rejected', statusHistory: new Set(['applied', 'screening', 'interview', 'rejected']) })).toBe('interview');
    expect(reachedStage({ status: 'ghosted', statusHistory: ['screening'] })).toBe('screening');
    expect(reachedStage({ status: 'offer' })).toBe('offer');
  });

  it('role family groups free-text titles', () => {
    expect(roleFamily('Software Engineer Intern, Summer 2027')).toBe('Software engineering');
    expect(roleFamily('Data Engineering Intern')).toBe('Data & AI');
    expect(roleFamily('Software System Technologist Intern')).toBe('Software engineering');
    expect(roleFamily('Procurement Tools & Systems Intern')).toBe('Business & finance');
    expect(roleFamily('Mechanical Engineer')).toBe('Other engineering');
    expect(roleFamily('Network Administrator')).toBe('IT & systems');
    expect(roleFamily('Barista')).toBe('Other roles');
    expect(roleFamily(undefined)).toBe('Other roles');
  });

  it('groups case-insensitively, labels blanks, and folds past the top groups into Other', () => {
    const items = [
      { company: 'Acme', industry: 'Fintech', status: 'rejected', statusHistory: new Set(['applied', 'screening', 'rejected']) },
      { company: 'acme ', industry: 'fintech', status: 'applied' },
      { company: 'Beta', status: 'offer' },
      ...Array.from({ length: FUNNEL_TOP + 2 }, (_, i) => ({ company: `Co${i}`, industry: `Ind${i}`, status: 'applied' })),
    ];
    const f = computeFunnel(items);
    expect(f.company[0]).toEqual({
      name: 'Acme',
      total: 2,
      paths: [
        { reached: 'screening', outcome: 'rejected', count: 1 },
        { reached: 'applied', outcome: 'active', count: 1 },
      ],
    });
    expect(computeFunnel([{ status: 'applied' }]).industry[0].name).toBe('Unspecified');
    for (const dim of ['industry', 'company', 'role'] as const) {
      expect(f[dim].length).toBeLessThanOrEqual(FUNNEL_TOP);
      expect(f[dim].reduce((a, g) => a + g.total, 0)).toBe(items.length);
    }
    expect(f.company.at(-1)?.name).toBe('Other');
    expect(f.role).toEqual([{ name: 'Other roles', total: items.length, paths: expect.any(Array) }]);
  });
});

describe('status history', () => {
  it('a new application starts its history with its status', async () => {
    ddb.on(PutCommand).resolves({});
    const res = await handler(event('POST /applications', { company: 'Acme', role: 'Dev', url: 'https://x.example/j', industry: 'Fintech' }));
    expect(res.statusCode).toBe(201);
    const item = ddb.commandCalls(PutCommand)[0].args[0].input.Item!;
    expect(item.statusHistory).toEqual(new Set(['applied']));
    expect(item.industry).toBe('Fintech');
    expect(JSON.parse(res.body!).statusHistory).toEqual(['applied']);
  });

  it('a status change adds to the history; other edits do not touch it', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { id: ID, status: 'applied', statusHistory: new Set(['applied']) } });
    const res = await handler(event('PATCH /applications/{id}', { status: 'screening' }));
    const input = ddb.commandCalls(UpdateCommand)[0].args[0].input;
    expect(input.UpdateExpression).toMatch(/ ADD #hist :hist$/);
    expect(input.ExpressionAttributeValues?.[':hist']).toEqual(new Set(['screening']));
    expect(ddb.commandCalls(UpdateCommand)).toHaveLength(1);
    expect(JSON.parse(res.body!)).toMatchObject({ status: 'screening', statusHistory: ['applied', 'screening'] });

    ddb.reset();
    ddb.on(UpdateCommand).resolves({ Attributes: { id: ID, status: 'applied' } });
    await handler(event('PATCH /applications/{id}', { industry: 'AI & data' }));
    expect(ddb.commandCalls(UpdateCommand)[0].args[0].input.UpdateExpression).not.toMatch(/ADD/);
  });

  it('a record from before history existed keeps the status being replaced', async () => {
    ddb.on(UpdateCommand).resolves({ Attributes: { id: ID, status: 'interview' } });
    const res = await handler(event('PATCH /applications/{id}', { status: 'rejected' }));
    const calls = ddb.commandCalls(UpdateCommand);
    expect(calls).toHaveLength(2);
    expect(calls[1].args[0].input.ExpressionAttributeValues?.[':old']).toEqual(new Set(['interview']));
    expect(JSON.parse(res.body!).statusHistory).toEqual(['interview', 'rejected']);
  });

  it('a missing application is still a 404', async () => {
    ddb.on(UpdateCommand).rejects(Object.assign(new Error('x'), { name: 'ConditionalCheckFailedException' }));
    expect((await handler(event('PATCH /applications/{id}', { status: 'offer' }))).statusCode).toBe(404);
  });

  it('industry is length-limited', async () => {
    expect((await handler(event('PATCH /applications/{id}', { industry: 'x'.repeat(61) }))).statusCode).toBe(400);
  });
});
