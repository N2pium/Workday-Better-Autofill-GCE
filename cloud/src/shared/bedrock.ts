import { BedrockRuntimeClient, type ConverseCommand } from '@aws-sdk/client-bedrock-runtime';
import { HttpError, logger } from './http';

const bedrock = new BedrockRuntimeClient({});
export const MODEL_ID = process.env.MODEL_ID ?? 'us.anthropic.claude-haiku-4-5-20251001-v1:0';

/**
 * Bedrock failures the user can't fix get a plain message instead of "Internal error".
 * The full error still goes to the logs (metadata only) so the operator can.
 * `what` names the feature in messages, e.g. "Resume reading" or "AI drafting".
 */
export async function callModel(command: ConverseCommand, what = 'AI drafting', tooLong = 'That took too long. Try again.') {
  try {
    return await bedrock.send(command);
  } catch (err) {
    const name = (err as { name?: string }).name ?? 'Error';
    logger.error('Bedrock call failed', { errorName: name, error: err as Error });
    if (name === 'ThrottlingException' || name === 'ServiceUnavailableException') {
      throw new HttpError(503, `${what} is busy right now. Try again in a minute.`);
    }
    if (name === 'ModelTimeoutException') throw new HttpError(504, tooLong);
    if (name === 'ValidationException') throw new HttpError(422, `${what} couldn't use that input.`);
    if (name === 'AccessDeniedException' || name === 'ResourceNotFoundException') {
      // e.g. the Bedrock model agreement / use-case form isn't complete for this AWS account.
      throw new HttpError(503, `${what} isn't switched on yet. Please try again later.`);
    }
    throw err;
  }
}

/** Text of the first text block in a Converse reply. */
export function replyText(out: Awaited<ReturnType<typeof callModel>>): string {
  return (out.output?.message?.content ?? []).map((b) => b.text ?? '').join('').trim();
}
