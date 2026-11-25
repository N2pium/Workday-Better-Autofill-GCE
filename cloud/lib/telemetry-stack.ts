import { CfnOutput, Duration, RemovalPolicy, Size, Stack, type StackProps } from 'aws-cdk-lib';
import * as athena from 'aws-cdk-lib/aws-athena';
import * as firehose from 'aws-cdk-lib/aws-kinesisfirehose';
import * as glue from 'aws-cdk-lib/aws-glue';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as s3 from 'aws-cdk-lib/aws-s3';
import type { Construct } from 'constructs';

/**
 * Anonymous, opt-in fill-failure telemetry (plan/Features/F07, Phase 3 Contracts §2).
 *
 *   POST /telemetry (ApiStack) -> TelemetryFn -> Firehose (Direct PUT)
 *     -> S3 events/dt=YYYY-MM-DD/*.gz (JSON lines, one line per event)
 *     -> Glue table (partition projection on dt) -> Athena workgroup
 *
 * Its own stack: the data here has its own retention (365 days, not the user
 * data's rules), holds nothing tied to an account, and can be torn down or
 * rebuilt without touching EasyApply-Data. It deploys BEFORE EasyApply-Api,
 * which only needs the delivery stream (to grant PutRecordBatch on it).
 */

/** PRIVACY_POLICY.md (at integration): anonymous failure reports kept at most 12 months. */
export const TELEMETRY_RETENTION_DAYS = 365;
export const ATHENA_RESULTS_RETENTION_DAYS = 30;
/** Firehose writes the arrival date (UTC) into the key; Athena projects partitions from it. */
export const EVENTS_PREFIX = 'events/dt=!{timestamp:yyyy-MM-dd}/';
export const ERRORS_PREFIX = 'errors/!{firehose:error-output-type}/dt=!{timestamp:yyyy-MM-dd}/';

export const GLUE_DATABASE = 'easyapply_telemetry';
export const GLUE_TABLE = 'fill_events';

export class TelemetryStack extends Stack {
  readonly bucket: s3.Bucket;
  readonly stream: firehose.DeliveryStream;

