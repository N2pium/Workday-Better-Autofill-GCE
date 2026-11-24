import { DeleteCommand, GetCommand, PutCommand, QueryCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, decodeCursor, encodeCursor, isConditionalFailure, tableName, userPk } from '../../shared/db';
import { callerSub, type Event, handle, HttpError, json, parseBody } from '../../shared/http';
import { findSelfIdKeys, profileId, putProfileBody } from '../../shared/schemas';

const SK = 'PROFILE#';

export const handler = handle(async (event: Event) => {
  const pk = userPk(callerSub(event));

  switch (event.routeKey) {
    case 'GET /profiles': {
      const out = await ddb.send(
        new QueryCommand({
          TableName: tableName(),
          KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
          ExpressionAttributeValues: { ':pk': pk, ':sk': SK },
          ExpressionAttributeNames: { '#n': 'name', '#v': 'version' },
          ProjectionExpression: 'pk, sk, id, #n, #v, updatedAt',
          Limit: 50,
          ExclusiveStartKey: decodeCursor(event.queryStringParameters?.cursor, pk, SK),
        }),
      );
      return json(200, {
        items: (out.Items ?? []).map(({ id, name, version, updatedAt }) => ({ id, name, version, updatedAt })),
        cursor: encodeCursor(out.LastEvaluatedKey),
      });
    }

    case 'GET /profiles/{id}': {
      const id = profileId.parse(event.pathParameters?.id);
      const out = await ddb.send(new GetCommand({ TableName: tableName(), Key: { pk, sk: SK + id } }));
      if (!out.Item) throw new HttpError(404, 'Profile not found');
      const { name, data, version, updatedAt } = out.Item;
      return json(200, { id, name, data, version, updatedAt });
    }

    case 'PUT /profiles/{id}': {
      const id = profileId.parse(event.pathParameters?.id);
      const raw = parseBody(event);
      // Checked before schema validation so the caller gets a clear reason.
      const selfId = findSelfIdKeys((raw as { data?: unknown })?.data);
      if (selfId.length > 0) {
        throw new HttpError(422, `Self-identification answers are never synced; remove: ${selfId.join(', ')}`);
      }
      if ((raw as { data?: Record<string, unknown> })?.data?.resume !== undefined) {
        throw new HttpError(422, 'Resume files are not part of a profile; upload them separately');
      }
      const body = putProfileBody.parse(raw);
      const version = (body.expectedVersion ?? 0) + 1;
      const updatedAt = new Date().toISOString();
      try {
        await ddb.send(
          new PutCommand({
            TableName: tableName(),
            Item: { pk, sk: SK + id, type: 'profile', id, name: body.name, data: body.data, version, updatedAt },
            ...(body.expectedVersion === undefined
              ? { ConditionExpression: 'attribute_not_exists(sk)' }
              : {
                  ConditionExpression: '#v = :expected',
                  ExpressionAttributeNames: { '#v': 'version' },
                  ExpressionAttributeValues: { ':expected': body.expectedVersion },
                }),
          }),
        );
      } catch (err) {
        if (isConditionalFailure(err)) {
          throw new HttpError(
            409,
            body.expectedVersion === undefined
              ? 'Profile already exists; send expectedVersion to update it'
              : 'Profile was changed on another device; reload it and try again',
          );
        }
        throw err;
      }
      return json(200, { id, name: body.name, version, updatedAt });
    }

    case 'DELETE /profiles/{id}': {
      const id = profileId.parse(event.pathParameters?.id);
      await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { pk, sk: SK + id } }));
      return json(204);
    }

    default:
      throw new HttpError(404, 'Not found');
  }
});
