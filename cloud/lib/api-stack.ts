import * as path from 'node:path';
import { CfnOutput, Duration, RemovalPolicy, Stack, type StackProps } from 'aws-cdk-lib';
import * as apigw from 'aws-cdk-lib/aws-apigatewayv2';
import { HttpUserPoolAuthorizer } from 'aws-cdk-lib/aws-apigatewayv2-authorizers';
import { HttpLambdaIntegration } from 'aws-cdk-lib/aws-apigatewayv2-integrations';
import * as cloudwatch from 'aws-cdk-lib/aws-cloudwatch';
import type * as cognito from 'aws-cdk-lib/aws-cognito';
import type * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as iam from 'aws-cdk-lib/aws-iam';
import type * as kms from 'aws-cdk-lib/aws-kms';
import type * as s3 from 'aws-cdk-lib/aws-s3';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as sns from 'aws-cdk-lib/aws-sns';
import * as subs from 'aws-cdk-lib/aws-sns-subscriptions';
import * as cwActions from 'aws-cdk-lib/aws-cloudwatch-actions';
import type { Construct } from 'constructs';
import type { AppConfig } from './config';

export interface ApiStackProps extends StackProps {
  readonly config: AppConfig;
  readonly table: dynamodb.ITableV2;
  readonly key: kms.IKey;
  readonly resumeBucket: s3.IBucket;
  readonly userPool: cognito.IUserPool;
  readonly clients: cognito.IUserPoolClient[];
  /** Dashboard origins known only at deploy time (the CloudFront URL), allowed by CORS. */
  readonly dashboardOrigins?: string[];
}

/** PRIVACY_POLICY.md: service logs are kept for 14 days. */
const LOG_RETENTION = logs.RetentionDays.TWO_WEEKS;

const ITEM_READ_WRITE = [
  'dynamodb:GetItem',
  'dynamodb:PutItem',
  'dynamodb:UpdateItem',
  'dynamodb:DeleteItem',
  'dynamodb:Query',
];

