// Public configuration for the optional cloud account (see PRIVACY_POLICY.md).
//
// None of these are secrets: they name the API and the Cognito app client, which
// every copy of the extension necessarily ships. Every request still needs the
// signed-in user's own token. Values come from cloud/cdk-outputs.json after
// `npx cdk deploy` (EasyApply-Api.ApiUrl, EasyApply-Auth.LoginDomain,
// EasyApply-Auth.ExtensionClientId).
self.EASYAPPLY_CLOUD_CONFIG = Object.freeze({
    apiUrl: 'https://cfswo4fym6.execute-api.us-east-2.amazonaws.com',
    authDomain: 'https://better-autofill.auth.us-east-2.amazoncognito.com',
    clientId: '43qdd554clva7dugdetl1evlea',
    // Resume Vault bucket (EasyApply-Api.ResumeBucketHost). Asked for only when the vault is used.
    resumeBucketHost: 'easyapply-data-resumesb6263180-1qd2ewprnfb4.s3.us-east-2.amazonaws.com',
    scopes: ['openid', 'email', 'profile'],
    // Signed Workday adapter pack (data only; see adapters/ and background.js).
    // Fetched without a host permission: CloudFront sends Access-Control-Allow-Origin: *.
    adapterPackUrl: 'https://d3sun3zkns70tc.cloudfront.net/adapters/workday.json',
    // The web dashboard (EasyApply-Web): application flow chart and insights.
    // Opened as an ordinary link from the Applications tab; nothing is sent with it.
    dashboardUrl: 'https://d3sun3zkns70tc.cloudfront.net/'
});
