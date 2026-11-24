import { Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

/**
 * Stateful resources live in their own stack with termination protection, so a
 * mistake in the API stack can never replace or delete user data.
 *
 * Single table, keyed by user (see plan/Services/DynamoDB.md):
 *   pk = USER#<sub>   sk = PROFILE#<id> | APP#<id> | ANSWER#<id> | RESUME#<id> | QUOTA#<bucket>#<date>
 */
export class DataStack extends Stack {
  readonly key: kms.Key;
  readonly table: dynamodb.TableV2;
  readonly resumes: s3.Bucket;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    this.key = new kms.Key(this, 'DataKey', {
      alias: 'alias/easyapply-data',
      description: 'EasyApply user data (DynamoDB table, later the resume bucket)',
      enableKeyRotation: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    this.table = new dynamodb.TableV2(this, 'Table', {
      partitionKey: { name: 'pk', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'sk', type: dynamodb.AttributeType.STRING },
      billing: dynamodb.Billing.onDemand(),
      encryption: dynamodb.TableEncryptionV2.customerManagedKey(this.key),
      // PRIVACY_POLICY.md promises backups are kept for at most 35 days.
      pointInTimeRecoverySpecification: {
        pointInTimeRecoveryEnabled: true,
        recoveryPeriodInDays: 35,
      },
      timeToLiveAttribute: 'ttl',
      deletionProtection: true,
      removalPolicy: RemovalPolicy.RETAIN,
    });

    // Resume Vault (F02): opt-in resume files at users/<sub>/resumes/<id>.
    // Not versioned on purpose: deleting a resume or the account must really
    // delete the file (PRIVACY_POLICY.md), with no old versions left behind.
    this.resumes = new s3.Bucket(this, 'Resumes', {
      encryption: s3.BucketEncryption.KMS,
      encryptionKey: this.key,
      bucketKeyEnabled: true, // far fewer KMS requests, so lower cost
      blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
      enforceSSL: true,
      objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
      versioned: false,
      lifecycleRules: [{ abortIncompleteMultipartUploadAfter: Duration.days(1) }],
      removalPolicy: RemovalPolicy.RETAIN,
    });
  }
}
