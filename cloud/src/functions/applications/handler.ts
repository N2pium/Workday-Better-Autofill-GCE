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

/** Pipeline stages in order. `reached` is the furthest one an application ever held. */
export const FUNNEL_STAGES = ['applied', 'screening', 'interview', 'offer'] as const;
export type FunnelStage = (typeof FUNNEL_STAGES)[number];
/** How it ended (or `active`: still waiting at `reached`). */
export type FunnelOutcome = 'active' | 'ghosted' | 'rejected' | 'withdrawn' | 'offer';
export interface FunnelGroup {
  name: string;
  total: number;
  paths: { reached: FunnelStage; outcome: FunnelOutcome; count: number }[];
}
export type FunnelDimension = 'industry' | 'company' | 'role';
/** Groups shown per dimension; the rest fold into "Other". */
export const FUNNEL_TOP = 7;

export interface Insights {
  total: number;
  byStatus: Record<ApplicationStatus, number>;
  weekly: { weekStart: string; count: number }[];
  responseRate: number | null;
  funnel: Record<FunnelDimension, FunnelGroup[]>;
  truncated: boolean;
  generatedAt: string;
}

type InsightItem = { status?: unknown; appliedAt?: unknown; company?: unknown; role?: unknown; industry?: unknown; statusHistory?: unknown };

const STAGE_RANK: Record<string, number> = { applied: 0, screening: 1, interview: 2, offer: 3 };

/** Furthest stage from the status history plus the current status. Old records have no history. */
export function reachedStage(item: InsightItem): FunnelStage {
  const seen = [item.status, ...(item.statusHistory instanceof Set || Array.isArray(item.statusHistory) ? [...item.statusHistory] : [])];
  const rank = Math.max(0, ...seen.map((s) => (typeof s === 'string' && s in STAGE_RANK ? STAGE_RANK[s] : 0)));
  return FUNNEL_STAGES[rank];
}

function outcomeOf(status: unknown): FunnelOutcome {
  return status === 'offer' || status === 'rejected' || status === 'ghosted' || status === 'withdrawn' ? status : 'active';
}

/**
 * Role family from a free-text title, so "Software Engineer Intern, Summer 2027"
 * and "SWE Intern" group together. First match wins; order matters.
 */
const ROLE_FAMILIES: [string, RegExp][] = [
  ['Data & AI', /\b(data|machine learning|ml|ai|artificial intelligence|analytics|analyst|scientist|deep learning|nlp|computer vision)\b/i],
  ['Other engineering', /\b(mechanical|electrical|civil|chemical|manufacturing|hardware|process|industrial|quality)\b/i],
  ['Software engineering', /\b(software|developer|swe|sde|full[- ]?stack|front[- ]?end|back[- ]?end|devops|sre|mobile|ios|android|web|engineer|engineering|programmer)\b/i],
  ['Product & design', /\b(product|design|designer|ux|ui|program manager|project manager)\b/i],
  ['Business & finance', /\b(finance|financial|accounting|accountant|business|marketing|sales|operations|procurement|consult\w*|supply chain|strategy)\b/i],
  ['IT & systems', /\b(it|systems?|network|security|cyber|support|technologist|infrastructure|cloud|administrator)\b/i],
];
export function roleFamily(title: unknown): string {
  const t = typeof title === 'string' ? title : '';
  return ROLE_FAMILIES.find(([, re]) => re.test(t))?.[0] ?? 'Other roles';
}

const groupKey: Record<FunnelDimension, (i: InsightItem) => string> = {
  industry: (i) => (typeof i.industry === 'string' && i.industry.trim()) || 'Unspecified',
  company: (i) => (typeof i.company === 'string' && i.company.trim()) || 'Unknown company',
  role: (i) => roleFamily(i.role),
};

