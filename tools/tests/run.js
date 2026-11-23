#!/usr/bin/env node
/**
 * Runs every suite in this directory.
 *
 *   node tools/tests/run.js            compare against HEAD's content.js
 *   node tools/tests/run.js <git-ref>  compare against that ref instead
 *
 * Needs jsdom. There is no package.json here on purpose (see SHARED_TASK_NOTES),
 * so install it globally and point NODE_PATH at the global root:
 *
 *   npm i -g jsdom
 *   NODE_PATH="$(npm root -g)" node tools/tests/run.js
 *
 * The before/after suites (test-real, test-auth) need the PREVIOUS content.js to
 * compare against; this writes it to tools/tests/old-content.js from git.
 */
const { execFileSync, spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ref = process.argv[2] || 'HEAD';
const here = __dirname;
const repo = path.resolve(here, '..', '..');

try {
    const old = execFileSync('git', ['show', `${ref}:content.js`], { cwd: repo, maxBuffer: 32 * 1024 * 1024 });
    fs.writeFileSync(path.join(here, 'old-content.js'), old);
    console.log(`baseline: ${ref}:content.js\n`);
} catch (e) {
    console.error(`could not read ${ref}:content.js — the before/after suites will fail.\n`);
}

// Suites that assert; a non-zero exit fails the run.
const ASSERTING = ['test-dates.js', 'test-websites.js', 'test-scan.js', 'test-checkbox.js', 'test-work-experience.js',
    'test-cloud-auth.js', 'test-cloud-sync.js', 'test-cloud-tracker.js', 'test-popup-ui.js', 'test-ai-assist.js', 'test-cloud-vault.js', 'test-my-experience.js'];
// Suites that print an old-vs-new comparison for a human to read.
const COMPARING = ['test-real.js', 'test-auth.js'];

let failed = 0;
for (const file of [...ASSERTING, ...COMPARING]) {
    console.log(`=== ${file} ===`);
    const r = spawnSync(process.execPath, [path.join(here, file)], { stdio: 'inherit' });
    if (ASSERTING.includes(file) && r.status !== 0) failed++;
    console.log('');
}

console.log(failed ? `${failed} suite(s) FAILED` : 'all asserting suites passed');
process.exit(failed ? 1 : 0);
