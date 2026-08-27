// F16 — "I currently work here" ticked on the form when the profile says it is
// not. Three independent ways the old code could do it, plus the case where
// nothing ticked it but nothing cleared it either.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function boot(src, body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage() {}, lastError: null } };
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', {
    configurable: true, get() { return this.hidden ? null : this.ownerDocument.body; }
  });
  Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
    configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; }
  });
  if (!w.CSS) w.CSS = {};
  w.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\u005C' + c);
  w.Element.prototype.scrollIntoView = function () {};
  w.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 10, bottom: 30, left: 0, right: 100 });
  w.console.log = () => {}; w.console.warn = () => {};
  w.eval(fs.readFileSync(src, 'utf8') + String.raw`
;window.__setProfile = (p) => { userProfile = p; };`);
  return w;
}

const OLD = path.resolve(__dirname, 'old-content.js');
const NEW = path.resolve(__dirname, '..', '..', 'content.js');

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}
function show(tag, actual, expected) {
  console.log(`    ${tag.padEnd(10)} ${JSON.stringify(actual)}${actual === expected ? '' : '   <-- wrong'}`);
}

// ---------------------------------------------------------------- scenario 1
// A terms label sharing a parent with an earlier, unrelated checkbox. The old
// XPath picks the checkbox that merely PRECEDES the matching label.
const SHARED_PARENT = `
  <div class="row">
    <input type="checkbox" id="cur"><label for="cur">I currently work here</label>
    <input type="checkbox" id="terms"><label for="terms">I have read and agree to the Terms and Conditions</label>
  </div>`;

// ---------------------------------------------------------------- scenario 2
// No terms text anywhere near, but a label containing "read" as a SUBSTRING.
// "already" contains "read".
const SUBSTRING_READ = `
  <div class="row">
    <input type="checkbox" id="cur"><label for="cur">I currently work here</label>
    <label for="dup">I have already applied to this role</label><input type="checkbox" id="dup">
  </div>`;

// ---------------------------------------------------------------- scenario 3
// Consent wording containing "represent" / "presented" — 'present' was a key on
// the work-experience checkbox match.
const PRESENT_SUBSTRING = `
  <div data-automation-id="formField-currentlyWorkHere">
    <input type="checkbox" id="cur"><label for="cur">I currently work here</label>
  </div>
  <div data-automation-id="formField-certify">
    <input type="checkbox" id="cert"><label for="cert">I represent that the information presented is accurate</label>
  </div>`;

function runTerms(src, body) {
  const w = boot(src, body);
  w.eval('handleTerms()');
  return {
    cur: w.document.getElementById('cur').checked,
    other: !!(w.document.getElementById('terms') || w.document.getElementById('dup') || {}).checked
  };
}

// ---------------------------------------------------------------- scenario 4
// Nothing ticked it — Workday's own default did, or a previous run. The profile
// says false. The old code has no way to clear it.
const WORK_PAGE = `
  <a href="#">Back to Job Posting</a>
  <div data-automation-id="formField-companyName"><label for="co"><span>Company</span></label><input id="co" type="text"></div>
  <div data-automation-id="formField-currentlyWorkHere"><input type="checkbox" id="cur" checked><label for="cur">I currently work here</label></div>
  <div data-automation-id="formField-startDate"><label for="sd"><span>From</span></label>
    <div><input id="sd" type="text" placeholder="MM/YYYY"></div></div>
  <div data-automation-id="formField-endDate"><label for="ed"><span>To</span></label>
    <div><input id="ed" type="text" placeholder="MM/YYYY"></div></div>`;

const PROFILE = (isCurrentRole) => ({
  workExperience: [{
    company: 'Powers Health', title: 'Prep Cook', location: '', description: '',
    startDate: { month: '03', year: '2021' }, endDate: { month: '06', year: '2023' },
    isCurrentRole
  }],
  jobPreferences: {}
});

async function runScan(src, isCurrentRole, preChecked) {
  const body = preChecked ? WORK_PAGE : WORK_PAGE.replace('id="cur" checked', 'id="cur"');
  const w = boot(src, body);
  w.__setProfile(PROFILE(isCurrentRole));
  w.eval('window.__done = scanAndFill().then(() => true, (e) => String(e && e.stack || e));');
  const r = await Promise.race([w.__done, new Promise(res => setTimeout(() => res('TIMEOUT'), 15000))]);
  if (r !== true) console.log('    [scanAndFill ->', r, ']');
  return {
    cur: w.document.getElementById('cur').checked,
    from: w.document.getElementById('sd').value,
    to: w.document.getElementById('ed').value
  };
}

const keepAlive = setInterval(() => {}, 500);

(async () => {
  console.log('handleTerms must never tick "I currently work here"\n');

  for (const [name, body] of [
    ['terms label shares a parent with the work checkbox', SHARED_PARENT],
    ['"already" contains the substring "read"', SUBSTRING_READ],
  ]) {
    console.log(`  ${name}`);
    show('old', runTerms(OLD, body).cur, false);
    const got = runTerms(NEW, body).cur;
    show('new', got, false);
    check(`  -> work checkbox left alone: ${name}`, got, false);
  }

  // The genuine terms box should still get ticked.
  check('  -> real terms checkbox still ticked', runTerms(NEW, SHARED_PARENT).other, true);

  console.log('\nwork-experience keys must not match consent wording');
  {
    const w = boot(NEW, PRESENT_SUBSTRING);
    w.eval(`setCheckbox(['i currently work here', 'current job'], true)`);
    check('  -> "I represent ... presented" not ticked', w.document.getElementById('cert').checked, false);
    check('  -> the real work checkbox ticked', w.document.getElementById('cur').checked, true);
  }
  {
    // the old key list, for the record
    const w = boot(OLD, PRESENT_SUBSTRING);
    w.eval(`checkCheckbox(['i currently work here', 'current job', 'present'])`);
    console.log(`    old code ticked "I represent ... presented": ${w.document.getElementById('cert').checked}`);
  }

  console.log('\nform must be made to MATCH the profile, not just ticked');
  {
    console.log('  profile isCurrentRole=false, box arrives already ticked');
    const o = await runScan(OLD, false, true);
    console.log(`    old   checked=${o.cur}  From=${JSON.stringify(o.from)} To=${JSON.stringify(o.to)}`);
    const n = await runScan(NEW, false, true);
    console.log(`    new   checked=${n.cur}  From=${JSON.stringify(n.from)} To=${JSON.stringify(n.to)}`);
    check('  -> cleared to match the profile', n.cur, false);
    check('  -> and the end date then lands', n.to, '06/2023');
  }
  {
    console.log('  profile isCurrentRole=true, box arrives unticked');
    const n = await runScan(NEW, true, false);
    console.log(`    new   checked=${n.cur}  From=${JSON.stringify(n.from)} To=${JSON.stringify(n.to)}`);
    check('  -> ticked', n.cur, true);
    check('  -> no end date written', n.to, '');
  }

  clearInterval(keepAlive);
  console.log(failures ? `\n${failures} FAILING` : '\nall checkbox checks passed');
  process.exit(failures ? 1 : 0);
})();
