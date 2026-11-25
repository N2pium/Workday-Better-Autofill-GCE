import * as path from 'node:path';
import { Duration, Stack, type StackProps } from 'aws-cdk-lib';
import type * as cloudfront from 'aws-cdk-lib/aws-cloudfront';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as s3deploy from 'aws-cdk-lib/aws-s3-deployment';
import type { Construct } from 'constructs';
import { ADAPTER_MAX_AGE, ADAPTER_PATH_PATTERN, ADAPTER_PREFIX } from './web-stack';

/** Signed packs built by tools/build-adapter-pack.mjs (committed, deploy needs no key). */
export const ADAPTER_DIST = path.join(__dirname, '..', '..', 'adapters', 'dist');

export interface AdapterContentStackProps extends StackProps {
  /** WebStack.adapterBucket: never the dashboard bucket. */
  readonly bucket: s3.IBucket;
  readonly distribution: cloudfront.IDistribution;
  /** Folder with <ats>.json + <ats>.json.sig. Defaults to the repo's adapters/dist/. */
  readonly sourceDir?: string;
}

/**
 * Uploads adapters/dist/ to the adapter bucket under adapters/ and invalidates
 * /adapters/*. Its own stack, depending only on EasyApply-Web, so a pack fix
 * ships with `cdk deploy EasyApply-Adapters --exclusively` without touching the
 * distribution, the dashboard, Auth or Api.
 *
 * Two deployments because BucketDeployment sets one Content-Type per
 * deployment: .json as application/json, .sig as text/plain. Each one filters
 * to its own file type, and `aws s3 sync --delete` never deletes files its
 * filters exclude, so their prune cannot remove each other's files.
 */
export class AdapterContentStack extends Stack {
  constructor(scope: Construct, id: string, props: AdapterContentStackProps) {
    super(scope, id, props);
    const source = s3deploy.Source.asset(props.sourceDir ?? ADAPTER_DIST);
    const common = {
      destinationBucket: props.bucket,
      destinationKeyPrefix: ADAPTER_PREFIX,
      sources: [source],
      prune: true,
      memoryLimit: 256,
      cacheControl: [s3deploy.CacheControl.maxAge(Duration.seconds(ADAPTER_MAX_AGE))],
    };

    const json = new s3deploy.BucketDeployment(this, 'Packs', {
      ...common,
      exclude: ['*'],
      include: ['*.json'],
      contentType: 'application/json',
    });

    // Signatures go up after the packs, and only then is the CDN invalidated,
    // so the edge never mixes a new signature with an old cached pack for long.
    const sig = new s3deploy.BucketDeployment(this, 'Signatures', {
      ...common,
      exclude: ['*'],
      include: ['*.sig'],
      contentType: 'text/plain', // base64 text
      distribution: props.distribution,
      distributionPaths: [ADAPTER_PATH_PATTERN],
    });
    sig.node.addDependency(json);
  }
}
