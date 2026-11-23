import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, decodeCursor, encodeCursor, isConditionalFailure, tableName, userPk } from '../../shared/db';
import { callerSub, type Event, handle, HttpError, json, parseBody } from '../../shared/http';
import { newSortableId } from '../../shared/ids';
import { applicationId, createApplicationBody, updateApplicationBody } from '../../shared/schemas';

const SK = 'APP#';

export const newApplicationId = newSortableId;

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
