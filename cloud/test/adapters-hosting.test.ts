import * as path from 'node:path';
import { App } from 'aws-cdk-lib';
import { Match, Template } from 'aws-cdk-lib/assertions';
import { describe, expect, it } from 'vitest';
import { AdapterContentStack } from '../lib/adapter-content-stack';
import { WebContentStack, WebStack } from '../lib/web-stack';

// Stand-in for adapters/dist/ (stream A builds the real signed files).
const FIXTURE = path.join(__dirname, 'fixtures', 'adapters-dist');

function synth() {
  const app = new App({ context: { 'aws:cdk:bundling-stacks': [] } });
  const env = { account: '111111111111', region: 'us-east-2' };
  const web = new WebStack(app, 'Web', { env });
  const content = new WebContentStack(app, 'WebContent', {
    env, bucket: web.bucket, distribution: web.distribution,
    apiUrl: 'https://api.example.com', authDomain: 'auth.example.com', clientId: 'client',
  });
  const adapters = new AdapterContentStack(app, 'Adapters', {
    env, bucket: web.adapterBucket, distribution: web.distribution, sourceDir: FIXTURE,
  });
  return {
    web: Template.fromStack(web),
    content: Template.fromStack(content),
    adapters: Template.fromStack(adapters),
  };
}

const { web, content, adapters } = synth();
const resources = web.toJSON().Resources as Record<string, { Type: string; Properties: any }>;

function logicalId(type: string, prefix: string): string {
  const ids = Object.keys(resources).filter((id) => resources[id].Type === type && id.startsWith(prefix));
  expect(ids, `${type} ${prefix}*`).toHaveLength(1);
  return ids[0];
}

const adapterBucketId = logicalId('AWS::S3::Bucket', 'Adapters');
const distConfig = resources.Cdn9963B1AD?.Properties.DistributionConfig;
const adapterBehavior = distConfig?.CacheBehaviors?.find((b: any) => b.PathPattern === '/adapters/*');

describe('adapter bucket', () => {
  it('blocks public access and is encrypted', () => {
    expect(resources[adapterBucketId].Properties).toMatchObject({
      PublicAccessBlockConfiguration: {
        BlockPublicAcls: true, BlockPublicPolicy: true, IgnorePublicAcls: true, RestrictPublicBuckets: true,
      },
      BucketEncryption: {
        ServerSideEncryptionConfiguration: [{ ServerSideEncryptionByDefault: { SSEAlgorithm: 'AES256' } }],
      },
    });
    expect(resources[adapterBucketId].Properties.VersioningConfiguration).toBeUndefined();
  });

  it('denies non-TLS requests and only lets this distribution read it (OAC)', () => {
    web.hasResourceProperties('AWS::S3::BucketPolicy', {
      Bucket: { Ref: adapterBucketId },
      PolicyDocument: {
        Statement: Match.arrayWith([
          Match.objectLike({
            Effect: 'Deny', Action: 's3:*', Principal: { AWS: '*' },
            Condition: { Bool: { 'aws:SecureTransport': 'false' } },
          }),
          Match.objectLike({
            Effect: 'Allow', Action: 's3:GetObject', Principal: { Service: 'cloudfront.amazonaws.com' },
            Condition: {
              StringEquals: {
                'AWS:SourceArn': Match.objectLike({
                  'Fn::Join': Match.arrayWith([Match.arrayWith([{ Ref: 'Cdn9963B1AD' }])]),
                }),
              },
            },
          }),
        ]),
      },
    });
  });
});

