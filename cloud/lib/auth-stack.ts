import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from 'aws-cdk-lib';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import type { Construct } from 'constructs';
import type { AppConfig } from './config';

export interface AuthStackProps extends StackProps {
  readonly config: AppConfig;
}

/**
 * Cognito user pool + managed login.
 *
 * Both clients are PUBLIC (no secret) and use the authorization-code grant with
 * PKCE. The extension signs in through chrome.identity.launchWebAuthFlow, which
 * redirects to https://<extension-id>.chromiumapp.org/.
 *
 * Sign-in method: PRIVACY_POLICY.md says users sign in with Google, so once a
 * Google client ID is configured Google is the ONLY provider on both clients.
 * Without one (early development) the clients fall back to Cognito's own
 * email sign-in so the stack is usable before the Google OAuth app exists.
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly extensionClient: cognito.UserPoolClient;
  readonly dashboardClient: cognito.UserPoolClient;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;

    this.userPool = new cognito.UserPool(this, 'UserPool', {
      userPoolName: 'easyapply-users',
      featurePlan: cognito.FeaturePlan.ESSENTIALS,
      selfSignUpEnabled: true,
      signInAliases: { email: true },
      autoVerify: { email: true },
      standardAttributes: { email: { required: true, mutable: true } },
      passwordPolicy: {
        minLength: 12,
        requireLowercase: true,
        requireUppercase: true,
        requireDigits: true,
        requireSymbols: false,
      },
      mfa: cognito.Mfa.OPTIONAL,
      mfaSecondFactor: { otp: true, sms: false },
      accountRecovery: cognito.AccountRecovery.EMAIL_ONLY,
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: config.domainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    let google: cognito.UserPoolIdentityProviderGoogle | undefined;
    if (config.googleClientId) {
      google = new cognito.UserPoolIdentityProviderGoogle(this, 'Google', {
        userPool: this.userPool,
        clientId: config.googleClientId,
        // Resolved by CloudFormation at deploy time; never written into the template.
        clientSecretValue: SecretValue.secretsManager(config.googleSecretName),
        scopes: ['openid', 'email', 'profile'],
        attributeMapping: {
          email: cognito.ProviderAttribute.GOOGLE_EMAIL,
          emailVerified: cognito.ProviderAttribute.GOOGLE_EMAIL_VERIFIED,
          fullname: cognito.ProviderAttribute.GOOGLE_NAME,
        },
      });
    }
    const providers = google
      ? [cognito.UserPoolClientIdentityProvider.GOOGLE]
      : [cognito.UserPoolClientIdentityProvider.COGNITO];

    const addClient = (name: string, callbackUrls: string[], logoutUrls: string[]) => {
      const client = this.userPool.addClient(name, {
        generateSecret: false,
        oAuth: {
          flows: { authorizationCodeGrant: true },
          scopes: [cognito.OAuthScope.OPENID, cognito.OAuthScope.EMAIL, cognito.OAuthScope.PROFILE],
          callbackUrls,
          logoutUrls,
        },
        supportedIdentityProviders: providers,
        preventUserExistenceErrors: true,
        enableTokenRevocation: true,
        accessTokenValidity: Duration.hours(1),
        idTokenValidity: Duration.hours(1),
        refreshTokenValidity: Duration.days(30),
      });
      if (google) client.node.addDependency(google);
      // Managed login v2 shows a broken page for any client without a branding style.
      new cognito.CfnManagedLoginBranding(this, `${name}Branding`, {
        userPoolId: this.userPool.userPoolId,
        clientId: client.userPoolClientId,
        useCognitoProvidedValues: true,
      });
      return client;
    };

    const extUrls = config.extensionIds.map((id) => `https://${id}.chromiumapp.org/`);
    this.extensionClient = addClient('ExtensionClient', extUrls, extUrls);
    this.dashboardClient = addClient(
      'DashboardClient',
      config.dashboardUrls.map((o) => `${o}/auth/callback`),
      config.dashboardUrls.map((o) => `${o}/`),
    );

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'ExtensionClientId', { value: this.extensionClient.userPoolClientId });
    new CfnOutput(this, 'DashboardClientId', { value: this.dashboardClient.userPoolClientId });
    new CfnOutput(this, 'LoginDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'SignInProvider', { value: google ? 'Google' : 'Cognito (dev only)' });
  }
}
