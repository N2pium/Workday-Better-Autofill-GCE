import { FirehoseClient, PutRecordBatchCommand, type _Record } from '@aws-sdk/client-firehose';
import { type Event, handle, HttpError, json, logger, parseBody } from '../../shared/http';
import { MAX_BODY_BYTES, type TelemetryPayload, telemetryPayload } from './schema';

/*
 * POST /telemetry (plan/Phase 3 Contracts.md §2). NO authorizer on purpose: a
 * report must not be linkable to an account. The extension sends it only when
 * the user turned on Settings -> "Send anonymous fill-failure reports".
 *
 * Validates the v1 payload, then writes ONE JSON line per event to Firehose:
 *   { v, ats, tenant, build, pack?, type, section?, field?, status?, reason?,
 *     fieldId?, kind?, receivedDate: "YYYY-MM-DD" }
 * Only fields that passed the allowlist schema are copied (never the raw body),
 * and the only thing added is the UTC date. Never logged: the body, the
 * caller's IP, the user agent or any header.
 */

const firehose = new FirehoseClient({});
const streamName = () => {
  const n = process.env.STREAM_NAME;
  if (!n) throw new Error('STREAM_NAME is not set');
  return n;
};

/** UTC calendar date only: no time, so rows can't be lined up with access logs. */
export const receivedDate = (now = new Date()) => now.toISOString().slice(0, 10);

export function toRows(p: TelemetryPayload, date: string): Record<string, unknown>[] {
  const base = { v: p.v, ats: p.ats, tenant: p.tenant, build: p.build, ...(p.pack === undefined ? {} : { pack: p.pack }) };
  return p.events.map((e) =>
    e.type === 'step'
      ? { ...base, type: e.type, section: e.section, field: e.field, status: e.status, reason: e.reason, receivedDate: date }
      : { ...base, type: e.type, fieldId: e.fieldId, kind: e.kind, receivedDate: date },
  );
}

const record = (row: Record<string, unknown>): _Record => ({ Data: Buffer.from(`${JSON.stringify(row)}\n`, 'utf8') });

async function put(records: _Record[]): Promise<number> {
  const out = await firehose.send(new PutRecordBatchCommand({ DeliveryStreamName: streamName(), Records: records }));
  if (!out.FailedPutCount) return 0;
  // Retry only the records Firehose rejected (throttling / internal errors), once.
  const failed = records.filter((_, i) => out.RequestResponses?.[i]?.ErrorCode);
  const retry = await firehose.send(new PutRecordBatchCommand({ DeliveryStreamName: streamName(), Records: failed }));
  return retry.FailedPutCount ?? 0;
}

export const handler = handle(async (event: Event) => {
  if (event.routeKey !== 'POST /telemetry') throw new HttpError(404, 'Not found');
  const payload = telemetryPayload.parse(parseBody(event, MAX_BODY_BYTES));
  const rows = toRows(payload, receivedDate());
  const lost = await put(rows.map(record));
  if (lost) {
    logger.error('Firehose rejected telemetry records', { lost, total: rows.length });
    throw new HttpError(503, 'Try again later');
  }
  return json(202, { accepted: rows.length });
});
