import { DeleteCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, decodeCursor, encodeCursor, isConditionalFailure, tableName, userPk } from '../../shared/db';
import { callerSub, type Event, handle, HttpError, json, parseBody } from '../../shared/http';
import { newSortableId } from '../../shared/ids';
import { answerId, createAnswerBody, updateAnswerBody } from '../../shared/schemas';

/*
 * Answer Library (plan/Features/F11 Answer Library.md): saved answers to the long
 * questions that repeat across applications. The user's own text, synced like a
 * profile and deleted with the account. Matching happens in the extension; this
 * is storage plus a "used" counter for ranking.
 *
 *   GET    /answers                 newest first, cursor pagination
 *   POST   /answers                 { category, question, text, tags? }
 *   PATCH  /answers/{id}            any of those fields
 *   POST   /answers/{id}/use        uses += 1, lastUsedAt = now
 *   DELETE /answers/{id}
 */

const SK = 'ANSWER#';
export const MAX_ANSWERS = 300;

const counts = (text: string) => ({
  charCount: text.length,
  wordCount: text.split(/\s+/).filter(Boolean).length,
});

const view = (item: Record<string, unknown>) => {
  const { pk: _pk, sk: _sk, type: _type, ...rest } = item;
  return rest;
};

async function countAnswers(pk: string): Promise<number> {
  let n = 0;
  let start: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: { ':pk': pk, ':sk': SK },
        Select: 'COUNT',
        ExclusiveStartKey: start,
      }),
    );
    n += out.Count ?? 0;
    start = out.LastEvaluatedKey;
  } while (start);
  return n;
}

export const handler = handle(async (event: Event) => {
  const pk = userPk(callerSub(event));

  switch (event.routeKey) {
    case 'GET /answers': {
      const limit = Math.min(Math.max(Number(event.queryStringParameters?.limit ?? 100) || 100, 1), 300);
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

    case 'POST /answers': {
      const body = createAnswerBody.parse(parseBody(event, 20_000));
      if ((await countAnswers(pk)) >= MAX_ANSWERS) {
        throw new HttpError(409, `Your library is full (${MAX_ANSWERS} answers). Delete some to save more.`);
      }
      const now = new Date();
      const id = newSortableId(now);
      const item = {
        pk, sk: SK + id, type: 'answer', id,
        ...body, ...counts(body.text),
        uses: 0,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: tableName(), Item: item, ConditionExpression: 'attribute_not_exists(sk)' }));
      return json(201, view(item));
    }

    case 'PATCH /answers/{id}': {
      const id = answerId.parse(event.pathParameters?.id);
      const body = updateAnswerBody.parse(parseBody(event, 20_000));
      const fields: Record<string, unknown> = { ...body, updatedAt: new Date().toISOString() };
      if (body.text) Object.assign(fields, counts(body.text));
      return json(200, await update(pk, id, fields));
    }

    case 'POST /answers/{id}/use': {
      const id = answerId.parse(event.pathParameters?.id);
      try {
        const out = await ddb.send(
          new UpdateCommand({
            TableName: tableName(),
            Key: { pk, sk: SK + id },
            UpdateExpression: 'ADD uses :one SET lastUsedAt = :now',
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeValues: { ':one': 1, ':now': new Date().toISOString() },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return json(200, view(out.Attributes ?? {}));
      } catch (err) {
        if (isConditionalFailure(err)) throw new HttpError(404, 'Answer not found');
        throw err;
      }
    }

    case 'DELETE /answers/{id}': {
      const id = answerId.parse(event.pathParameters?.id);
      await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { pk, sk: SK + id } }));
      return json(204);
    }

    default:
      throw new HttpError(404, 'Not found');
  }
});

async function update(pk: string, id: string, fields: Record<string, unknown>) {
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
    return view(out.Attributes ?? {});
  } catch (err) {
    if (isConditionalFailure(err)) throw new HttpError(404, 'Answer not found');
    throw err;
  }
}
