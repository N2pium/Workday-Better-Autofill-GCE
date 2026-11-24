import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { HttpError } from './http';

export const ddb = DynamoDBDocumentClient.from(new DynamoDBClient({}), {
  marshallOptions: { removeUndefinedValues: true },
});

export const tableName = (): string => {
  const t = process.env.TABLE_NAME;
  if (!t) throw new Error('TABLE_NAME not set');
  return t;
};

export const userPk = (sub: string) => `USER#${sub}`;

/** Opaque pagination cursor. Bound to the caller so it can't be used to read another user's items. */
export function encodeCursor(key: Record<string, unknown> | undefined): string | undefined {
  return key ? Buffer.from(JSON.stringify(key), 'utf8').toString('base64url') : undefined;
}

export function decodeCursor(cursor: string | undefined, pk: string, skPrefix: string) {
  if (!cursor) return undefined;
  let key: unknown;
  try {
    key = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8'));
  } catch {
    throw new HttpError(400, 'Invalid cursor');
  }
  const k = key as { pk?: unknown; sk?: unknown };
  if (
    typeof key !== 'object' || key === null || Object.keys(key).length !== 2 ||
    k.pk !== pk || typeof k.sk !== 'string' || !k.sk.startsWith(skPrefix)
  ) {
    throw new HttpError(400, 'Invalid cursor');
  }
  return { pk: k.pk, sk: k.sk };
}

export const isConditionalFailure = (err: unknown) =>
  (err as { name?: string })?.name === 'ConditionalCheckFailedException';
