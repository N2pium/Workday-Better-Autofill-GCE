import { Logger } from '@aws-lambda-powertools/logger';
import type {
  APIGatewayProxyEventV2WithJWTAuthorizer as Event,
  APIGatewayProxyStructuredResultV2 as Result,
} from 'aws-lambda';
import { ZodError } from 'zod';

export type { Event, Result };

export const logger = new Logger();

export class HttpError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export const json = (statusCode: number, body?: unknown): Result => ({
  statusCode,
  headers: { 'content-type': 'application/json' },
  body: body === undefined ? '' : JSON.stringify(body),
});

/** The caller's Cognito subject, set by the API Gateway JWT authorizer. */
export function callerSub(event: Event): string {
  const sub = event.requestContext.authorizer?.jwt?.claims?.sub;
  if (typeof sub !== 'string' || !sub) throw new HttpError(401, 'Unauthorized');
  return sub;
}

/** The caller's Cognito username (differs from sub for federated users, e.g. Google_123). */
export function callerUsername(event: Event): string {
  const claims = event.requestContext.authorizer?.jwt?.claims ?? {};
  const name = claims['username'] ?? claims['cognito:username'];
  if (typeof name !== 'string' || !name) throw new HttpError(401, 'Unauthorized');
  return name;
}

export const MAX_BODY_BYTES = 100_000;

export function parseBody(event: Event, maxBytes = MAX_BODY_BYTES): unknown {
  if (!event.body) throw new HttpError(400, 'Request body required');
  const raw = event.isBase64Encoded ? Buffer.from(event.body, 'base64').toString('utf8') : event.body;
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new HttpError(413, 'Request body too large');
  try {
    return JSON.parse(raw);
  } catch {
    throw new HttpError(400, 'Body is not valid JSON');
  }
}

/** Turns thrown errors into JSON responses. Never logs request bodies (they are PII). */
export function handle(fn: (event: Event) => Promise<Result>) {
  return async (event: Event): Promise<Result> => {
    try {
      return await fn(event);
    } catch (err) {
      if (err instanceof HttpError) return json(err.status, { error: err.message });
      if (err instanceof ZodError) {
        return json(400, {
          error: 'Validation failed',
          issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
        });
      }
      logger.error('Unhandled error', { routeKey: event.routeKey, error: err as Error });
      return json(500, { error: 'Internal error' });
    }
  };
}
