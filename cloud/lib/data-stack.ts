import { RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as kms from 'aws-cdk-lib/aws-kms';
import type { Construct } from 'constructs';

/**
 * Stateful resources live in their own stack with termination protection, so a
 * mistake in the API stack can never replace or delete user data.
 *
 * Single table, keyed by user (see plan/Services/DynamoDB.md):
 *   pk = USER#<sub>   sk = PROFILE#<id> | APP#<ts>-<rand> | RESUME#<id> | QUOTA#AI#<date>
 */
export class DataStack extends Stack {
  readonly key: kms.Key;
  readonly table: dynamodb.TableV2;

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
  }
}
