#!/usr/bin/env node
import * as fs from 'node:fs';
import { App, Tags } from 'aws-cdk-lib';
import { ADAPTER_DIST, AdapterContentStack } from '../lib/adapter-content-stack';
import { ApiStack } from '../lib/api-stack';
import { AuthStack } from '../lib/auth-stack';
import { loadConfig, REGION } from '../lib/config';
import { DataStack } from '../lib/data-stack';
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
const api = new ApiStack(app, 'EasyApply-Api', {
  env,
  config,
  table: data.table,
  key: data.key,
  resumeBucket: data.resumes,
  userPool: auth.userPool,
  clients: [auth.extensionClient, auth.dashboardClient],
  dashboardOrigins: [web.origin],
});
new WebContentStack(app, 'EasyApply-WebContent', {
  env,
  bucket: web.bucket,
  distribution: web.distribution,
  apiUrl: api.api.apiEndpoint,
  authDomain: auth.loginDomain,
  clientId: auth.dashboardClient.userPoolClientId,
});

// Adapter packs: depends only on EasyApply-Web. adapters/dist/ is produced and
// committed by tools/build-adapter-pack.mjs; until it exists there is nothing
// to upload, so the stack is left out rather than failing every synth.
if (fs.existsSync(ADAPTER_DIST)) {
  new AdapterContentStack(app, 'EasyApply-Adapters', {
    env, bucket: web.adapterBucket, distribution: web.distribution,
  });
} else {
  console.warn(`EasyApply-Adapters skipped: ${ADAPTER_DIST} does not exist (run node tools/build-adapter-pack.mjs).`);
}

Tags.of(app).add('project', 'easyapply');
