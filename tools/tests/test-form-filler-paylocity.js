// Paylocity application page, filled by form-filler.js.
// The fixture copies the STRUCTURE read from a live Paylocity application
// (2000recruiting.paylocity.com, 2026-11-27): element ids, data-for labels,
// .form-group.form-required, a react-widgets combobox (div[role=combobox] owning
// a ul[role=listbox] of li[role=option]) and Paylocity's searchable select
// (pcty-input-select; menu rows div[role=listitem]#<input id>-select-row-N).
// The two widgets are given the behaviour observed live: open on mousedown,
// choose on click, show the choice in the control. No real values are in it.
// Usage: NODE_PATH=... node tools/tests/test-form-filler-paylocity.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');

const group = (id, label, input, required = true) =>
  `<div class="form-group${required ? ' form-required' : ''}"><label>${label}${required ? ' (required)' : ''}</label>${input}</div>`;
const text = (id, dataFor, required = true, extra = '') =>
  group(id, dataFor, `<input data-automation-id="x" data-for="${dataFor}" id="${id}" placeholder="" type="text" value="" ${extra}>`, required);
const combo = (id, question) => `<div class="form-group form-required"><label>${question} (required)</label>
  <div><div data-for="${question}" id="${id}" role="combobox" aria-owns="${id}__listbox" aria-expanded="false" aria-haspopup="true">--</div>
  <ul id="${id}__listbox" class="rw-list" role="listbox" hidden><li role="option">--</li><li role="option">Yes</li><li role="option">No</li></ul></div></div>`;
const select = (id, label, shown, rows) => `<label class="css-asocq5">${label}<div class="pcty-input-select-full-container">
  <div class="pcty-input-select-input-container"><div class="css-n6sh4p"><div class="pcty-input-select__single-value">${shown}</div>
  <div class="pcty-input-select__input"><input aria-autocomplete="list" id="${id}" required type="text" value=""></div></div></div>
  <div class="pcty-input-select__menu-list" hidden><div>${rows.map((r, i) => `<div class="ListItemEven" role="listitem" id="${id}-select-row-${i}">${r}</div>`).join('')}</div></div>
  </div></label>`;

const PAGE = `<form>
  <input type="checkbox" id="useAttachedResumeToFillOutApplication"><label for="useAttachedResumeToFillOutApplication">Fill out application with my resume</label>
  ${text('info.firstName', 'First Name')}${text('info.lastName', 'Last Name')}${text('info.middleName', 'Middle Name', false)}
  ${text('info.preferredName', 'Preferred First Name', false)}${text('info.email', 'Email Address')}${text('info.cellPhone', 'Mobile Number')}
  ${combo('info.smsOptedIn', 'We may use SMS during the hiring process. Do you give us permission to text you?')}
  ${select('public-site-address-country', 'Country', 'United States', ['Canada', 'United States'])}
  <label>Address Line 1<input id="public-site-address-address-1" role="combobox" autocomplete="off" required type="text" value=""></label>
  <label>Address Line 2(optional)<input id="public-site-address-address-2" autocomplete="off" type="text" value=""></label>
  <label>City<input id="public-site-address-city" autocomplete="off" required type="text" value=""></label>
  <label>County<input id="public-site-address-county" autocomplete="off" required type="text" value=""></label>
  ${select('public-site-address-us-state', 'State', 'Select a state', ['AL', 'AK', 'NY'])}
  <label>Zip Code<input id="public-site-address-zip" autocomplete="off" required type="text" value=""></label>
  ${text('info.dateAvailableToStart', 'Date Available to Start', false, 'placeholder="MM/DD/YYYY"')}
  ${text('info.linkedIn', 'LinkedIn Profile', false)}${text('info.desiredSalaryDescription', 'Desired Salary', false)}
  <div class="form-group"><label>How did you hear about us?</label>
    ${['Glassdoor', 'Indeed', 'LinkedIn', 'Other'].map((v) => `<label><input name="info.howDidYouHearAboutUs" type="radio" value="${v}"><div>${v}</div></label>`).join('')}</div>
  ${combo('info.haveYouWorkedWithUsBefore', 'Have you worked with us before?')}
  ${text('workHistory.companyName.0', 'Company Name', false)}${text('workHistory.position.0', 'Position', false)}
  <div class="form-group"><label>Responsibilities</label><textarea id="workHistory.responsibilities.0" data-for="Responsibilities"></textarea></div>
  ${text('txt-workHistory-startDate-0', 'Start Date', false, 'placeholder="MM/YYYY"')}${text('txt-workHistory-endDate-0', 'End Date', false, 'placeholder="MM/YYYY"')}
  <input type="checkbox" id="workHistory.currentlyWorkingHere.0"><label for="workHistory.currentlyWorkingHere.0">Currently Working Here</label>
  <button type="button">Next Step</button>
</form>`;