  constructor(scope: Construct, id: string, props: StackProps) {
    super(scope, id, props);

    // Anonymous data (no account, no IP, no labels, no values): SSE-S3 is
    // enough and avoids a $1/month KMS key plus per-request KMS charges.
    const privateBucket = (name: string, days: number) =>
      new s3.Bucket(this, name, {
        encryption: s3.BucketEncryption.S3_MANAGED,
        blockPublicAccess: s3.BlockPublicAccess.BLOCK_ALL,
        enforceSSL: true,
        objectOwnership: s3.ObjectOwnership.BUCKET_OWNER_ENFORCED,
        versioned: false, // expiry must really delete: no old versions left behind
        lifecycleRules: [
          { expiration: Duration.days(days), abortIncompleteMultipartUploadAfter: Duration.days(1) },
        ],
        removalPolicy: RemovalPolicy.RETAIN,
      });

    this.bucket = privateBucket('Events', TELEMETRY_RETENTION_DAYS);
    const results = privateBucket('AthenaResults', ATHENA_RESULTS_RETENTION_DAYS);

    // ------------------------------------------------------------ Firehose
    // Own role so the trust policy can carry the account condition (confused
    // deputy): only Firehose acting for THIS account may assume it.
    const role = new iam.Role(this, 'FirehoseRole', {
      assumedBy: new iam.ServicePrincipal('firehose.amazonaws.com', {
        conditions: { StringEquals: { 'sts:ExternalId': this.account } },
      }),
      description: 'Firehose delivery of anonymous telemetry to the telemetry bucket',
    });
    const deliveryLogs = new logs.LogGroup(this, 'FirehoseLogs', {
      retention: logs.RetentionDays.TWO_WEEKS,
      removalPolicy: RemovalPolicy.DESTROY,
    });

    this.stream = new firehose.DeliveryStream(this, 'Stream', {
      // Direct PUT is the default source (no `source`).
      encryption: firehose.StreamEncryption.awsOwnedKey(),
      role,
      destination: new firehose.S3Bucket(this.bucket, {
        role,
        dataOutputPrefix: EVENTS_PREFIX,
        errorOutputPrefix: ERRORS_PREFIX,
        compression: firehose.Compression.GZIP,
        fileExtension: '.json.gz',
        // Low volume: the longest buffer means fewer, larger objects (cheaper
        // S3 PUTs and faster Athena scans). Reports show up within 15 minutes.
        bufferingInterval: Duration.minutes(15),
        bufferingSize: Size.mebibytes(64),
        loggingConfig: new firehose.EnableLogging(deliveryLogs),
      }),
    });

    // ------------------------------------------------------------ Glue + Athena
    const database = new glue.CfnDatabase(this, 'Database', {
      catalogId: this.account,
      databaseInput: {
        name: GLUE_DATABASE,
        description: 'EasyApply anonymous fill-failure telemetry (F07)',
      },
    });

    const col = (name: string, type = 'string') => ({ name, type });
    const table = new glue.CfnTable(this, 'Table', {
      catalogId: this.account,
      databaseName: GLUE_DATABASE,
      tableInput: {
        name: GLUE_TABLE,
        tableType: 'EXTERNAL_TABLE',
        description: 'One row per telemetry event (see cloud/src/functions/telemetry/handler.ts)',
        parameters: {
          classification: 'json',
          compressionType: 'gzip',
          EXTERNAL: 'TRUE',
          // Partition projection: no crawler, no MSCK REPAIR, no partition API calls.
          'projection.enabled': 'true',
          'projection.dt.type': 'date',
          'projection.dt.format': 'yyyy-MM-dd',
          'projection.dt.range': '2026-11-01,NOW',
          'projection.dt.interval': '1',
          'projection.dt.interval.unit': 'DAYS',
          'storage.location.template': `s3://${this.bucket.bucketName}/events/dt=\${dt}/`,
        },
        partitionKeys: [col('dt')],
        storageDescriptor: {
          location: `s3://${this.bucket.bucketName}/events/`,
          inputFormat: 'org.apache.hadoop.mapred.TextInputFormat',
          outputFormat: 'org.apache.hadoop.hive.ql.io.HiveIgnoreKeyTextOutputFormat',
          compressed: true,
          serdeInfo: {
            serializationLibrary: 'org.openx.data.jsonserde.JsonSerDe',
            parameters: { 'ignore.malformed.json': 'true', 'case.insensitive': 'true' },
          },
          columns: [
            col('v', 'int'),
            col('ats'),
            col('tenant'),
            col('build'),
            col('pack', 'int'),
            col('type'),
            col('section'),
            col('field'),
            col('status'),
            col('reason'),
            col('fieldid'),
            col('kind'),
            col('receiveddate'),
          ],
        },
      },
    });
    table.addDependency(database);

    // Enforced config: every query in this workgroup writes encrypted results to
    // the results bucket (30-day expiry) and stops at 1 GB scanned (cost guard).
    const workgroup = new athena.CfnWorkGroup(this, 'WorkGroup', {
      name: 'easyapply-telemetry',
      description: 'Queries over anonymous fill-failure telemetry',
      recursiveDeleteOption: true,
      state: 'ENABLED',
      workGroupConfiguration: {
        enforceWorkGroupConfiguration: true,
        publishCloudWatchMetricsEnabled: true,
        bytesScannedCutoffPerQuery: 1024 * 1024 * 1024,
        engineVersion: { selectedEngineVersion: 'AUTO' },
        resultConfiguration: {
          outputLocation: `s3://${results.bucketName}/results/`,
          encryptionConfiguration: { encryptionOption: 'SSE_S3' },
        },
      },
    });

    new CfnOutput(this, 'TelemetryBucketName', { value: this.bucket.bucketName });
    new CfnOutput(this, 'TelemetryStreamName', { value: this.stream.deliveryStreamName });
    new CfnOutput(this, 'AthenaWorkGroup', { value: workgroup.name });
  }
}
