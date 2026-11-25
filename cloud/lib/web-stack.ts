import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

/** Key prefix of adapter packs in their bucket; CloudFront forwards the full path. */
export const ADAPTER_PREFIX = 'adapters/';
export const ADAPTER_PATH_PATTERN = `/${ADAPTER_PREFIX}*`;
/** Seconds an adapter pack may be cached (edge and browser). */
export const ADAPTER_MAX_AGE = 300;

/**
 * Web dashboard hosting: private S3 bucket behind CloudFront (Origin Access
 * Control). Split from the content (WebContentStack) because Cognito needs the
 * CloudFront URL for its callback, and the page needs Cognito's client ID:
 * Web -> Auth -> Api -> WebContent has no cycle.
 *
 * No WAF yet (plan/Cost.md: avoid early WAF; it is a fixed monthly charge). The
 * site is static and every API call still needs a Cognito token.
 */
export class WebStack extends Stack {
  readonly bucket: s3.Bucket;
  /** Private bucket for signed adapter packs, served at /adapters/*. */
  readonly adapterBucket: s3.Bucket;
  readonly distribution: cloudfront.Distribution;
  /** https://dxxxx.cloudfront.net */
  readonly origin: string;

  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    this.bucket = new s3.Bucket(this, 'Site', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      // Only build output lives here; it is redeployed from the repo on every deploy.
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    const headers = new cloudfront.ResponseHeadersPolicy(this, 'Headers', {
      securityHeadersBehavior: {
        contentSecurityPolicy: {
          override: true,
          contentSecurityPolicy: [
            "default-src 'self'",
            "script-src 'self'",
            "style-src 'self'",
            "img-src 'self' data:",
            `connect-src 'self' https://*.execute-api.${this.region}.amazonaws.com https://*.auth.${this.region}.amazoncognito.com`,
            "frame-ancestors 'none'",
            "base-uri 'none'",
            "form-action 'self'",
          ].join('; '),
        },
        strictTransportSecurity: { override: true, accessControlMaxAge: Duration.days(365), includeSubdomains: true },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cloudfront.HeadersFrameOption.DENY },
        referrerPolicy: { override: true, referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER },
      },
    });