export class ApiStack extends Stack {
  readonly api: apigw.HttpApi;
  readonly alarmTopic: sns.Topic;

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table, key, userPool, clients, resumeBucket } = props;

    // ---------------------------------------------------------------- functions
    const fn = (
      name: string,
      entry: string,
      actions: string[],
      opts: { timeout?: Duration; memorySize?: number } = {},
    ) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: LOG_RETENTION,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const f = new NodejsFunction(this, name, {
        entry: path.join(__dirname, '..', 'src', 'functions', entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: opts.memorySize ?? 256,
        timeout: opts.timeout ?? Duration.seconds(10),
        tracing: lambda.Tracing.ACTIVE,
        logGroup,
        loggingFormat: lambda.LoggingFormat.JSON,
        environment: {
          TABLE_NAME: table.tableName,
          POWERTOOLS_SERVICE_NAME: name,
          NODE_OPTIONS: '--enable-source-maps',
        },
        bundling: { minify: true, sourceMap: true, target: 'node22' },
      });
      // Least privilege: only the item-level actions each function needs, plus the key.
      table.grant(f, ...actions);
      key.grantEncryptDecrypt(f);
      return f;
    };

    const profiles = fn('ProfilesFn', 'profiles/handler.ts', ITEM_READ_WRITE);
    const applications = fn('ApplicationsFn', 'applications/handler.ts', ITEM_READ_WRITE);
    const account = fn('AccountFn', 'account/handler.ts', ['dynamodb:Query', 'dynamodb:BatchWriteItem']);
    account.addEnvironment('USER_POOL_ID', userPool.userPoolId);
    account.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['cognito-idp:AdminDeleteUser', 'cognito-idp:AdminUserGlobalSignOut'],
        resources: [userPool.userPoolArn],
      }),
    );

    // Resume -> draft profile with Claude on Bedrock. Claude in us-east-2 is only
    // offered through the US cross-Region inference profile (plan/Key Decisions.md #7),
    // which the project SCP allows; the file is never stored.
    const MODEL_ID = 'us.anthropic.claude-haiku-4-5-20251001-v1:0';
    const BASE_MODEL = MODEL_ID.replace(/^us\./, '');
    const resumes = fn('ResumesFn', 'resumes/handler.ts', ['dynamodb:UpdateItem'], {
      timeout: Duration.seconds(29), // API Gateway's integration limit is 30 s
      memorySize: 512,
    });
    const invokeModel = new iam.PolicyStatement({
      actions: ['bedrock:InvokeModel'],
      resources: [
        `arn:aws:bedrock:${this.region}:${this.account}:inference-profile/${MODEL_ID}`,
        ...['us-east-1', 'us-east-2', 'us-west-2'].map(
          (r) => `arn:aws:bedrock:${r}::foundation-model/${BASE_MODEL}`,
        ),
      ],
    });
    resumes.addEnvironment('MODEL_ID', MODEL_ID);
    resumes.addEnvironment('AI_DAILY_LIMIT', '20');
    resumes.addEnvironment('GLOBAL_AI_DAILY_LIMIT', '300'); // all users together: bounds the daily Bedrock bill
    resumes.addToRolePolicy(invokeModel);

    // Phase 2: AI answers / adapt / match / categorise (F04, F11). Same model and
    // the same shared daily quota as resume reading.
    const ai = fn('AiFn', 'ai/handler.ts', ['dynamodb:UpdateItem'], {
      timeout: Duration.seconds(29),
      memorySize: 512,
    });
    ai.addEnvironment('MODEL_ID', MODEL_ID);
    ai.addEnvironment('AI_DAILY_LIMIT', '20');
    ai.addEnvironment('CATEGORISE_DAILY_LIMIT', '100');
    ai.addEnvironment('GLOBAL_AI_DAILY_LIMIT', '300');
    ai.addEnvironment('GLOBAL_CATEGORISE_DAILY_LIMIT', '2000');
    ai.addToRolePolicy(invokeModel);

    // Answer Library (F11): plain CRUD on ANSWER# items.
    const answersFn = fn('AnswersFn', 'answers/handler.ts', ITEM_READ_WRITE);

    // Resume Vault (F02): presigned upload/download; objects only under users/<sub>/.
    const vault = fn('VaultFn', 'vault/handler.ts', ITEM_READ_WRITE);
    vault.addEnvironment('RESUME_BUCKET', resumeBucket.bucketName);
    vault.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:PutObject', 's3:GetObject', 's3:DeleteObject'],
        resources: [resumeBucket.arnForObjects('users/*')],
      }),
    );

    // Account deletion also wipes the user's vault files.
    account.addEnvironment('RESUME_BUCKET', resumeBucket.bucketName);
    account.addToRolePolicy(
      new iam.PolicyStatement({
        actions: ['s3:ListBucket'],
        resources: [resumeBucket.bucketArn],
        conditions: { StringLike: { 's3:prefix': ['users/*'] } },
      }),
    );
    account.addToRolePolicy(
      new iam.PolicyStatement({ actions: ['s3:DeleteObject'], resources: [resumeBucket.arnForObjects('users/*')] }),
    );

    // ---------------------------------------------------------------- API
    // CORS is for the web dashboard only. API Gateway rejects chrome-extension://
    // origins, and the extension doesn't need CORS: an MV3 extension may call any
    // host listed in its manifest host_permissions (add the ApiUrl there).
    this.api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'easyapply-api',
      corsPreflight: {
        allowOrigins: [...config.dashboardUrls, ...(props.dashboardOrigins ?? [])],
        allowMethods: [
          apigw.CorsHttpMethod.GET,
          apigw.CorsHttpMethod.POST,
          apigw.CorsHttpMethod.PUT,
          apigw.CorsHttpMethod.PATCH,
          apigw.CorsHttpMethod.DELETE,
        ],
        allowHeaders: ['authorization', 'content-type'],
        maxAge: Duration.days(1),
      },
    });

    // Every route requires a valid Cognito access token from one of our clients.
    const authorizer = new HttpUserPoolAuthorizer('Cognito', userPool, { userPoolClients: clients });
    const route = (method: apigw.HttpMethod, p: string, target: lambda.IFunction, name: string) =>
      this.api.addRoutes({
        path: p,
        methods: [method],
        integration: new HttpLambdaIntegration(`${name}Integration`, target),
        authorizer,
      });
    const { GET, PUT, POST, PATCH, DELETE } = apigw.HttpMethod;
    route(GET, '/profiles', profiles, 'ListProfiles');
    route(GET, '/profiles/{id}', profiles, 'GetProfile');
    route(PUT, '/profiles/{id}', profiles, 'PutProfile');
    route(DELETE, '/profiles/{id}', profiles, 'DeleteProfile');
    route(GET, '/applications', applications, 'ListApplications');
    route(POST, '/applications', applications, 'CreateApplication');
    route(PATCH, '/applications/{id}', applications, 'UpdateApplication');
    route(DELETE, '/applications/{id}', applications, 'DeleteApplication');
    route(GET, '/insights', applications, 'GetInsights');
    route(DELETE, '/account', account, 'DeleteAccount');
    route(POST, '/resumes/parse', resumes, 'ParseResume');
    route(GET, '/resumes', vault, 'ListResumes');
    route(POST, '/resumes', vault, 'CreateResume');
    route(POST, '/resumes/{id}/confirm', vault, 'ConfirmResume');
    route(GET, '/resumes/{id}/download', vault, 'DownloadResume');
    route(PATCH, '/resumes/{id}', vault, 'RenameResume');
    route(DELETE, '/resumes/{id}', vault, 'DeleteResume');
    route(GET, '/answers', answersFn, 'ListAnswers');
    route(POST, '/answers', answersFn, 'CreateAnswer');
    route(PATCH, '/answers/{id}', answersFn, 'UpdateAnswer');
    route(POST, '/answers/{id}/use', answersFn, 'UseAnswer');
    route(DELETE, '/answers/{id}', answersFn, 'DeleteAnswer');
    route(POST, '/ai/answer', ai, 'AiAnswer');
    route(POST, '/ai/adapt', ai, 'AiAdapt');
    route(POST, '/ai/match', ai, 'AiMatch');
    route(POST, '/ai/categorise', ai, 'AiCategorise');

    // Throttling protects the bill; access logs record authorizer decisions (no bodies).
    const accessLogs = new logs.LogGroup(this, 'ApiAccessLogs', {
      retention: LOG_RETENTION,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    const stage = this.api.defaultStage?.node.defaultChild as apigw.CfnStage;
    stage.defaultRouteSettings = { throttlingRateLimit: 20, throttlingBurstLimit: 40 };
    stage.accessLogSettings = {
      destinationArn: accessLogs.logGroupArn,
      format: JSON.stringify({
        requestId: '$context.requestId',
        routeKey: '$context.routeKey',
        status: '$context.status',
        latency: '$context.responseLatency',
        authError: '$context.authorizer.error',
        integrationError: '$context.integrationErrorMessage',
      }),
    };

    // ---------------------------------------------------------------- alarms
    // Emailed through SNS. Alarm messages carry metric names and counts only, no
    // user data, so the topic uses SNS's default encryption at rest.
    this.alarmTopic = new sns.Topic(this, 'AlarmTopic', { displayName: 'EasyApply alarms' });
    this.alarmTopic.addToResourcePolicy(
      new iam.PolicyStatement({
        sid: 'DenyInsecureTransport',
        effect: iam.Effect.DENY,
        principals: [new iam.AnyPrincipal()],
        actions: ['sns:Publish'],
        resources: [this.alarmTopic.topicArn],
        conditions: { Bool: { 'aws:SecureTransport': 'false' } },
      }),
    );
    if (config.alarmEmail) this.alarmTopic.addSubscription(new subs.EmailSubscription(config.alarmEmail));
    const notify = new cwActions.SnsAction(this.alarmTopic);
    const alarm = (id: string, props: Omit<cloudwatch.AlarmProps, 'evaluationPeriods'>) => {
      const a = new cloudwatch.Alarm(this, id, {
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        evaluationPeriods: 1,
        ...props,
      });
      a.addAlarmAction(notify);
      a.addOkAction(notify);
      return a;
    };

    for (const f of [profiles, applications, account, resumes, ai, answersFn, vault]) {
      alarm(`${f.node.id}Errors`, {
        metric: f.metricErrors({ period: Duration.minutes(5) }),
        threshold: 1,
        alarmDescription: `${f.node.id} returned errors`,
      });
    }
    alarm('Api5xx', {
      metric: this.api.metricServerError({ period: Duration.minutes(5) }),
      threshold: 5,
      alarmDescription: 'API returned 5xx responses',
    });
    // A surge of resume reads is the one thing here that costs real money (Bedrock).
    alarm('ResumeParseSurge', {
      metric: resumes.metricInvocations({ period: Duration.hours(1) }),
      threshold: 200,
      alarmDescription: 'More than 200 resume reads in an hour (Bedrock cost)',
    });
    alarm('AiSurge', {
      metric: ai.metricInvocations({ period: Duration.hours(1) }),
      threshold: 500,
      alarmDescription: 'More than 500 AI calls in an hour (Bedrock cost)',
    });
    alarm('ResumeParseThrottled', {
      metric: resumes.metricThrottles({ period: Duration.minutes(5) }),
      threshold: 1,
      alarmDescription: 'Resume function throttled',
    });

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
    // The extension lists this host in optional_host_permissions to upload/download.
    new CfnOutput(this, 'ResumeBucketHost', { value: `${resumeBucket.bucketName}.s3.${this.region}.amazonaws.com` });
  }
}
