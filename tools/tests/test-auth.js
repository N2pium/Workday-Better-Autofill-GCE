// Application Questions modelled on tools/LegallyAuthorized.png and
// RequireSponsorship.png. Radios stand in for Workday's listbox buttons; the
// classification under test is the same either way.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

function q(id, text, choices) {
  return `
  <div data-automation-id="formField-${id}">
    <fieldset>
      <legend><div id="rich-${id}">${text}</div></legend>
      ${choices.map((c, i) => `<input type="radio" name="${id}" id="${id}-${i}"><label for="${id}-${i}">${c}</label>`).join('')}
    </fieldset>
  </div>`;
}

const YESNO = ['Yes', 'No'];

const PAGES = {
  'separate questions (BCBSLA wording)':
    q('auth', 'Are you legally authorized to work in the United States?', YESNO) +
    q('spon', 'Will you now or in the future require employer sponsorship for an immigration-related employment benefit?', YESNO),

  'compound: authorized WITHOUT sponsorship':
    q('both', 'Are you legally authorized to work in the United States without requiring sponsorship for an employment visa now or in the future?', YESNO),

  'compound plus a plain sponsorship question':
    q('both', 'Are you legally authorized to work in the United States without sponsorship?', YESNO) +
    q('spon', 'Will you now or in the future require sponsorship for employment VISA status?', YESNO),

  'No-choice must not pick "Not applicable"':
    q('spon', 'Will you require visa sponsorship?', ['Yes', 'Not applicable', 'No']),
};

function boot(src, body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, {
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage() {}, lastError: null } };
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', {
    configurable: true, get() { return this.hidden ? null : this.ownerDocument.body; }
  });
  if (!('innerText' in w.HTMLElement.prototype)) {
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
      configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; }
    });
  }
  if (!w.CSS) w.CSS = {};
  if (!w.CSS.escape) w.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\u005C' + c);
  w.Element.prototype.scrollIntoView = function () {};
  w.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 10, bottom: 30, left: 0, right: 100 });
  w.console.log = () => {}; w.console.warn = () => {};
  w.eval(fs.readFileSync(src, 'utf8') + String.raw`
;window.__setProfile = (p) => { userProfile = p; };`);
  return w;
}

const PREFS = { isAtLeast18: true, formerEmployee: false, authorizedToWork: true, requiresSponsorship: false, sourceReferral: '', autoDisclosures: false };

function answers(w) {
  const out = {};
  w.document.querySelectorAll('fieldset').forEach(fs_ => {
    const name = fs_.closest('[data-automation-id]').getAttribute('data-automation-id').replace('formField-', '');
    const picked = Array.from(fs_.querySelectorAll('input[type="radio"]')).find(r => r.checked);
    out[name] = picked ? w.document.querySelector(`label[for="${picked.id}"]`).textContent : '(unanswered)';
  });
  return out;
}

async function run(src, body) {
  const w = boot(src, body);
  w.__setProfile({ jobPreferences: PREFS });
  // The tail of handleJobPreferences probes dropdowns that do not exist here and
  // sits through several waitForCondition timeouts; the answers land long before
  // that, so cap the wait rather than sitting through it.
  w.eval('window.__done = handleJobPreferences().then(() => true, (e) => String(e));');
  const outcome = await Promise.race([w.__done, new Promise(r => setTimeout(() => r('TIMEOUT'), 4000))]);
  if (outcome !== true) console.log('    [handleJobPreferences ->', outcome, ']');
  return answers(w);
}

// keep node alive while jsdom timers run
const keepAlive = setInterval(() => {}, 1000);

(async () => {
  const OLD = path.resolve(__dirname, 'old-content.js');
  const NEW = path.resolve(__dirname, '..', '..', 'content.js');
  console.log('profile: authorized=true, requiresSponsorship=false\n');
  for (const [name, body] of Object.entries(PAGES)) {
    console.log(name);
    console.log('  old:', JSON.stringify(await run(OLD, body)));
    console.log('  new:', JSON.stringify(await run(NEW, body)));
    console.log('');
  }

  // Authorized but still needs sponsorship: the compound question is honestly No.
  console.log('profile: authorized=true, requiresSponsorship=TRUE');
  PREFS.requiresSponsorship = true;
  const body = PAGES['compound: authorized WITHOUT sponsorship'];
  console.log('  old:', JSON.stringify(await run(OLD, body)));
  console.log('  new:', JSON.stringify(await run(NEW, body)));
  clearInterval(keepAlive);
})();
