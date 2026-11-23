import { DeleteObjectCommand, GetObjectCommand, HeadObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { createPresignedPost } from '@aws-sdk/s3-presigned-post';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { DeleteCommand, GetCommand, PutCommand, QueryCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
import { ddb, isConditionalFailure, tableName, userPk } from '../../shared/db';
import { callerSub, type Event, handle, HttpError, json, parseBody } from '../../shared/http';
import { newSortableId } from '../../shared/ids';
import { createResumeBody, MAX_RESUME_BYTES, MAX_RESUMES, renameResumeBody, resumeId } from '../../shared/schemas';

/*
 * Resume Vault (plan/Features/F02 Resume Vault.md). Opt-in: several resume
 * versions in a private, KMS-encrypted bucket; the extension picks one per job.
 * File bytes never pass through the API: the browser uploads straight to S3
 * with a presigned POST whose policy pins the key, type and size.
 *
 *   GET    /resumes                 ready versions, newest first
 *   POST   /resumes                 { name, fileName, contentType, size } -> { resume, upload: { url, fields } }
 *   POST   /resumes/{id}/confirm    checks the object landed and matches, marks it ready
 *   GET    /resumes/{id}/download   -> { url }  (presigned GET, 5 minutes)
 *   PATCH  /resumes/{id}            { name }
 *   DELETE /resumes/{id}            deletes the object and the record
 */

const s3 = new S3Client({});
const SK = 'RESUME#';
const URL_TTL = 300; // seconds

const bucket = () => {
  const b = process.env.RESUME_BUCKET;
  if (!b) throw new Error('RESUME_BUCKET not set');
  return b;
};

/** users/<sub>/resumes/<id>: per-user prefix, so account deletion can wipe it in one sweep. */
export const objectKey = (sub: string, id: string) => `users/${sub}/resumes/${id}`;

const view = (item: Record<string, unknown>) => {
  const { pk: _pk, sk: _sk, type: _type, key: _key, ...rest } = item;
  return rest;
};

async function listItems(pk: string) {
  const items: Record<string, unknown>[] = [];
  let start: Record<string, unknown> | undefined;
  do {
    const out = await ddb.send(
      new QueryCommand({
        TableName: tableName(),
        KeyConditionExpression: 'pk = :pk AND begins_with(sk, :sk)',
        ExpressionAttributeValues: { ':pk': pk, ':sk': SK },
        ScanIndexForward: false,
        ExclusiveStartKey: start,
      }),
    );
    items.push(...(out.Items ?? []));
    start = out.LastEvaluatedKey;
  } while (start);
  return items;
}

async function getItem(pk: string, id: string) {
  const out = await ddb.send(new GetCommand({ TableName: tableName(), Key: { pk, sk: SK + id } }));
  if (!out.Item) throw new HttpError(404, 'Resume not found');
  return out.Item;
}

const isNotFound = (err: unknown) => {
  const e = err as { name?: string; $metadata?: { httpStatusCode?: number } };
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
};

export const handler = handle(async (event: Event) => {
  const sub = callerSub(event);
  const pk = userPk(sub);
  const id = () => resumeId.parse(event.pathParameters?.id);

  switch (event.routeKey) {
    case 'GET /resumes': {
      const items = (await listItems(pk)).filter((i) => i.status === 'ready');
      return json(200, { items: items.map(view) });
    }

    case 'POST /resumes': {
      const body = createResumeBody.parse(parseBody(event, 5_000));
      const existing = await listItems(pk);
      // Abandoned uploads (never confirmed) don't count after an hour.
      const hourAgo = Date.now() - 3600_000;
      const live = existing.filter((i) => i.status === 'ready' || Date.parse(String(i.createdAt)) > hourAgo);
      if (live.length >= MAX_RESUMES) {
        throw new HttpError(409, `You can keep up to ${MAX_RESUMES} resumes. Delete one to add another.`);
      }

      const now = new Date();
      const rid = newSortableId(now);
      const key = objectKey(sub, rid);
      const item = {
        pk, sk: SK + rid, type: 'resume', id: rid, key,
        name: body.name, fileName: body.fileName, contentType: body.contentType, size: body.size,
        status: 'pending',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      await ddb.send(new PutCommand({ TableName: tableName(), Item: item, ConditionExpression: 'attribute_not_exists(sk)' }));

      const upload = await createPresignedPost(s3, {
        Bucket: bucket(),
        Key: key,
        Expires: URL_TTL,
        Fields: { 'Content-Type': body.contentType },
        Conditions: [
          ['eq', '$Content-Type', body.contentType],
          ['content-length-range', 1, MAX_RESUME_BYTES],
        ],
      });
      return json(201, { resume: view(item), upload });
    }

    case 'POST /resumes/{id}/confirm': {
      const rid = id();
      const item = await getItem(pk, rid);
      let head;
      try {
        head = await s3.send(new HeadObjectCommand({ Bucket: bucket(), Key: String(item.key) }));
      } catch (err) {
        if (isNotFound(err)) throw new HttpError(409, 'The upload has not finished. Try again.');
        throw err;
      }
      if (head.ContentType !== item.contentType || !head.ContentLength || head.ContentLength > MAX_RESUME_BYTES) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: String(item.key) }));
        await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { pk, sk: SK + rid } }));
        throw new HttpError(422, 'That upload did not match. Please try again.');
      }
      const out = await ddb.send(
        new UpdateCommand({
          TableName: tableName(),
          Key: { pk, sk: SK + rid },
          UpdateExpression: 'SET #s = :ready, size = :size, updatedAt = :now',
          ExpressionAttributeNames: { '#s': 'status' },
          ExpressionAttributeValues: { ':ready': 'ready', ':size': head.ContentLength, ':now': new Date().toISOString() },
          ReturnValues: 'ALL_NEW',
        }),
      );
      return json(200, view(out.Attributes ?? {}));
    }

    case 'GET /resumes/{id}/download': {
      const item = await getItem(pk, id());
      if (item.status !== 'ready') throw new HttpError(404, 'Resume not found');
      const url = await getSignedUrl(
        s3,
        new GetObjectCommand({
          Bucket: bucket(),
          Key: String(item.key),
          ResponseContentType: String(item.contentType),
        }),
        { expiresIn: URL_TTL },
      );
      return json(200, { url, fileName: item.fileName, contentType: item.contentType });
    }

    case 'PATCH /resumes/{id}': {
      const rid = id();
      const body = renameResumeBody.parse(parseBody(event, 2_000));
      try {
        const out = await ddb.send(
          new UpdateCommand({
            TableName: tableName(),
            Key: { pk, sk: SK + rid },
            UpdateExpression: 'SET #n = :name, updatedAt = :now',
            ConditionExpression: 'attribute_exists(sk)',
            ExpressionAttributeNames: { '#n': 'name' },
            ExpressionAttributeValues: { ':name': body.name, ':now': new Date().toISOString() },
            ReturnValues: 'ALL_NEW',
          }),
        );
        return json(200, view(out.Attributes ?? {}));
      } catch (err) {
        if (isConditionalFailure(err)) throw new HttpError(404, 'Resume not found');
        throw err;
      }
    }

    case 'DELETE /resumes/{id}': {
      const rid = id();
      // The object first: a record without a file is harmless, a file without a record is not.
      await s3.send(new DeleteObjectCommand({ Bucket: bucket(), Key: objectKey(sub, rid) }));
      await ddb.send(new DeleteCommand({ TableName: tableName(), Key: { pk, sk: SK + rid } }));
      return json(204);
    }

    default:
      throw new HttpError(404, 'Not found');
  }
});
