import {
  AdminLinkProviderForUserCommand,
  CognitoIdentityProviderClient,
  ListUsersCommand,
  type UserType,
} from '@aws-sdk/client-cognito-identity-provider';
import type { PreSignUpTriggerEvent } from 'aws-lambda';

/*
 * Cognito pre sign-up trigger: one account per email across email and Google.
 *
 * Cognito makes a separate user for every provider, and data is keyed by the
 * user's `sub`, so signing in with Google as an existing email user would open
 * a second, empty account. Here:
 *
 *  - Google sign-up, and a verified email/password user has the same verified
 *    address -> link Google to that user. Later Google sign-ins ARE that user
 *    (same sub, same profile and applications).
 *  - Email/password sign-up, and a Google user already has the address ->
 *    refuse, and say to use Google.
 *
 * Both checks need verified addresses on both sides; linking on an unverified
 * email would let anyone take over an account by claiming its address.
 */

const cognito = new CognitoIdentityProviderClient({});

const attr = (u: UserType, name: string) => u.Attributes?.find((a) => a.Name === name)?.Value;

export async function usersWithEmail(userPoolId: string, email: string): Promise<UserType[]> {
  // ListUsers filters are exact-match strings; quotes in the value would break out.
  if (/["\\]/.test(email)) return [];
  const out = await cognito.send(
    new ListUsersCommand({ UserPoolId: userPoolId, Filter: `email = "${email}"`, Limit: 10 }),
  );
  return out.Users ?? [];
}

export const handler = async (event: PreSignUpTriggerEvent): Promise<PreSignUpTriggerEvent> => {
  const email = (event.request.userAttributes.email ?? '').trim().toLowerCase();
  if (!email) return event;

  if (event.triggerSource === 'PreSignUp_ExternalProvider') {
    // userName is "<provider>_<provider subject>", e.g. "google_1234567890".
    const sep = event.userName.indexOf('_');
    const provider = event.userName.slice(0, sep);
    const subject = event.userName.slice(sep + 1);
    if (provider.toLowerCase() !== 'google' || !subject) return event;
    if (event.request.userAttributes.email_verified !== 'true') return event;

    const native = (await usersWithEmail(event.userPoolId, email)).find(
      (u) => u.UserStatus !== 'EXTERNAL_PROVIDER' && attr(u, 'email_verified') === 'true',
    );
    if (!native?.Username) return event; // nobody to link to: a new Google-only account

    await cognito.send(
      new AdminLinkProviderForUserCommand({
        UserPoolId: event.userPoolId,
        DestinationUser: { ProviderName: 'Cognito', ProviderAttributeValue: native.Username },
        SourceUser: { ProviderName: 'Google', ProviderAttributeName: 'Cognito_Subject', ProviderAttributeValue: subject },
      }),
    );
    return event;
  }

  if (event.triggerSource === 'PreSignUp_SignUp') {
    const google = (await usersWithEmail(event.userPoolId, email)).some((u) => u.UserStatus === 'EXTERNAL_PROVIDER');
    if (google) throw new Error('This email already signs in with Google. Use "Continue with Google".');
  }

  return event;
};