// The live widgets' behaviour, as observed: mousedown opens, click on an option chooses.
const BEHAVIOUR = `
  document.querySelectorAll('[role="combobox"][aria-owns]').forEach((cb) => {
    const lb = document.getElementById(cb.getAttribute('aria-owns'));
    cb.addEventListener('mousedown', () => { lb.hidden = false; cb.setAttribute('aria-expanded', 'true'); });
    lb.querySelectorAll('[role="option"]').forEach((li) => li.addEventListener('click', () => {
      cb.textContent = li.textContent; lb.hidden = true; cb.setAttribute('aria-expanded', 'false');
    }));
  });
  document.querySelectorAll('.pcty-input-select-full-container').forEach((box) => {
    const menu = box.querySelector('.pcty-input-select__menu-list');
    const shown = box.querySelector('.pcty-input-select__single-value');
    box.querySelector('.pcty-input-select-input-container').addEventListener('mousedown', () => { menu.hidden = false; });
    menu.querySelectorAll('[role="listitem"]').forEach((row) => row.addEventListener('click', () => {
      shown.textContent = row.textContent; menu.hidden = true;
    }));
  });`;

function page() {
  const dom = new JSDOM(`<!doctype html><html><head><title>Paylocity - Enterprise HCM Account Executive Application</title></head><body>${PAGE}</body></html>`,
    { runScripts: 'outside-only', pretendToBeVisual: true, url: 'https://2000recruiting.paylocity.com/recruiting/jobs/Apply/49568/Paylocity/Enterprise-HCM-Account-Executive' });
  dom.window.eval(fs.readFileSync(path.join(ROOT, 'form-filler.js'), 'utf8'));
  dom.window.eval(BEHAVIOUR);
  return dom.window;
}

const PROFILE = {
  personalInfo: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '(555) 010-2030', linkedinUrl: 'https://linkedin.com/in/ada' },
  address: { street: '12 Analytical Way', city: 'Albany', state: 'New York', zip: '12207', country: 'United States of America' },
  jobPreferences: { authorizedToWork: true, formerEmployee: false, sourceReferral: 'LinkedIn' },
  workExperience: [{ company: 'Babbage & Co', title: 'Analyst', description: 'Built engines.',
    startDate: { month: '3', year: '2024' }, endDate: { month: '', year: '' }, isCurrentRole: true }]
};

const tests = [];
const test = (name, fn) => tests.push([name, fn]);
const shows = (w, id) => w.document.getElementById(id).closest('.pcty-input-select-full-container').querySelector('.pcty-input-select__single-value').textContent;

test('contact, address and links fill by data-for and label', async () => {
  const w = page();
  await w.EasyApplyFormFiller.fill(w.document, PROFILE, { site: 'paylocity' });
  const v = (id) => w.document.getElementById(id).value;
  assert.equal(v('info.firstName'), 'Ada');
  assert.equal(v('info.lastName'), 'Lovelace');
  assert.equal(v('info.middleName'), '');
  assert.equal(v('info.preferredName'), '', 'preferred first name is not the first name');
  assert.equal(v('info.email'), 'ada@example.com');
  assert.equal(v('info.cellPhone'), '(555) 010-2030');
  assert.equal(v('public-site-address-address-1'), '12 Analytical Way', 'address autocomplete is typed, not treated as a select');
  assert.equal(v('public-site-address-address-2'), '');
  assert.equal(v('public-site-address-city'), 'Albany');
  assert.equal(v('public-site-address-zip'), '12207');
  assert.equal(v('info.linkedIn'), 'https://linkedin.com/in/ada');
});

