import { DynamoDBDocumentClient, QueryCommand } from '@aws-sdk/lib-dynamodb';
import type { APIGatewayProxyEventV2WithJWTAuthorizer } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { computeInsights, handler, INSIGHTS_MAX_ITEMS } from '../src/functions/applications/handler';

process.env.TABLE_NAME = 'test-table';
process.env.POWERTOOLS_LOG_LEVEL = 'SILENT';

const ddb = mockClient(DynamoDBDocumentClient);
beforeEach(() => ddb.reset());

const event = () =>
  ({
    routeKey: 'GET /insights',
    isBase64Encoded: false,
    requestContext: { authorizer: { jwt: { claims: { sub: 'user-1' }, scopes: [] } } },
  }) as unknown as APIGatewayProxyEventV2WithJWTAuthorizer;

// Wednesday 2026-11-25; its week starts Monday 2026-11-23.
const NOW = new Date('2026-11-25T12:00:00.000Z');

describe('computeInsights', () => {
  it('returns 12 Monday-start weeks ending with the current week, zero weeks included', () => {
    const r = computeInsights([], NOW);
    expect(r.weekly).toHaveLength(12);
    expect(r.weekly[11]).toEqual({ weekStart: '2026-11-23', count: 0 });
    expect(r.weekly[0].weekStart).toBe('2026-09-07');
    expect(r.weekly.every((w) => w.count === 0)).toBe(true);
    expect(r).toMatchObject({ total: 0, responseRate: null, truncated: false, generatedAt: NOW.toISOString() });
    expect(r.byStatus).toEqual({ applied: 0, screening: 0, interview: 0, offer: 0, rejected: 0, ghosted: 0, withdrawn: 0 });
  });

  it('buckets across a Monday boundary in UTC', () => {
    const r = computeInsights(
      [
        { status: 'applied', appliedAt: '2026-11-22T23:59:59.999Z' }, // Sunday -> previous week
        { status: 'applied', appliedAt: '2026-11-23T00:00:00.000Z' }, // Monday -> current week
        { status: 'applied', appliedAt: '2026-11-25T08:00:00.000Z' },
      ],
      NOW,
    );
    expect(r.weekly[10]).toEqual({ weekStart: '2026-11-16', count: 1 });
    expect(r.weekly[11]).toEqual({ weekStart: '2026-11-23', count: 2 });
  });

  it('handles a Sunday "now" (week still starts the previous Monday)', () => {
    const r = computeInsights([], new Date('2026-11-29T23:00:00Z'));
    expect(r.weekly[11].weekStart).toBe('2026-11-23');
  });

  it('counts missing/invalid/out-of-range appliedAt in total but not weekly', () => {
    const r = computeInsights(
      [
        { status: 'applied' },
        { status: 'applied', appliedAt: 'not a date' },
        { status: 'applied', appliedAt: '2026-01-01T00:00:00Z' }, // older than 12 weeks
        { status: 'applied', appliedAt: '2026-12-07T00:00:00Z' }, // future week
        { status: 'applied', appliedAt: '2026-09-07T00:00:00Z' }, // first day of the window
      ],
      NOW,
    );
    expect(r.total).toBe(5);
    expect(r.byStatus.applied).toBe(5);
    expect(r.weekly.reduce((n, w) => n + w.count, 0)).toBe(1);
    expect(r.weekly[0].count).toBe(1);
  });

  it('computes response rate excluding withdrawn, rounded to 2 decimals', () => {
    const r = computeInsights(
      [
        { status: 'screening' },
        { status: 'interview' },
        { status: 'offer' },
        { status: 'rejected' },
        { status: 'applied' },
        { status: 'applied' },
        { status: 'ghosted' },
        { status: 'applied' },
        { status: 'applied' },
        { status: 'withdrawn' },
      ],
      NOW,
    );
    // 4 responded / (10 - 1 withdrawn) = 0.444...
    expect(r.responseRate).toBe(0.44);
    expect(r.byStatus).toEqual({ applied: 4, screening: 1, interview: 1, offer: 1, rejected: 1, ghosted: 1, withdrawn: 1 });
  });

  it('response rate is null when every application is withdrawn', () => {
    expect(computeInsights([{ status: 'withdrawn' }, { status: 'withdrawn' }], NOW).responseRate).toBeNull();
  });

  it('ignores unknown statuses in byStatus but still counts them in total', () => {
    const r = computeInsights([{ status: 'archived' }, { status: 'toString' }, {}, { status: 'offer' }], NOW);
    expect(r.total).toBe(4);
    expect(Object.values(r.byStatus).reduce((a, b) => a + b, 0)).toBe(1);
    expect(Object.keys(r.byStatus)).toHaveLength(7);
    expect(r.responseRate).toBe(0.25);
  });
});

describe('GET /insights', () => {
  it('follows pagination, scoped to the caller, projecting only the fields Insights uses', async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: [{ status: 'applied' }, { status: 'offer' }], LastEvaluatedKey: { pk: 'USER#user-1', sk: 'APP#2' } })
      .resolvesOnce({ Items: [{ status: 'rejected' }] });
    const res = await handler(event());
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body!);
    expect(body).toMatchObject({ total: 3, truncated: false, responseRate: 0.67 });
    expect(body.weekly).toHaveLength(12);
    expect(typeof body.generatedAt).toBe('string');

    const calls = ddb.commandCalls(QueryCommand);
    expect(calls).toHaveLength(2);
    const first = calls[0].args[0].input;
    expect(first.ExpressionAttributeValues).toEqual({ ':pk': 'USER#user-1', ':sk': 'APP#' });
    expect(first.ProjectionExpression).toBe('#st, #ap, #co, #ro, #in, #hi');
    expect(first.ExpressionAttributeNames).toEqual({
      '#st': 'status', '#ap': 'appliedAt', '#co': 'company', '#ro': 'role', '#in': 'industry', '#hi': 'statusHistory',
    });
    expect(first.ExclusiveStartKey).toBeUndefined();
    expect(calls[1].args[0].input.ExclusiveStartKey).toEqual({ pk: 'USER#user-1', sk: 'APP#2' });
    expect(calls[1].args[0].input.ExpressionAttributeValues![':pk']).toBe('USER#user-1');
  });

  it(`stops at ${INSIGHTS_MAX_ITEMS} items and sets truncated when more exist`, async () => {
    const page = (n: number) => Array.from({ length: n }, () => ({ status: 'applied' }));
    ddb.on(QueryCommand).callsFake((input: { Limit: number }) => ({
      Items: page(Math.min(input.Limit, 1000)),
      LastEvaluatedKey: { pk: 'USER#user-1', sk: 'APP#x' },
    }));
    const body = JSON.parse((await handler(event())).body!);
    expect(body.total).toBe(INSIGHTS_MAX_ITEMS);
    expect(body.truncated).toBe(true);
    expect(ddb.commandCalls(QueryCommand)).toHaveLength(3); // 1000 + 1000 + 1
  });

  it('is not truncated with exactly the cap', async () => {
    ddb
      .on(QueryCommand)
      .resolvesOnce({ Items: Array.from({ length: 1000 }, () => ({ status: 'applied' })), LastEvaluatedKey: { pk: 'a', sk: 'b' } })
      .resolvesOnce({ Items: Array.from({ length: 1000 }, () => ({ status: 'applied' })), LastEvaluatedKey: { pk: 'a', sk: 'c' } })
      .resolvesOnce({ Items: [] });
    const body = JSON.parse((await handler(event())).body!);
    expect(body).toMatchObject({ total: 2000, truncated: false });
  });
});
