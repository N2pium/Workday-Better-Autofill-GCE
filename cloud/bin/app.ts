#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { loadConfig, REGION } from '../lib/config';
import { DataStack } from '../lib/data-stack';
import { TelemetryStack } from '../lib/telemetry-stack';
import { WebContentStack, WebStack } from '../lib/web-stack';

const app = new App();
const config = loadConfig(app);
// Region is fixed: this AWS project may only create Regional resources in us-east-2.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

const data = new DataStack(app, 'EasyApply-Data', { env, terminationProtection: true });
const web = new WebStack(app, 'EasyApply-Web', { env });
const auth = new AuthStack(app, 'EasyApply-Auth', {
  env, terminationProtection: true, config, dashboardOrigins: [web.origin],
});
// Anonymous opt-in telemetry (F07): its own stack, deployed before the API.
const telemetry = new TelemetryStack(app, 'EasyApply-Telemetry', { env });
const api = new ApiStack(app, 'EasyApply-Api', {
  env,
  config,
  table: data.table,
  key: data.key,
  resumeBucket: data.resumes,
  userPool: auth.userPool,
  clients: [auth.extensionClient, auth.dashboardClient],
  dashboardOrigins: [web.origin],
  telemetryStream: telemetry.stream,
});
new WebContentStack(app, 'EasyApply-WebContent', {
  env,
  bucket: web.bucket,
  distribution: web.distribution,
  apiUrl: api.api.apiEndpoint,
  authDomain: auth.loginDomain,
  clientId: auth.dashboardClient.userPoolClientId,
});

Tags.of(app).add('project', 'easyapply');