describe('distribution', () => {
  it('keeps its logical id and existing resources (updated in place, not replaced)', () => {
    // Logical ids synthesized before the adapter change.
    const before: Record<string, string> = {
      SiteE53D7754: 'AWS::S3::Bucket',
      SitePolicyC4000D7D: 'AWS::S3::BucketPolicy',
      SiteAutoDeleteObjectsCustomResourceBFAA9B42: 'Custom::S3AutoDeleteObjects',
      CustomS3AutoDeleteObjectsCustomResourceProviderRole3B1BD092: 'AWS::IAM::Role',
      CustomS3AutoDeleteObjectsCustomResourceProviderHandler9D90184F: 'AWS::Lambda::Function',
      HeadersECA0794E: 'AWS::CloudFront::ResponseHeadersPolicy',
      CdnOrigin1S3OriginAccessControl6AC0AEFC: 'AWS::CloudFront::OriginAccessControl',
      Cdn9963B1AD: 'AWS::CloudFront::Distribution',
    };
    for (const [id, type] of Object.entries(before)) expect(resources[id]?.Type, id).toBe(type);
    web.resourceCountIs('AWS::CloudFront::Distribution', 1);
  });

  it('leaves the dashboard default behaviour and origin as they were', () => {
    expect(distConfig.DefaultCacheBehavior).toMatchObject({
      TargetOriginId: 'WebCdnOrigin1F6842090',
      ResponseHeadersPolicyId: { Ref: 'HeadersECA0794E' },
      ViewerProtocolPolicy: 'redirect-to-https',
    });
    expect(distConfig.Origins[0]).toMatchObject({
      Id: 'WebCdnOrigin1F6842090',
      DomainName: { 'Fn::GetAtt': ['SiteE53D7754', 'RegionalDomainName'] },
      OriginAccessControlId: { 'Fn::GetAtt': ['CdnOrigin1S3OriginAccessControl6AC0AEFC', 'Id'] },
    });
    expect(distConfig.DefaultRootObject).toBe('index.html');
  });

  it('serves /adapters/* from the adapter bucket through the existing OAC', () => {
    expect(adapterBehavior).toBeDefined();
    const origin = distConfig.Origins.find((o: any) => o.Id === adapterBehavior.TargetOriginId);
    expect(origin.Id).not.toBe('WebCdnOrigin1F6842090');
    expect(origin.DomainName).toEqual({ 'Fn::GetAtt': [adapterBucketId, 'RegionalDomainName'] });
    // Shares the dashboard's OAC: no new OAC, the live one is untouched.
    const oacId = origin.OriginAccessControlId['Fn::GetAtt'][0];
    expect(oacId).toBe('CdnOrigin1S3OriginAccessControl6AC0AEFC');
    web.resourceCountIs('AWS::CloudFront::OriginAccessControl', 1);
    expect(resources[oacId].Type).toBe('AWS::CloudFront::OriginAccessControl');
    expect(resources[oacId].Properties.OriginAccessControlConfig).toMatchObject({
      OriginAccessControlOriginType: 's3', SigningBehavior: 'always', SigningProtocol: 'sigv4',
    });
  });

  it('is GET/HEAD only, HTTPS-redirected and compressed', () => {
    expect(adapterBehavior).toMatchObject({
      AllowedMethods: ['GET', 'HEAD'],
      CachedMethods: ['GET', 'HEAD'],
      ViewerProtocolPolicy: 'redirect-to-https',
      Compress: true,
    });
  });

  it('caches 5 minutes with compression and no query string/header/cookie keys', () => {
    const id = adapterBehavior.CachePolicyId.Ref;
    expect(resources[id].Type).toBe('AWS::CloudFront::CachePolicy');
    expect(resources[id].Properties.CachePolicyConfig).toMatchObject({
      DefaultTTL: 300, MaxTTL: 300, MinTTL: 0,
      ParametersInCacheKeyAndForwardedToOrigin: {
        EnableAcceptEncodingGzip: true,
        EnableAcceptEncodingBrotli: true,
        QueryStringsConfig: { QueryStringBehavior: 'none' },
        HeadersConfig: { HeaderBehavior: 'none' },
        CookiesConfig: { CookieBehavior: 'none' },
      },
    });
  });

  it('adds CORS *, Cache-Control max-age=300 and security headers, without the dashboard CSP', () => {
    const id = adapterBehavior.ResponseHeadersPolicyId.Ref;
    expect(id).not.toBe('HeadersECA0794E');
    const cfg = resources[id].Properties.ResponseHeadersPolicyConfig;
    expect(cfg.CorsConfig).toMatchObject({
      AccessControlAllowOrigins: { Items: ['*'] },
      AccessControlAllowMethods: { Items: ['GET', 'HEAD'] },
      AccessControlAllowCredentials: false,
      OriginOverride: true,
    });
    expect(cfg.CustomHeadersConfig.Items).toEqual([
      { Header: 'Cache-Control', Value: 'max-age=300', Override: true },
    ]);
    expect(cfg.SecurityHeadersConfig).toMatchObject({
      StrictTransportSecurity: { Override: true, IncludeSubdomains: true },
      ContentTypeOptions: { Override: true },
      FrameOptions: { FrameOption: 'DENY' },
      ReferrerPolicy: { ReferrerPolicy: 'no-referrer' },
    });
    const csp: string = cfg.SecurityHeadersConfig.ContentSecurityPolicy.ContentSecurityPolicy;
    expect(csp).toContain("default-src 'none'");
    expect(csp).not.toContain('connect-src');
  });

  it('outputs the pack URL', () => {
    web.hasOutput('AdapterPackUrl', {
      Value: {
        'Fn::Join': ['', Match.arrayWith([Match.stringLikeRegexp('/adapters/workday\\.json$')])],
      },
    });
  });
});

