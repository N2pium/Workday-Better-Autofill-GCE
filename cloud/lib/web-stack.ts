import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import * as origins from 'aws-cdk-lib/aws-cloudfront-origins';
import * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';

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

    this.origin = `https://${this.distribution.distributionDomainName}`;
    new CfnOutput(this, 'DashboardUrl', { value: this.origin });
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