test('searchable selects: state picked from the menu, country already set is kept', async () => {
  const w = page();
  const r = await w.EasyApplyFormFiller.fill(w.document, PROFILE, { site: 'paylocity' });
  assert.equal(shows(w, 'public-site-address-us-state'), 'NY');
  assert.equal(shows(w, 'public-site-address-country'), 'United States');
  assert.ok(r.steps.some((s) => s.field === 'Country' && s.status === 'kept'));
  assert.ok(r.steps.some((s) => s.field === 'State' && s.status === 'filled'));
});

test('react-widgets combobox: "Have you worked with us before?" answered from the profile', async () => {
  const w = page();
  await w.EasyApplyFormFiller.fill(w.document, PROFILE);
  assert.equal(w.document.getElementById('info.haveYouWorkedWithUsBefore').textContent, 'No');
  assert.equal(w.document.getElementById('info.smsOptedIn').textContent, '--', 'text-message consent is the person\'s');
});

test('how did you hear (radios) and the most recent job with dates', async () => {
  const w = page();
  await w.EasyApplyFormFiller.fill(w.document, PROFILE);
  const $ = (id) => w.document.getElementById(id);
  assert.equal(w.document.querySelector('input[value="LinkedIn"]').checked, true);
  assert.equal($('workHistory.companyName.0').value, 'Babbage & Co');
  assert.equal($('workHistory.position.0').value, 'Analyst');
  assert.equal($('workHistory.responsibilities.0').value, 'Built engines.');
  assert.equal($('txt-workHistory-startDate-0').value, '03/2024');
  assert.equal($('workHistory.currentlyWorkingHere.0').checked, true);
  assert.equal($('txt-workHistory-endDate-0').value, '', 'a current role has no end date');
  assert.equal($('info.dateAvailableToStart').value, '', 'availability is not the job start date');
  assert.equal($('useAttachedResumeToFillOutApplication').checked, false, 'Paylocity\'s own resume parsing is left to the person');
});

test('required fields left are listed: SMS consent and county', async () => {
  const w = page();
  const r = await w.EasyApplyFormFiller.fill(w.document, PROFILE);
  const labels = JSON.parse(JSON.stringify(r.empty.map((e) => e.label)));
  assert.ok(labels.some((l) => /permission to text/.test(l)), labels.join(' | '));
  assert.ok(labels.some((l) => /County/.test(l)), labels.join(' | '));
  assert.ok(!labels.some((l) => /State|First Name|worked with us/.test(l)), labels.join(' | '));
});

test('Paylocity job pages are recognised for the tracker', async () => {
  const w = page();
  w.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  w.eval(fs.readFileSync(path.join(ROOT, 'cloud-tracker.js'), 'utf8'));
  const T = w.EasyApplyCloudTracker;
  const a = T.normalizeJob({ url: w.location.href, pageTitle: w.document.title });
  assert.equal(a.key, 'paylocity:2000recruiting.paylocity.com:49568');
  assert.equal(a.company, 'Paylocity');
  assert.equal(a.role, 'Enterprise HCM Account Executive');
  assert.equal(a.url, 'https://2000recruiting.paylocity.com/Recruiting/Jobs/Details/49568');
  const b = T.normalizeJob({ url: 'https://recruiting.paylocity.com/Recruiting/Jobs/Details/123' });
  assert.equal(b.key, 'paylocity:recruiting.paylocity.com:123');
  assert.equal(T.normalizeJob({ url: 'https://access.paylocity.com/Payroll/Home' }), null, 'payroll pages are not jobs');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
  }
  console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