/** Per-dimension flows: top FUNNEL_TOP groups by size, the rest as "Other". Case-insensitive grouping. */
export function computeFunnel(items: InsightItem[]): Record<FunnelDimension, FunnelGroup[]> {
  const out = {} as Record<FunnelDimension, FunnelGroup[]>;
  for (const dim of ['industry', 'company', 'role'] as FunnelDimension[]) {
    const groups = new Map<string, { name: string; total: number; paths: Map<string, number> }>();
    for (const item of items) {
      const name = groupKey[dim](item);
      const key = name.toLowerCase();
      const g = groups.get(key) ?? { name, total: 0, paths: new Map() };
      const path = `${reachedStage(item)}|${outcomeOf(item.status)}`;
      g.total++;
      g.paths.set(path, (g.paths.get(path) ?? 0) + 1);
      groups.set(key, g);
    }
    const sorted = [...groups.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
    const top = sorted.length > FUNNEL_TOP ? sorted.slice(0, FUNNEL_TOP - 1) : sorted;
    const rest = sorted.slice(top.length);
    if (rest.length) {
      const other = { name: 'Other', total: 0, paths: new Map<string, number>() };
      for (const g of rest) {
        other.total += g.total;
        for (const [p, n] of g.paths) other.paths.set(p, (other.paths.get(p) ?? 0) + n);
      }
      top.push(other);
    }
    out[dim] = top.map((g) => ({
      name: g.name,
      total: g.total,
      paths: [...g.paths].map(([p, count]) => {
        const [reached, outcome] = p.split('|') as [FunnelStage, FunnelOutcome];
        return { reached, outcome, count };
      }),
    }));
  }
  return out;
}

/** Monday 00:00 UTC of the week containing `d`, in ms. */
const mondayUtc = (d: Date) =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) - ((d.getUTCDay() + 6) % 7) * DAY_MS;

/** Pure summary of a user's applications (F10). No AI, nothing stored. */
export function computeInsights(
  items: InsightItem[],
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
    funnel: computeFunnel(items),
    truncated,
    generatedAt: now.toISOString(),
  };
}

const view = (item: Record<string, unknown>) => {
  const { pk: _pk, sk: _sk, type: _type, ...rest } = item;
  // A DynamoDB string set arrives as a JS Set, which JSON.stringify turns into {}.
  if (rest.statusHistory instanceof Set) rest.statusHistory = [...rest.statusHistory].sort();
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
            ExpressionAttributeNames: {
              '#st': 'status', '#ap': 'appliedAt', '#co': 'company', '#ro': 'role', '#in': 'industry', '#hi': 'statusHistory',
            },
            ProjectionExpression: '#st, #ap, #co, #ro, #in, #hi',
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
        // Every status the application has held, so the flow chart knows where a rejection happened.
        statusHistory: new Set([body.status]),
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
      let expression = `SET ${sets.join(', ')}`;
      if (body.status) {
        names['#hist'] = 'statusHistory';
        values[':hist'] = new Set([body.status]);
        expression += ' ADD #hist :hist';
      }
      try {
        const out = await ddb.send(
          new UpdateCommand({
            TableName: tableName(),
            Key: { pk, sk: SK + id },
            UpdateExpression: expression,
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeNames: names,
            ExpressionAttributeValues: values,
            ReturnValues: 'ALL_OLD',
          }),
        );
        const old = out.Attributes ?? {};
        const history = new Set<string>(old.statusHistory instanceof Set ? old.statusHistory : []);
        // Records made before status history existed: keep the status being replaced too.
        if (body.status && !(old.statusHistory instanceof Set) && typeof old.status === 'string' && old.status !== body.status) {
          await ddb.send(
            new UpdateCommand({
              TableName: tableName(),
              Key: { pk, sk: SK + id },
              UpdateExpression: 'ADD #hist :old',
              ConditionExpression: 'attribute_exists(sk)',
              ExpressionAttributeNames: { '#hist': 'statusHistory' },
              ExpressionAttributeValues: { ':old': new Set([old.status]) },
            }),
          );
          history.add(old.status);
        }
        if (body.status) history.add(body.status);
        const updated: Record<string, unknown> = { ...old, ...fields };
        if (history.size) updated.statusHistory = history;
        return json(200, view(updated));
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
