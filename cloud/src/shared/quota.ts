import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isConditionalFailure, tableName, userPk } from './db';
import { HttpError } from './http';

/** Shared per-user daily budget for every AI feature (plan/Cost.md: cap AI calls per user per day). */
export const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 20);
/** Question categorising is a ~20-token call with its own, larger budget (F11 Answer Library). */
export const CATEGORISE_DAILY_LIMIT = Number(process.env.CATEGORISE_DAILY_LIMIT ?? 100);
/**
 * Service-wide daily ceilings, across ALL users. Sign-up is open, so the
 * per-user limits alone multiply with every new account; these bound the whole
 * Bedrock bill per day whatever the number of accounts.
 */
export const GLOBAL_AI_DAILY_LIMIT = Number(process.env.GLOBAL_AI_DAILY_LIMIT ?? 300);
export const GLOBAL_CATEGORISE_DAILY_LIMIT = Number(process.env.GLOBAL_CATEGORISE_DAILY_LIMIT ?? 2000);
/** Partition for the service-wide counters. Never a user's (those are USER#<sub>). */
export const GLOBAL_QUOTA_PK = 'SERVICE#QUOTA';

/**
 * Atomically counts one call for today (UTC) in `bucket`, or throws 429. Counted
 * before the model is called, so failed calls count too and the cap can't be
 * dodged. The counter item expires two days later (TTL).
 */
export async function useQuota(sub: string, bucket: string, limit: number, message: string, now = new Date()): Promise<number> {
  return countToday(userPk(sub), bucket, limit, message, now);
}

async function countToday(pk: string, bucket: string, limit: number, message: string, now: Date): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  try {
    const out = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { pk, sk: `QUOTA#${bucket}#${day}` },
        UpdateExpression: 'ADD #c :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
        ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':limit': limit,
          ':ttl': Math.floor(now.getTime() / 1000) + 2 * 24 * 3600,
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(out.Attributes?.count ?? 1);
  } catch (err) {
    if (isConditionalFailure(err)) throw new HttpError(429, message);
    throw err;
  }
}

const BUSY = 'AI features have reached their daily limit for everyone. They reset at midnight UTC.';

/** The user's own limit first, then the service-wide one, so one user at their cap doesn't use up the shared count. */
export async function useAiQuota(sub: string, now = new Date()): Promise<number> {
  const n = await useQuota(sub, 'AI', AI_DAILY_LIMIT, `Daily AI limit reached (${AI_DAILY_LIMIT}). It resets at midnight UTC.`, now);
  await countToday(GLOBAL_QUOTA_PK, 'AI', GLOBAL_AI_DAILY_LIMIT, BUSY, now);
  return n;
}

export async function useCategoriseQuota(sub: string, now = new Date()): Promise<number> {
  const n = await useQuota(sub, 'CAT', CATEGORISE_DAILY_LIMIT, 'Daily question-matching limit reached. It resets at midnight UTC.', now);
  await countToday(GLOBAL_QUOTA_PK, 'CAT', GLOBAL_CATEGORISE_DAILY_LIMIT, BUSY, now);
  return n;
}
