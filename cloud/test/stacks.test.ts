import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';

const EXT = 'abcdefghijklmnopabcdefghijklmnop';

function synth(extra: Record<string, unknown> = {}) {
  const app = new App({
    context: {
      'aws:cdk:bundling-stacks': [], // skip esbuild in unit tests
      domainPrefix: 'better-autofill',
      extensionIds: [EXT],
      dashboardUrls: ['http://localhost:5173'],
      ...extra,
    },
  });
  const config = loadConfig(app);
  const env = { account: '111111111111', region: 'us-east-2' };
  const data = new DataStack(app, 'Data', { env });
  const auth = new AuthStack(app, 'Auth', { env, config });
  const api = new ApiStack(app, 'Api', {
    env, config, table: data.table, key: data.key, userPool: auth.userPool,
    clients: [auth.extensionClient, auth.dashboardClient],
  });
  return {
    data: Template.fromStack(data),
    auth: Template.fromStack(auth),
    api: Template.fromStack(api),
  };
}

describe('config', () => {
  it('refuses to synth without an extension ID', () => {
    const app = new App({ context: { domainPrefix: 'x', extensionIds: [] } });
    expect(() => loadConfig(app)).toThrow(/extension ID/);
  });
  it('rejects a malformed extension ID', () => {
    const app = new App({ context: { domainPrefix: 'x', extensionIds: ['not-an-id'] } });
    expect(() => loadConfig(app)).toThrow(/Not a Chrome extension ID/);
  });
});

describe('DataStack', () => {
  const { data } = synth();

  it('keeps backups 35 days (privacy policy) and encrypts with the customer key', () => {
    data.hasResourceProperties('AWS::DynamoDB::GlobalTable', {
      Replicas: [
        Match.objectLike({
          PointInTimeRecoverySpecification: { PointInTimeRecoveryEnabled: true, RecoveryPeriodInDays: 35 },
          DeletionProtectionEnabled: true,
        }),
      ],
      SSESpecification: { SSEEnabled: true, SSEType: 'KMS' },
    });
    data.hasResourceProperties('AWS::KMS::Key', { EnableKeyRotation: true });
  });

  it('retains the table and key if the stack is deleted', () => {
    data.hasResource('AWS::DynamoDB::GlobalTable', { DeletionPolicy: 'Retain' });
    data.hasResource('AWS::KMS::Key', { DeletionPolicy: 'Retain' });
  });
});

describe('AuthStack', () => {
  it('uses public PKCE clients with the extension redirect URL', () => {
    const { auth } = synth();
    auth.hasResourceProperties('AWS::Cognito::UserPoolClient', {
      GenerateSecret: false,
      AllowedOAuthFlows: ['code'],
      CallbackURLs: [`https://${EXT}.chromiumapp.org/`],
      EnableTokenRevocation: true,
      SupportedIdentityProviders: ['COGNITO'],
    });
    auth.resourceCountIs('AWS::Cognito::ManagedLoginBranding', 2);
  });

  it('makes Google the only provider once configured', () => {
    const { auth } = synth({ googleClientId: 'abc.apps.googleusercontent.com' });
    auth.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 1);
    const clients = auth.findResources('AWS::Cognito::UserPoolClient');
    for (const c of Object.values(clients)) {
      expect(c.Properties.SupportedIdentityProviders).toEqual(['Google']);
      expect(c.DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^Google/)]));
    }
    // The secret is a dynamic reference, never plaintext in the template.
    expect(JSON.stringify(auth.toJSON())).toContain('{{resolve:secretsmanager:');
  });
});

describe('ApiStack', () => {
  const { api } = synth();

  it('requires the JWT authorizer on every route', () => {
    const routes = api.findResources('AWS::ApiGatewayV2::Route');
    expect(Object.keys(routes)).toHaveLength(9);
    for (const r of Object.values(routes)) expect(r.Properties.AuthorizationType).toBe('JWT');
  });

  it('throttles the stage and writes access logs', () => {
    api.hasResourceProperties('AWS::ApiGatewayV2::Stage', {
      DefaultRouteSettings: { ThrottlingRateLimit: 20, ThrottlingBurstLimit: 40 },
      AccessLogSettings: Match.objectLike({ DestinationArn: Match.anyValue() }),
    });
  });

  it('keeps every log group for 14 days (privacy policy)', () => {
    const groups = api.findResources('AWS::Logs::LogGroup');
    expect(Object.keys(groups).length).toBeGreaterThanOrEqual(4);
    for (const g of Object.values(groups)) expect(g.Properties.RetentionInDays).toBe(14);
  });

  it('runs functions on arm64 Node.js 22 with tracing, outside any VPC', () => {
    const fns = api.findResources('AWS::Lambda::Function');
    expect(Object.keys(fns)).toHaveLength(3);
    for (const f of Object.values(fns)) {
      expect(f.Properties.Runtime).toBe('nodejs22.x');
      expect(f.Properties.Architectures).toEqual(['arm64']);
      expect(f.Properties.TracingConfig).toEqual({ Mode: 'Active' });
      expect(f.Properties.VpcConfig).toBeUndefined();
    }
  });

  it('grants no table Scan and no wildcard actions', () => {
    const text = JSON.stringify(api.findResources('AWS::IAM::Policy'));
    expect(text).not.toContain('dynamodb:Scan');
    expect(text).not.toContain('dynamodb:*');
  });
});
