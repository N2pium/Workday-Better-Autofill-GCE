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
import * as lambda from 'aws-cdk-lib/aws-lambda';
import { NodejsFunction } from 'aws-cdk-lib/aws-lambda-nodejs';
import * as logs from 'aws-cdk-lib/aws-logs';
import type { Construct } from 'constructs';
import type { AppConfig } from './config';

export interface ApiStackProps extends StackProps {
  readonly config: AppConfig;
  readonly table: dynamodb.ITableV2;
  readonly key: kms.IKey;
  readonly userPool: cognito.IUserPool;
  readonly clients: cognito.IUserPoolClient[];
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

  constructor(scope: Construct, id: string, props: ApiStackProps) {
    super(scope, id, props);
    const { config, table, key, userPool, clients } = props;

    // ---------------------------------------------------------------- functions
    const fn = (name: string, entry: string, actions: string[]) => {
      const logGroup = new logs.LogGroup(this, `${name}Logs`, {
        retention: LOG_RETENTION,
        removalPolicy: RemovalPolicy.DESTROY,
      });
      const f = new NodejsFunction(this, name, {
        entry: path.join(__dirname, '..', 'src', 'functions', entry),
        handler: 'handler',
        runtime: lambda.Runtime.NODEJS_22_X,
        architecture: lambda.Architecture.ARM_64,
        memorySize: 256,
        timeout: Duration.seconds(10),
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

    // ---------------------------------------------------------------- API
    // CORS is for the web dashboard only. API Gateway rejects chrome-extension://
    // origins, and the extension doesn't need CORS: an MV3 extension may call any
    // host listed in its manifest host_permissions (add the ApiUrl there).
    this.api = new apigw.HttpApi(this, 'HttpApi', {
      apiName: 'easyapply-api',
      corsPreflight: {
        allowOrigins: config.dashboardUrls,
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
    route(DELETE, '/account', account, 'DeleteAccount');

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
    // No notification target yet; they show in the CloudWatch console. Wire an
    // SNS topic here once there is an address to page.
    for (const f of [profiles, applications, account]) {
      new cloudwatch.Alarm(this, `${f.node.id}Errors`, {
        metric: f.metricErrors({ period: Duration.minutes(5) }),
        threshold: 1,
        evaluationPeriods: 1,
        treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
        alarmDescription: `${f.node.id} returned errors`,
      });
    }
    new cloudwatch.Alarm(this, 'Api5xx', {
      metric: this.api.metricServerError({ period: Duration.minutes(5) }),
      threshold: 5,
      evaluationPeriods: 1,
      treatMissingData: cloudwatch.TreatMissingData.NOT_BREACHING,
      alarmDescription: 'API returned 5xx responses',
    });

    new CfnOutput(this, 'ApiUrl', { value: this.api.apiEndpoint });
  }
}