    // Remote adapter packs (plan/Phase 3 Contracts.md section 1). Their own
    // private bucket, so the dashboard deployment (prune + '/*') can never touch
    // them and vice versa. It lives in this stack because the OAC bucket policy
    // needs the distribution ARN: a bucket in another stack would form a cycle.
    // Packs are signed build artifacts redeployed from adapters/dist/, so no
    // versioning and nothing to retain.
    this.adapterBucket = new s3.Bucket(this, 'Adapters', {
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      encryption: s3.BucketEncryption.S3_MANAGED,
      enforceSSL: true,
      removalPolicy: RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    // 5 minutes everywhere: the edge, the browser (Cache-Control) and the deploy invalidation.
    const adapterTtl = Duration.seconds(ADAPTER_MAX_AGE);
    const adapterCache = new cloudfront.CachePolicy(this, 'AdapterCache', {
      comment: 'EasyApply adapter packs: 5 min, no query strings, headers or cookies',
      defaultTtl: adapterTtl,
      maxTtl: adapterTtl,
      minTtl: Duration.seconds(0),
      enableAcceptEncodingGzip: true,
      enableAcceptEncodingBrotli: true,
    });

    // CORS lets the extension's service worker fetch without a host permission.
    // The pack is public, signed data: '*' leaks nothing. No credentials.
    // The dashboard CSP is NOT reused (JSON needs no script/connect rules); a
    // deny-everything CSP is enough for a data file.
    const adapterHeaders = new cloudfront.ResponseHeadersPolicy(this, 'AdapterHeaders', {
      comment: 'EasyApply adapter packs: CORS *, 5 min cache, security headers',
      corsBehavior: {
        accessControlAllowOrigins: ['*'],
        accessControlAllowMethods: ['GET', 'HEAD'],
        accessControlAllowHeaders: ['*'],
        accessControlAllowCredentials: false,
        accessControlMaxAge: Duration.days(1),
        originOverride: true,
      },
      customHeadersBehavior: {
        customHeaders: [{ header: 'Cache-Control', value: `max-age=${ADAPTER_MAX_AGE}`, override: true }],
      },
      securityHeadersBehavior: {
        contentSecurityPolicy: { override: true, contentSecurityPolicy: "default-src 'none'; frame-ancestors 'none'" },
        strictTransportSecurity: { override: true, accessControlMaxAge: Duration.days(365), includeSubdomains: true },
        contentTypeOptions: { override: true },
        frameOptions: { override: true, frameOption: cloudfront.HeadersFrameOption.DENY },
        referrerPolicy: { override: true, referrerPolicy: cloudfront.HeadersReferrerPolicy.NO_REFERRER },
      },
    });

    this.distribution = new cloudfront.Distribution(this, 'Cdn', {
      comment: 'EasyApply dashboard',
      defaultRootObject: 'index.html',
      priceClass: cloudfront.PriceClass.PRICE_CLASS_100,
      httpVersion: cloudfront.HttpVersion.HTTP2_AND_3,
      defaultBehavior: {
        origin: origins.S3BucketOrigin.withOriginAccessControl(this.bucket),
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        cachePolicy: cloudfront.CachePolicy.CACHING_OPTIMIZED,
        responseHeadersPolicy: headers,
      },
      // Single-page app: /auth/callback and other paths are served index.html.
      errorResponses: [403, 404].map((httpStatus) => ({
        httpStatus,
        responseHttpStatus: 200,
        responsePagePath: '/index.html',
        ttl: Duration.seconds(0),
      })),
    });

    // Added after the default behaviour so the dashboard origin keeps its id
    // (Origin1) and the distribution is updated in place, never replaced. The
    // adapter origin reuses the dashboard's Origin Access Control (an OAC is
    // only "sign S3 requests with SigV4" and may serve many origins), so the
    // live OAC is untouched and no second one is created.
    const oac = this.distribution.node.tryFindChild('Origin1')?.node.tryFindChild('S3OriginAccessControl');
    if (!(oac instanceof cloudfront.S3OriginAccessControl)) {
      throw new Error('Dashboard Origin Access Control not found (aws-cdk-lib changed its construct path?)');
    }
    this.distribution.addBehavior(
      ADAPTER_PATH_PATTERN,
      origins.S3BucketOrigin.withOriginAccessControl(this.adapterBucket, { originAccessControl: oac }),
      {
        viewerProtocolPolicy: cloudfront.ViewerProtocolPolicy.REDIRECT_TO_HTTPS,
        allowedMethods: cloudfront.AllowedMethods.ALLOW_GET_HEAD,
        cachedMethods: cloudfront.CachedMethods.CACHE_GET_HEAD,
        cachePolicy: adapterCache,
        responseHeadersPolicy: adapterHeaders,
        compress: true,
      },
    );

    this.origin = `https://${this.distribution.distributionDomainName}`;
    new CfnOutput(this, 'DashboardUrl', { value: this.origin });
    new CfnOutput(this, 'AdapterPackUrl', { value: `${this.origin}/${ADAPTER_PREFIX}workday.json` });
  }
}

export interface WebContentStackProps extends StackProps {
  readonly bucket: s3.IBucket;
  readonly distribution: cloudfront.IDistribution;
  readonly apiUrl: string;
  readonly authDomain: string;
  readonly clientId: string;
}

/** Uploads dashboard/ plus a generated config.json, then invalidates the CDN. */
export class WebContentStack extends Stack {
  constructor(scope: Construct, id: string, props: WebContentStackProps) {
    super(scope, id, props);
    new s3deploy.BucketDeployment(this, 'Deploy', {
      destinationBucket: props.bucket,
      distribution: props.distribution,
      distributionPaths: ['/*'],
      memoryLimit: 256,
      sources: [
        s3deploy.Source.asset(path.join(__dirname, '..', '..', 'dashboard')),
        // Public values only; every API call still needs the user's own token.
        s3deploy.Source.jsonData('config.json', {
          apiUrl: props.apiUrl,
          authDomain: props.authDomain,
          clientId: props.clientId,
          scopes: ['openid', 'email', 'profile'],
        }),
      ],
    });
  }
}
