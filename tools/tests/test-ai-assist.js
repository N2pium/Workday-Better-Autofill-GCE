// Answer Library matching (cloud-library.js) and the on-page Draft button (ai-assist.js).
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

// ---------------------------------------------------------------- library (pure)
const sandbox = {};
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(path.join(ROOT, 'cloud-library.js'), 'utf8'), sandbox);
const Lib = sandbox.EasyApplyLibrary;

check('why-company by rule', Lib.categoriseByRules('Why do you want to work at Duke Energy?'), 'why-company');
check('why-company by company name', Lib.categoriseByRules('Why Acme?', 'Acme'), 'why-company');
check('why-role', Lib.categoriseByRules('Why are you interested in this role?'), 'why-role');
check('challenge', Lib.categoriseByRules('Describe a challenge you overcame.'), 'challenge');
check('leadership', Lib.categoriseByRules('Tell us about a time you led a team.'), 'leadership');
check('conflict before teamwork', Lib.categoriseByRules('Describe a disagreement with a teammate.'), 'conflict');
check('weakness', Lib.categoriseByRules('What is your greatest weakness?'), 'weakness');
check('career goals', Lib.categoriseByRules('Where do you see yourself in five years?'), 'career-goals');
check('unknown -> null (ask the categoriser)', Lib.categoriseByRules('Anything else we should know?'), null);

const answers = [
  { id: 'a', category: 'why-company', text: 'x'.repeat(2000), charCount: 2000, uses: 9 },
  { id: 'b', category: 'why-company', text: 'Short one', charCount: 9, uses: 1 },
  { id: 'c', category: 'why-company', text: 'Also short', charCount: 10, uses: 4 },
  { id: 'd', category: 'challenge', text: 'Other', charCount: 5, uses: 50 }
];
check('rank: in category, fits limit first, then most used',
  Lib.rankAnswers(answers, { category: 'why-company', maxChars: 500 }).map((a) => a.id), ['c', 'b', 'a']);
check('placeholders filled locally', Lib.fillPlaceholders('I love {company} and the {role} role.', { company: 'Acme', role: 'Analyst' }),
  'I love Acme and the Analyst role.');
check('placeholder kept when unknown', Lib.fillPlaceholders('At {company}.', {}), 'At {company}.');
check('toTemplate swaps names back', Lib.toTemplate('Acme is great; the Data Analyst role fits.', { company: 'Acme', role: 'Data Analyst' }),
  '{company} is great; the {role} role fits.');
check('questionKey is stable and ignores punctuation/case',
  Lib.questionKey('Why us?') === Lib.questionKey('  why US '), true);

// ---------------------------------------------------------------- ai-assist (DOM)
function boot(body, { signedIn = true, answersList = [] } = {}) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://acme.wd5.myworkdayjobs.com/en-US/careers/job/Remote/Data-Analyst_R123/apply/applyManually' });
  const w = dom.window;
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', { configurable: true, get() { return this.hidden ? null : this.ownerDocument.body; } });
  if (!w.CSS) w.CSS = {};
  if (!w.CSS.escape) w.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => String.fromCharCode(92) + c);
  const store = {};
  const relayed = [];
  w.chrome = {
    runtime: {
      lastError: null,
      onMessage: { addListener() {} },
      sendMessage(msg, cb) {
        relayed.push(msg.op);
        const data = { status: { signedIn }, listAnswers: { items: answersList }, categorise: { category: 'custom' } }[msg.op];
        setTimeout(() => cb({ ok: true, data }), 0);
      }
    },
    storage: {
      local: {
        async get(k) { const keys = [].concat(k); return Object.fromEntries(keys.filter((x) => x in store).map((x) => [x, store[x]])); },
        async set(o) { Object.assign(store, o); }
      },
      onChanged: { addListener() {} }
    }
  };
  w.console.log = () => {};
  w.eval(fs.readFileSync(path.join(ROOT, 'cloud-library.js'), 'utf8'));
  w.eval(fs.readFileSync(path.join(ROOT, 'ai-assist.js'), 'utf8'));
  return { w, relayed, store };
}
const wait = (ms) => new Promise((r) => setTimeout(r, ms));

const FORM = `
  <div data-automation-id="formField-q1"><label for="q1">Why do you want to work at Acme? *</label><textarea id="q1" maxlength="800"></textarea></div>
  <div data-automation-id="formField-q2"><label for="q2">Anything else you'd like us to know?</label><textarea id="q2"></textarea></div>
  <div role="group"><h4>Work Experience 1</h4>
    <div data-automation-id="formField-d"><label for="d">Role Description</label><textarea id="d"></textarea></div></div>
  <div data-automation-id="formField-s"><label for="s">Summary</label><textarea id="s"></textarea></div>
  <div data-automation-id="formField-n"><label for="n">Notes</label><input id="n"></div>`;

(async () => {
  let { w } = boot(FORM);
  await wait(600);
  const marked = Array.from(w.document.querySelectorAll('textarea[data-easyapply-ai]')).map((t) => t.id);
  check('Draft button on real questions only (not work-panel description, not Summary)', marked, ['q1', 'q2']);
  check('one button per question', w.document.querySelectorAll('[data-easyapply-ai-host]').length, 2);
  const T = w.__easyApplyAiAssistTest;
  check('question text from its label, without the required star', T.questionFor(w.document.getElementById('q1')), 'Why do you want to work at Acme?');
  check('limit from maxlength', T.maxCharsFor(w.document.getElementById('q1')), 800);
  check('default limit without maxlength', T.maxCharsFor(w.document.getElementById('q2')), 1500);
  check('job key drops the /apply part', T.jobKey(), 'https://acme.wd5.myworkdayjobs.com/en-us/careers/job/remote/data-analyst_r123');

  ({ w } = boot(FORM, { signedIn: false }));
  await wait(600);
  check('signed out: no buttons at all', w.document.querySelectorAll('[data-easyapply-ai-host]').length, 0);

  // Job description remembered from the posting page for the apply pages.
  const posting = boot(`<h2 data-automation-id="jobPostingHeader">Data Analyst</h2>
    <div data-automation-id="jobPostingDescription">${'We need SQL. '.repeat(30)}</div>
    <div data-automation-id="formField-q1"><label for="q1">Why do you want this job?</label><textarea id="q1"></textarea></div>`);
  await wait(600);
  const cache = posting.store.aiJobCache || {};
  const entry = Object.values(cache)[0] || {};
  check('posting page: job description cached', [entry.role, entry.description && entry.description.startsWith('We need SQL.')], ['Data Analyst', true]);

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
