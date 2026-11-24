import { CfnOutput, Duration, RemovalPolicy, SecretValue, Stack, type StackProps } from 'aws-cdk-lib';
import * as path from 'node:path';
import * as cognito from 'aws-cdk-lib/aws-cognito';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { AppConfig } from './config';

export interface AuthStackProps extends StackProps {
  readonly config: AppConfig;
  /** Dashboard origins known only at deploy time (the CloudFront URL from EasyApply-Web). */
  readonly dashboardOrigins?: string[];
}

/**
 * Cognito user pool + managed login.
 *
 * Both clients are PUBLIC (no secret) and use the authorization-code grant with
 * PKCE. The extension signs in through chrome.identity.launchWebAuthFlow, which
 * redirects to https://<extension-id>.chromiumapp.org/.
 *
 * Sign-in methods: email/password always, plus Google once a Google client ID
 * is configured. The pre sign-up trigger (src/functions/link) keeps it to ONE
 * account per verified email, so Google and email reach the same data.
 */
export class AuthStack extends Stack {
  readonly userPool: cognito.UserPool;
  readonly extensionClient: cognito.UserPoolClient;
  readonly dashboardClient: cognito.UserPoolClient;
  /** https://<prefix>.auth.<region>.amazoncognito.com */
  readonly loginDomain: string;

  constructor(scope: Construct, id: string, props: AuthStackProps) {
    super(scope, id, props);
    const { config } = props;
    const dashboardOrigins = [...config.dashboardUrls, ...(props.dashboardOrigins ?? [])];

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

    const linkFn = new NodejsFunction(this, 'LinkAccountsFn', {
      entry: path.join(__dirname, '..', 'src', 'functions', 'link', 'handler.ts'),
      handler: 'handler',
      runtime: lambda.Runtime.NODEJS_22_X,
      architecture: lambda.Architecture.ARM_64,
      memorySize: 256,
      timeout: Duration.seconds(5), // Cognito waits at most 5 s for a trigger
      logGroup: new logs.LogGroup(this, 'LinkAccountsFnLogs', {
        retention: logs.RetentionDays.TWO_WEEKS,
        removalPolicy: RemovalPolicy.DESTROY,
      }),
      loggingFormat: lambda.LoggingFormat.JSON,
      bundling: { minify: true, sourceMap: true, target: 'node22' },
    });
    // Pool ARN by pattern: referencing the pool here would be a cycle (the pool
    // references this function as its trigger).
    linkFn.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:ListUsers', 'cognito-idp:AdminLinkProviderForUser'],
        resources: [Stack.of(this).formatArn({ service: 'cognito-idp', resource: 'userpool', resourceName: '*' })],
      }),
    );
    this.userPool.addTrigger(cognito.UserPoolOperation.PRE_SIGN_UP, linkFn);

    const domain = this.userPool.addDomain('Domain', {
      cognitoDomain: { domainPrefix: config.domainPrefix },
      managedLoginVersion: cognito.ManagedLoginVersion.NEWER_MANAGED_LOGIN,
    });

    this.loginDomain = domain.baseUrl();

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
      ? [cognito.UserPoolClientIdentityProvider.COGNITO, cognito.UserPoolClientIdentityProvider.GOOGLE]
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
      dashboardOrigins.map((o) => `${o}/auth/callback`),
      dashboardOrigins.map((o) => `${o}/`),
    );

    new CfnOutput(this, 'UserPoolId', { value: this.userPool.userPoolId });
    new CfnOutput(this, 'ExtensionClientId', { value: this.extensionClient.userPoolClientId });
    new CfnOutput(this, 'DashboardClientId', { value: this.dashboardClient.userPoolClientId });
    new CfnOutput(this, 'LoginDomain', { value: domain.baseUrl() });
    new CfnOutput(this, 'SignInProvider', { value: google ? 'Email + Google' : 'Email only' });
  }
}
