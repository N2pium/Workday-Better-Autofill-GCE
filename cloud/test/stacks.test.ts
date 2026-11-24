import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { loadConfig } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { WebStack } from '../lib/web-stack';

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
    env, config, table: data.table, key: data.key, resumeBucket: data.resumes, userPool: auth.userPool,
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

  it('offers email AND Google once configured, with the account-linking trigger', () => {
    const { auth } = synth({ googleClientId: 'abc.apps.googleusercontent.com' });
    auth.resourceCountIs('AWS::Cognito::UserPoolIdentityProvider', 1);
    const clients = auth.findResources('AWS::Cognito::UserPoolClient');
    for (const c of Object.values(clients)) {
      expect(c.Properties.SupportedIdentityProviders).toEqual(['COGNITO', 'Google']);
      expect(c.DependsOn).toEqual(expect.arrayContaining([expect.stringMatching(/^Google/)]));
    }
    auth.hasResourceProperties('AWS::Cognito::UserPool', {
      LambdaConfig: { PreSignUp: Match.anyValue() },
    });
    // The secret is a dynamic reference, never plaintext in the template.
    expect(JSON.stringify(auth.toJSON())).toContain('{{resolve:secretsmanager:');
  });
});

describe('ApiStack', () => {
  const { api } = synth();

  it('requires the JWT authorizer on every route', () => {
    const routes = api.findResources('AWS::ApiGatewayV2::Route');
    expect(Object.keys(routes)).toHaveLength(26);
    for (const r of Object.values(routes)) expect(r.Properties.AuthorizationType).toBe('JWT');
  });

  it('allows only http(s) dashboard origins in CORS (API Gateway rejects chrome-extension://)', () => {
    api.hasResourceProperties('AWS::ApiGatewayV2::Api', {
      CorsConfiguration: Match.objectLike({ AllowOrigins: ['http://localhost:5173'] }),
    });
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
    expect(Object.keys(fns)).toHaveLength(7);
    for (const f of Object.values(fns)) {
      expect(f.Properties.Runtime).toBe('nodejs22.x');
      expect(f.Properties.Architectures).toEqual(['arm64']);
      expect(f.Properties.TracingConfig).toEqual({ Mode: 'Active' });
      expect(f.Properties.VpcConfig).toBeUndefined();
    }
  });

  it('lets only the resume and AI functions call Bedrock, and only the one Haiku model via the US profile', () => {
    const policies = Object.values(api.findResources('AWS::IAM::Policy'));
    const withBedrock = policies.filter((p) => JSON.stringify(p).includes('bedrock:'));
    expect(withBedrock).toHaveLength(2);
    for (const p of withBedrock) {
    const text = JSON.stringify(p);
    expect(text).toContain('inference-profile/us.anthropic.claude-haiku-4-5-20251001-v1:0');
    for (const r of ['us-east-1', 'us-east-2', 'us-west-2']) {
      expect(text).toContain(`arn:aws:bedrock:${r}::foundation-model/anthropic.claude-haiku-4-5-20251001-v1:0`);
    }
    expect(text).not.toContain('bedrock:*');
    expect(text).not.toMatch(/foundation-model\/\*/);
    }
  });

  it('limits resume-bucket object access to users/* and never grants s3:*', () => {
    const policies = Object.values(api.findResources('AWS::IAM::Policy'));
    const text = JSON.stringify(policies);
    expect(text).not.toContain('"s3:*"');
    for (const p of policies) {
      for (const st of p.Properties.PolicyDocument.Statement) {
        const actions = [].concat(st.Action);
        if (actions.some((a: string) => /^s3:(Put|Get|Delete)Object$/.test(a))) {
          expect(JSON.stringify(st.Resource)).toContain('/users/*');
        }
      }
    }
  });

  it('gives the resume function room for a model call but stays under the API limit', () => {
    const fns = Object.values(api.findResources('AWS::Lambda::Function'));
    const resume = fns.find((f) => f.Properties.Environment?.Variables?.MODEL_ID);
    expect(resume?.Properties.Timeout).toBe(29);
  });

  it('grants no table Scan and no wildcard actions', () => {
    const text = JSON.stringify(api.findResources('AWS::IAM::Policy'));
    expect(text).not.toContain('dynamodb:Scan');
    expect(text).not.toContain('dynamodb:*');
  });
});

describe('alarms', () => {
  it('sends every alarm to the SNS topic, and emails only when alarmEmail is set', () => {
    const { api } = synth();
    const alarms = Object.values(api.findResources('AWS::CloudWatch::Alarm'));
    expect(alarms.length).toBeGreaterThanOrEqual(7);
    for (const a of alarms) expect(a.Properties.AlarmActions).toHaveLength(1);
    api.resourceCountIs('AWS::SNS::Subscription', 0);

    const withEmail = synth({ alarmEmail: 'ops@example.com' }).api;
    withEmail.hasResourceProperties('AWS::SNS::Subscription', { Protocol: 'email', Endpoint: 'ops@example.com' });
  });
  it('rejects a malformed alarm email', () => {
    expect(() => synth({ alarmEmail: 'nope' })).toThrow(/Not an email/);
  });
});

describe('WebStack', () => {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const web = Template.fromStack(new WebStack(app, 'Web', { env: { account: '111111111111', region: 'us-east-2' } }));

  it('keeps the bucket private behind CloudFront OAC', () => {
    web.hasResourceProperties('AWS::S3::Bucket', {
      PublicAccessBlockConfiguration: { BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true },
    });
    web.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
  });
  it('sends a strict CSP and HTTPS only', () => {
    web.hasResourceProperties('AWS::CloudFront::ResponseHeadersPolicy', {
      ResponseHeadersPolicyConfig: Match.objectLike({
        SecurityHeadersConfig: Match.objectLike({
          ContentSecurityPolicy: Match.objectLike({ ContentSecurityPolicy: Match.stringLikeRegexp("script-src 'self'") }),
        }),
      }),
    });
    web.hasResourceProperties('AWS::CloudFront::Distribution', {
      DistributionConfig: Match.objectLike({
        DefaultCacheBehavior: Match.objectLike({ ViewerProtocolPolicy: 'redirect-to-https' }),
      }),
    });
  });
});
