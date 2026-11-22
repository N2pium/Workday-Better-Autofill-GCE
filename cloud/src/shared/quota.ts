import { UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isConditionalFailure, tableName, userPk } from './db';
import { HttpError } from './http';

/** Shared per-user daily budget for every AI feature (plan/Cost.md: cap AI calls per user per day). */
export const AI_DAILY_LIMIT = Number(process.env.AI_DAILY_LIMIT ?? 20);

/**
 * Atomically counts one AI call for today (UTC) or throws 429. Counted before
 * the model is called, so failed calls count too and the cap can't be dodged.
 * The counter item expires two days later (TTL).
 */
export async function useAiQuota(sub: string, now = new Date()): Promise<number> {
  const day = now.toISOString().slice(0, 10);
  try {
    const out = await ddb.send(
      new UpdateCommand({
        TableName: tableName(),
        Key: { pk: userPk(sub), sk: `QUOTA#AI#${day}` },
        UpdateExpression: 'ADD #c :one SET #ttl = if_not_exists(#ttl, :ttl)',
        ConditionExpression: 'attribute_not_exists(#c) OR #c < :limit',
        ExpressionAttributeNames: { '#c': 'count', '#ttl': 'ttl' },
        ExpressionAttributeValues: {
          ':one': 1,
          ':limit': AI_DAILY_LIMIT,
          ':ttl': Math.floor(now.getTime() / 1000) + 2 * 24 * 3600,
        },
        ReturnValues: 'UPDATED_NEW',
      }),
    );
    return Number(out.Attributes?.count ?? 1);
  } catch (err) {
    if (isConditionalFailure(err)) {
      throw new HttpError(429, `Daily AI limit reached (${AI_DAILY_LIMIT}). It resets at midnight UTC.`);
    }
    throw err;
  }
}