/** The CDK BucketDeployment custom resources of a stack. */
function deployments(t: Template): any[] {
  return Object.values(t.findResources('Custom::CDKBucketDeployment')).map((r: any) => r.Properties);
}

/** Bucket name reference as written in the consuming stack (cross-stack form). */
function refersTo(value: unknown, producerLogicalId: string): boolean {
  return JSON.stringify(value).includes(producerLogicalId);
}

describe('adapter deployment', () => {
  const [packs, sigs] = (() => {
    const all = deployments(adapters);
    expect(all).toHaveLength(2);
    return [
      all.find((d) => d.SystemMetadata?.['content-type'] === 'application/json'),
      all.find((d) => d.SystemMetadata?.['content-type'] === 'text/plain'),
    ];
  })();

  it('writes only to the adapter bucket under adapters/', () => {
    for (const d of [packs, sigs]) {
      expect(d).toBeDefined();
      expect(refersTo(d.DestinationBucketName, adapterBucketId)).toBe(true);
      expect(refersTo(d.DestinationBucketName, 'SiteE53D7754')).toBe(false);
      expect(d.DestinationBucketKeyPrefix).toBe('adapters/');
    }
  });

  it('uploads .json as application/json and .sig as text/plain, each pruning only its own type', () => {
    expect(packs).toMatchObject({ Exclude: ['*'], Include: ['*.json'], Prune: true });
    expect(sigs).toMatchObject({ Exclude: ['*'], Include: ['*.sig'], Prune: true });
    for (const d of [packs, sigs]) expect(d.SystemMetadata['cache-control']).toBe('max-age=300');
  });

  it('invalidates only /adapters/* once both are uploaded', () => {
    expect(sigs.DistributionPaths).toEqual(['/adapters/*']);
    expect(refersTo(sigs.DistributionId, 'Cdn9963B1AD')).toBe(true);
    expect(packs.DistributionPaths).toBeUndefined();
    const sigRes = Object.values(adapters.findResources('Custom::CDKBucketDeployment'))
      .find((r: any) => r.Properties.SystemMetadata?.['content-type'] === 'text/plain') as any;
    const packsId = Object.entries(adapters.findResources('Custom::CDKBucketDeployment'))
      .find(([, r]: any) => r.Properties.SystemMetadata?.['content-type'] === 'application/json')![0];
    expect(sigRes.DependsOn).toContain(packsId);
  });
});

describe('dashboard deployment (unchanged)', () => {
  it('still targets only the dashboard bucket, prunes it and invalidates /*', () => {
    const all = deployments(content);
    expect(all).toHaveLength(1);
    const d = all[0];
    expect(refersTo(d.DestinationBucketName, 'SiteE53D7754')).toBe(true);
    expect(refersTo(d.DestinationBucketName, adapterBucketId)).toBe(false);
    expect(d.DestinationBucketKeyPrefix).toBeUndefined();
    expect(d.Prune).toBe(true);
    expect(d.DistributionPaths).toEqual(['/*']);
  });
});
