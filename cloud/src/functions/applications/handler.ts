import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, decodeCursor, encodeCursor, isConditionalFailure, tableName, userPk } from '../../shared/db';
import { callerSub, type Event, handle, HttpError, json, parseBody } from '../../shared/http';
import { newSortableId } from '../../shared/ids';
import { APPLICATION_STATUSES, applicationId, createApplicationBody, updateApplicationBody } from '../../shared/schemas';

const SK = 'APP#';

export const newApplicationId = newSortableId;

/** Most applications GET /insights reads; more than this sets `truncated`. */
export const INSIGHTS_MAX_ITEMS = 2000;
const WEEKS = 12;
const DAY_MS = 86_400_000;
const WEEK_MS = 7 * DAY_MS;
const RESPONDED = new Set<string>(['screening', 'interview', 'offer', 'rejected']);

export type ApplicationStatus = (typeof APPLICATION_STATUSES)[number];
export interface Insights {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  weekly: { weekStart: string; count: number }[];
  responseRate: number | null;
  truncated: boolean;
  generatedAt: string;
}

/** Monday 00:00 UTC of the week containing `d`, in ms. */
const mondayUtc = (d: Date) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS;

/** Pure summary of a user's applications (F10). No AI, nothing stored. */
export function computeInsights(
  items: { status?: unknown; appliedAt?: unknown }[],
  now: Date,
  truncated = false,
): Insights {
  const byStatus = Object.fromEntries(APPLICATION_STATUSES.map((s) => [s, 0])) as Record<ApplicationStatus, number>;
  const currentWeek = mondayUtc(now);
  const firstWeek = currentWeek - (WEEKS - 1) * WEEK_MS;
  const counts = new Array<number>(WEEKS).fill(0);
  let responded = 0;

  for (const item of items) {
    const status = item.status;
    if (typeof status === 'string' && Object.hasOwn(byStatus, status)) byStatus[status as ApplicationStatus]++;
    if (typeof status === 'string' && RESPONDED.has(status)) responded++;
    const t = typeof item.appliedAt === 'string' ? Date.parse(item.appliedAt) : NaN;
    if (Number.isNaN(t) || t < firstWeek || t >= currentWeek + WEEK_MS) continue;
    counts[Math.floor((t - firstWeek) / WEEK_MS)]++;
  }

  const total = items.length;
  const denominator = total - byStatus.withdrawn;
  return {
    total,
    byStatus,
    weekly: counts.map((count, i) => ({
      weekStart: new Date(firstWeek + i * WEEK_MS).toISOString().slice(0, 10),
      count,
    })),
    responseRate: denominator > 0 ? Math.round((responded / denominator) * 100) / 100 : null,
    truncated,
    generatedAt: now.toISOString(),
  };
}

const view = (item: Record<string, unknown>) => {
  const { pk: _pk, sk: _sk, type: _type, ...rest } = item;
  return rest;
};

export const handler = handle(async (event: Event) => {
  const pk = userPk(callerSub(event));

  switch (event.routeKey) {
    case 'GET /applications': {
      const limit = Math.min(Math.max(Number(event.queryStringParameters?.limit ?? 50) || 50, 1), 100);
      const out = await ddb.send(
        new QueryCommand({
          TableName: tableName(),
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': SK },
          ScanIndexForward: false,
          Limit: limit,
          ExclusiveStartKey: decodeCursor(event.queryStringParameters?.cursor, pk, SK),
        }),
      );
      return json(200, { items: (out.Items ?? []).map(view), cursor: encodeCursor(out.LastEvaluatedKey) });
    }

    case 'GET /insights': {
      // Read one past the cap so `truncated` is exact (a Limit hit alone always returns a LastEvaluatedKey).
      const items: Record<string, unknown>[] = [];
      let start: Record<string, unknown> | undefined;
      do {
        const out = await ddb.send(
          new QueryCommand({
            TableName: tableName(),
            KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
            ExpressionAttributeValues: { ':pk': pk, ':sk': SK },
            ExpressionAttributeNames: { '#st': 'status', '#ap': 'appliedAt' },
            ProjectionExpression: '#st, #ap',
            Limit: INSIGHTS_MAX_ITEMS + 1 - items.length,
            ExclusiveStartKey: start,
          }),
        );
        items.push(...(out.Items ?? []));
        start = out.LastEvaluatedKey;
      } while (start && items.length <= INSIGHTS_MAX_ITEMS);
      const truncated = items.length > INSIGHTS_MAX_ITEMS;
      return json(200, computeInsights(items.slice(0, INSIGHTS_MAX_ITEMS), new Date(), truncated));
    }

    case 'POST /applications': {
      const body = createApplicationBody.parse(parseBody(event));
      const now = new Date();
      const id = newApplicationId(now);
      const item = {
        pk, sk: SK + id, type: 'application', id,
        ...body,
        appliedAt: body.appliedAt ?? now.toISOString(),
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: tableName(), Item: item, ConditionExpression: 'attribute_not_exists(sk)' }));
      return json(201, view(item));
    }

    case 'PATCH /applications/{id}': {
      const id = applicationId.parse(event.pathParameters?.id);
      const body = updateApplicationBody.parse(parseBody(event));
      const fields = { ...body, updatedAt: new Date().toISOString() };
      const names: Record<string, string> = {};
      const values: Record<string, unknown> = {};
      const sets = Object.entries(fields).map(([k, v], i) => {
        names[`#f${i}`] = k;
        values[`:v${i}`] = v;
        return `#f${i} = :v${i}`;
      });
      try {
        const out = await ddb.send(
          new UpdateCommand({
            TableName: tableName(),
            Key: { pk, sk: SK + id },
            UpdateExpression: `SET ${sets.join(', ')}`,
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_NEW',
          }),
        );
        return json(200, view(out.Attributes ?? {}));
      } catch (err) {
        if (isConditionalFailure(err)) throw new HttpError(404, 'Application not found');
        throw err;
      }
    }

    case 'DELETE /applications/{id}': {
      const id = applicationId.parse(event.pathParameters?.id);
      await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { pk, sk: SK + id } }));
      return json(204);
    }

    default:
      throw new HttpError(404, 'Not found');
  }
});
