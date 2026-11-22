import {
  AdminDeleteUserCommand,
  CognitoIdentityProviderClient,
  UserNotFoundException,
} from '@aws-sdk/client-cognito-identity-provider';
import { BatchWriteCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, tableName, userPk } from '../../shared/db';
import { callerSub, callerUsername, type Event, handle, HttpError, json, logger, parseBody } from '../../shared/http';
import { deleteAccountBody } from '../../shared/schemas';

const cognito = new CognitoIdentityProviderClient({});
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Deletes every item under the user's partition. Returns how many were deleted. */
export async function deleteAllUserItems(pk: string): Promise<number> {
  let deleted = 0;
  let startKey: Record<string, unknown> | undefined;
  do {
    const page = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'pk = :pk',
        ExpressionAttributeValues: { ':pk': pk },
        ProjectionExpression: 'pk, sk',
        ExclusiveStartKey: startKey,
      }),
    );
    const keys = (page.Items ?? []).map(({ pk: p, sk }) => ({ pk: p, sk }));
    for (let i = 0; i < keys.length; i += 25) {
      let requests = keys.slice(i, i + 25).map((Key) => ({ DeleteRequest: { Key } }));
      for (let attempt = 0; requests.length > 0; attempt++) {
        if (attempt === 6) throw new Error('DynamoDB kept returning unprocessed deletes');
        if (attempt > 0) await sleep(50 * 2 ** attempt);
        const out = await ddb.send(new BatchWriteCommand({ RequestItems: { [tableName()]: requests } }));
        const left = out.UnprocessedItems?.[tableName()] ?? [];
        deleted += requests.length - left.length;
        requests = left as typeof requests;
      }
    }
    startKey = page.LastEvaluatedKey;
  } while (startKey);
  return deleted;
}

/**
 * DELETE /account  body: {"confirm":"DELETE"}
 *
 * Order matters: data first, then the Cognito user. If anything fails the call
 * returns 500 and is safe to retry, because each step is idempotent.
 *
 * Later phases must extend this (see plan/Flows/Flow - Delete account.md):
 *   phase 2: delete s3://<resumes>/users/<sub>/
 *   phase 4: delete the user's EventBridge Scheduler schedules
 */
export const handler = handle(async (event: Event) => {
  if (event.routeKey !== 'DELETE /account') throw new HttpError(404, 'Not found');
  deleteAccountBody.parse(parseBody(event));

  const sub = callerSub(event);
  const username = callerUsername(event);
  const deleted = await deleteAllUserItems(userPk(sub));

  try {
    await cognito.send(new AdminDeleteUserCommand({ UserPoolId: process.env.USER_POOL_ID, Username: username }));
  } catch (err) {
    if (!(err instanceof UserNotFoundException)) throw err;
  }

  logger.info('Account deleted', { itemsDeleted: deleted }); // no identifiers logged
  return json(200, { deleted: true, itemsDeleted: deleted });
});
