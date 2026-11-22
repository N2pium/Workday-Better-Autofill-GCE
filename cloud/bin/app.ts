#!/usr/bin/env node
import { App, Tags } from 'aws-cdk-lib';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { loadConfig, REGION } from '../lib/config';
import { DataStack } from '../lib/data-stack';

const app = new App();
const config = loadConfig(app);
// Region is fixed: this AWS project may only create Regional resources in us-east-2.
const env = { account: process.env.CDK_DEFAULT_ACCOUNT, region: REGION };

const data = new DataStack(app, 'EasyApply-Data', { env, terminationProtection: true });
const auth = new AuthStack(app, 'EasyApply-Auth', { env, terminationProtection: true, config });
new ApiStack(app, 'EasyApply-Api', {
  env,
  config,
  table: data.table,
  key: data.key,
  userPool: auth.userPool,
  clients: [auth.extensionClient, auth.dashboardClient],
});

Tags.of(app).add('project', 'easyapply');
