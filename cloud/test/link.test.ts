import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PreSignUpTriggerEvent } from 'aws-lambda';
import { mockClient } from 'aws-sdk-client-mock';
import { beforeEach, describe, expect, it } from 'vitest';
import { handler } from '../src/functions/link/handler';

const cognito = mockClient(CognitoIdentityProviderClient);
beforeEach(() => cognito.reset());

const ev = (triggerSource: string, userName: string, attrs: Record<string, string>) =>
  ({ triggerSource, userName, userPoolId: 'us-east-2_test', request: { userAttributes: attrs }, response: {} }) as unknown as PreSignUpTriggerEvent;

const native = (verified: boolean) => ({
  Username: 'native-uuid', UserStatus: 'CONFIRMED' as const,
  Attributes: [{ Name: 'email', Value: 'a@b.com' }, { Name: 'email_verified', Value: String(verified) }],
});
const googleUser = { Username: 'google_999', UserStatus: 'EXTERNAL_PROVIDER' as const, Attributes: [] };

describe('pre sign-up account linking', () => {
  it('links a verified Google sign-up to the verified email user', async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [native(true)] });
    cognito.on(AdminLinkProviderForUserCommand).resolves({});
    await handler(ev('PreSignUp_ExternalProvider', 'google_123', { email: 'A@b.com', email_verified: 'true' }));
    const call = cognito.commandCalls(AdminLinkProviderForUserCommand)[0].args[0].input;
    expect(call.DestinationUser).toEqual({ ProviderName: 'Cognito', ProviderAttributeValue: 'native-uuid' });
    expect(call.SourceUser).toEqual({ ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: '123' });
    expect(cognito.commandCalls(ListUsersCommand)[0].args[0].input.Filter).toBe('email = "a@b.com"');
  });

  it('does not link when Google says the email is unverified', async () => {
    await handler(ev('PreSignUp_ExternalProvider', 'google_123', { email: 'a@b.com', email_verified: 'false' }));
    expect(cognito.commandCalls(ListUsersCommand)).toHaveLength(0);
  });

  it('does not link to an email user who never verified', async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [native(false)] });
    await handler(ev('PreSignUp_ExternalProvider', 'google_123', { email: 'a@b.com', email_verified: 'true' }));
    expect(cognito.commandCalls(AdminLinkProviderForUserCommand)).toHaveLength(0);
  });

  it('lets a brand-new Google user through', async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [] });
    const out = await handler(ev('PreSignUp_ExternalProvider', 'google_123', { email: 'a@b.com', email_verified: 'true' }));
    expect(out.userName).toBe('google_123');
    expect(cognito.commandCalls(AdminLinkProviderForUserCommand)).toHaveLength(0);
  });

  it('refuses an email sign-up when a Google user owns the address', async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [googleUser] });
    await expect(handler(ev('PreSignUp_SignUp', 'x', { email: 'a@b.com' }))).rejects.toThrow(/Continue with Google/);
  });

  it('allows a normal email sign-up', async () => {
    cognito.on(ListUsersCommand).resolves({ Users: [] });
    await expect(handler(ev('PreSignUp_SignUp', 'x', { email: 'a@b.com' }))).resolves.toBeTruthy();
  });

  it('never builds a filter from an email containing quotes', async () => {
    await handler(ev('PreSignUp_ExternalProvider', 'google_1', { email: 'a"@b.com', email_verified: 'true' }));
    expect(cognito.commandCalls(ListUsersCommand)).toHaveLength(0);
  });
});
