// Shared form filler (form-filler.js) and iCIMS job parsing.
// The fixture is SYNTHETIC: a plain HTML form shaped like an iCIMS contact and
// questions page (labels, native selects, yes/no radios, self-ID selects). It
// tests the filler's rules, not iCIMS's real markup; a captured iCIMS page
// replaces it once one is available (tools/capture-form-page.js).
// Usage: NODE_PATH=... node tools/tests/test-form-filler.js
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { JSDOM } = require('jsdom');

const ROOT = path.resolve(__dirname, '..', '..');
const FILLER = fs.readFileSync(path.join(ROOT, 'form-filler.js'), 'utf8');

function page(body) {
  const dom = new JSDOM(`<!doctype html><html><body>${body}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
  dom.window.eval(FILLER);
  return dom.window;
}

const PROFILE = {
  personalInfo: { firstName: 'Ada', lastName: 'Lovelace', email: 'ada@example.com', phone: '(555) 010-2030', linkedinUrl: 'https://linkedin.com/in/ada' },
  address: { street: '12 Analytical Way', city: 'Albany', state: 'New York', zip: '12207', country: 'United States of America' },
  jobPreferences: { authorizedToWork: true, requiresSponsorship: false, isAtLeast18: true, formerEmployee: false },
  demographics: { gender: 'Female', veteranStatus: 'I am not a veteran' },
  education: [{ school: 'University of London', field: 'Mathematics' }],
  workExperience: [{ company: 'Babbage & Co', title: 'Analyst' }]
};

const CONTACT = `
<form>
  <label for="PersonProfileFields.FirstName">First Name *</label><input id="PersonProfileFields.FirstName" required>
  <label for="PersonProfileFields.MiddleName">Middle Name</label><input id="PersonProfileFields.MiddleName">
  <label for="PersonProfileFields.LastName">Last Name *</label><input id="PersonProfileFields.LastName" required>
  <label for="PersonProfileFields.Email">Email *</label><input id="PersonProfileFields.Email" type="email" value="kept@example.com">
  <label for="phone">Phone Number</label><input id="phone" type="tel">
  <label for="ptype">Phone Type</label><select id="ptype"><option value="">Select</option><option>Mobile</option><option>Home</option></select>
  <label for="a1">Address Line 1</label><input id="a1">
  <label for="a2">Address Line 2</label><input id="a2">
  <label for="city">City</label><input id="city">
  <label for="st">State/Province</label><select id="st"><option value="">-- Select --</option><option value="AL">AL</option><option value="NY">NY</option></select>
  <label for="zip">Zip Code</label><input id="zip">
  <label for="ctry">Country</label><select id="ctry"><option value="">Select</option><option value="CA">Canada</option><option value="US">United States</option></select>
  <label for="li">LinkedIn Profile URL</label><input id="li" type="url">
  <input type="hidden" id="secret" name="firstName">
  <div style="display:none"><label for="ghost">First name</label><input id="ghost"></div>
  <fieldset><legend>Are you legally authorized to work in the United States? *</legend>
    <input type="radio" name="rcf_auth" id="auth_y" value="1" required><label for="auth_y">Yes</label>
    <input type="radio" name="rcf_auth" id="auth_n" value="0"><label for="auth_n">No</label>
  </fieldset>
  <label for="spon">Will you now or in the future require sponsorship for employment visa status?</label>
  <select id="spon"><option value="">Please Select</option><option value="Y">Yes</option><option value="N">No</option></select>
  <label for="hear">How did you hear about this position?</label>
  <select id="hear"><option value="">Select</option><option>Indeed</option><option>Other</option></select>
  <label for="salary">Desired salary *</label><input id="salary" required>
  <label for="gender">Gender</label><select id="gender"><option value="">Select</option><option>Male</option><option>Female</option><option>I decline to self-identify</option></select>
  <label for="race">Race/Ethnicity</label><select id="race"><option value="">Select</option><option>White</option><option>Asian</option><option>I do not wish to answer</option></select>
  <label for="vet">Veteran Status</label><select id="vet"><option value="">Select</option><option>I am not a protected veteran</option><option>I identify as one or more of the classifications of protected veteran</option></select>
  <label for="pwd-none">Comments</label><textarea id="pwd-none"></textarea>
  <button type="submit">Submit</button>
</form>`;

const tests = [];
const test = (name, fn) => tests.push([name, fn]);

test('fills contact fields by label, never overwriting what is there', () => {
  const w = page(CONTACT);
  const r = w.EasyApplyFormFiller.fill(w.document, PROFILE, { site: 'icims' });
  const $ = (id) => w.document.getElementById(id);
  assert.equal($('PersonProfileFields.FirstName').value, 'Ada');
  assert.equal($('PersonProfileFields.MiddleName').value, '', 'middle name is not the first name');
  assert.equal($('PersonProfileFields.LastName').value, 'Lovelace');
  assert.equal($('PersonProfileFields.Email').value, 'kept@example.com', 'an existing value is kept');
  assert.equal($('phone').value, '(555) 010-2030');
  assert.equal($('ptype').value, '', 'phone type is not a phone number');
  assert.equal($('a1').value, '12 Analytical Way');
  assert.equal($('a2').value, '', 'line 2 stays empty');
  assert.equal($('city').value, 'Albany');
  assert.equal($('st').value, 'NY', 'state by abbreviation');
  assert.equal($('zip').value, '12207');
  assert.equal($('ctry').value, 'US', 'United States of America matches United States');
  assert.equal($('li').value, 'https://linkedin.com/in/ada');
  assert.equal($('secret').value, '', 'hidden inputs are left alone');
  assert.equal($('ghost').value, '', 'invisible fields are left alone');
  assert.equal(r.site, 'icims');
  assert.ok(r.counts.filled >= 9, `filled ${r.counts.filled}`);
});

test('a page already filled from a previous application reports what it kept', () => {
  const w = page(`<form>
    <label for="f">First Name</label><input id="f" value="Ada">
    <label for="l">Last Name</label><input id="l" value="Lovelace">
    <label for="e">Email</label><input id="e" type="email" value="ada@example.com">
    <label for="s">State</label><select id="s"><option value="">Select</option><option value="NY" selected>NY</option></select>
    <fieldset><legend>Are you legally authorized to work in the United States?</legend>
      <input type="radio" name="auth" id="y" checked><label for="y">Yes</label><input type="radio" name="auth" id="n"><label for="n">No</label></fieldset>
  </form>`);
  const r = w.EasyApplyFormFiller.fill(w.document, PROFILE, { site: 'icims' });
  assert.equal(r.counts.filled, 0);
  assert.equal(r.counts.kept, 5, JSON.stringify(r.steps));
  assert.equal(w.document.getElementById('f').value, 'Ada');
});

test('answers yes/no questions from saved answers, radio or select', () => {
  const w = page(CONTACT);
  w.EasyApplyFormFiller.fill(w.document, PROFILE);
  assert.equal(w.document.getElementById('auth_y').checked, true, 'authorized: Yes');
  assert.equal(w.document.getElementById('spon').value, 'N', 'sponsorship: No');
});

test('never guesses: no saved source and no self-ID answer are left and reported', () => {
  const w = page(CONTACT);
  const r = w.EasyApplyFormFiller.fill(w.document, PROFILE);
  assert.equal(w.document.getElementById('hear').value, '', 'How did you hear is not guessed');
  assert.equal(w.document.getElementById('race').value, '', 'race has no saved answer');
  assert.ok(r.steps.some((s) => s.field === 'Race' && s.status === 'skipped'));
  assert.equal(w.document.getElementById('gender').value, 'Female');
  assert.equal(w.document.getElementById('vet').value, 'I am not a protected veteran');
});

test('Decline all disclosures answers unanswered self-ID with the decline option', () => {
  const w = page(CONTACT);
  w.EasyApplyFormFiller.fill(w.document, { ...PROFILE, jobPreferences: { ...PROFILE.jobPreferences, autoDisclosures: true } });
  assert.equal(w.document.getElementById('race').value, 'I do not wish to answer');
});

test('a saved answer with no matching option is reported as failed, not forced', () => {
  const w = page(CONTACT);
  const r = w.EasyApplyFormFiller.fill(w.document, { ...PROFILE, jobPreferences: { ...PROFILE.jobPreferences, sourceReferral: 'Glassdoor' } });
  assert.equal(w.document.getElementById('hear').value, '');
  assert.ok(r.steps.some((s) => s.field === 'How did you hear' && s.status === 'failed'));
});

test('required fields still empty are listed for the person', () => {
  const w = page(CONTACT);
  const r = w.EasyApplyFormFiller.fill(w.document, PROFILE);
  assert.deepEqual(JSON.parse(JSON.stringify(r.empty.map((e) => e.label))), ['Desired salary']);
  assert.equal(r.counts.emptyRequired, 1);
});

test('a sign-in page is recognised and its fields are never filled', () => {
  const w = page(`<form><label for="e">Email</label><input id="e" type="email"><label for="p">Password</label><input id="p" type="password"></form>`);
  assert.equal(w.EasyApplyFormFiller.isSignInPage(w.document), true);
  const plain = page(CONTACT);
  assert.equal(plain.EasyApplyFormFiller.isSignInPage(plain.document), false);
});

test('most recent school and job fill when the page asks for one of each', () => {
  const w = page(`<form>
    <label for="s">School Name</label><input id="s"><label for="m">Major</label><input id="m">
    <label for="c">Employer</label><input id="c"><label for="t">Job Title</label><input id="t"></form>`);
  w.EasyApplyFormFiller.fill(w.document, PROFILE);
  const v = (id) => w.document.getElementById(id).value;
  assert.deepEqual([v('s'), v('m'), v('c'), v('t')].map(String), ['University of London', 'Mathematics', 'Babbage & Co', 'Analyst']);
});

// The four required questions from a real iCIMS report (Shure, Embedded Software
// Intern). Their markup is not captured yet, so both shapes are tried.
const SCREENING = (gpaControl) => `<form>
  <label for="Q39">Do you have any previous internship experience? *</label>
  <select id="Q39" name="Q39" required><option value="">Select</option><option>Yes</option><option>No</option></select>
  <label for="Q37">Please provide the level of education you will have COMPLETED effective Spring 2027 *</label>
  <select id="Q37" name="Q37" required><option value="">Select</option><option>Freshman</option><option>Sophomore</option><option>Junior</option><option>Senior</option></select>
  <label for="Q38">Please provide your current cumulative GPA. *</label>
  ${gpaControl}
  <label for="Q40">Please rate your familiarity with Shure and our products *</label>
  <select id="Q40" name="Q40" required><option value="">Select</option><option>1</option><option>5</option></select>
</form>`;
const STUDENT = { ...PROFILE, education: [{ school: 'UIUC', gpa: '3.62', endYear: '2028' }],
  workExperience: [{ company: 'Acme Audio', title: 'Software Engineering Intern' }] };

test('screening questions: GPA from the saved profile, internship only when one is saved', () => {
  const w = page(SCREENING('<input id="Q38" name="Q38" required>'));
  const r = w.EasyApplyFormFiller.fill(w.document, STUDENT, { site: 'icims' });
  const v = (id) => w.document.getElementById(id).value;
  assert.equal(v('Q38'), '3.62', 'GPA typed as saved');
  assert.equal(v('Q39'), 'Yes', 'a saved internship answers Yes');
  assert.equal(v('Q37'), '', 'a future education level is left for the person');
  assert.equal(v('Q40'), '', 'company familiarity is left for the person');
  assert.deepEqual(JSON.parse(JSON.stringify(r.empty.map((e) => e.field))), ['Q37', 'Q40']);
});

test('no saved internship: the internship question is left, never answered No', () => {
  const w = page(SCREENING('<input id="Q38" name="Q38" required>'));
  w.EasyApplyFormFiller.fill(w.document, { ...STUDENT, workExperience: [{ company: 'Cafe', title: 'Barista' }] });
  assert.equal(w.document.getElementById('Q39').value, '');
});

test('GPA as a dropdown of ranges picks the range that holds it', () => {
  const w = page(SCREENING(`<select id="Q38" name="Q38" required><option value="">Select</option>
    <option value="a">Below 2.0</option><option value="b">2.0 - 2.99</option><option value="c">3.0 - 3.49</option>
    <option value="d">3.50 - 3.99</option><option value="e">4.0 or higher</option></select>`));
  w.EasyApplyFormFiller.fill(w.document, STUDENT);
  assert.equal(w.document.getElementById('Q38').value, 'd');
});

test('no saved GPA: the GPA question is left', () => {
  const w = page(SCREENING('<input id="Q38" name="Q38" required>'));
  w.EasyApplyFormFiller.fill(w.document, { ...STUDENT, education: [{ school: 'UIUC' }] });
  assert.equal(w.document.getElementById('Q38').value, '');
});

test('iCIMS job pages are recognised for the tracker', () => {
  const w = page('');
  w.chrome = { storage: { local: { get: async () => ({}), set: async () => {} } } };
  w.eval(fs.readFileSync(path.join(ROOT, 'cloud-tracker.js'), 'utf8'));
  const T = w.EasyApplyCloudTracker;
  const a = T.normalizeJob({ url: 'https://careers-acme.icims.com/jobs/1234/data-analyst/job?in_iframe=1' });
  assert.equal(a.key, 'icims:careers-acme.icims.com:1234');
  assert.equal(a.company, 'Acme');
  assert.equal(a.role, 'Data Analyst');
  assert.equal(a.site, 'other', 'the API has no icims site yet');
  assert.equal(a.url, 'https://careers-acme.icims.com/jobs/1234/data-analyst/job');
  const b = T.normalizeJob({ url: 'https://uscareers-globex.icims.com/jobs/88/login' });
  assert.equal(b.key, 'icims:uscareers-globex.icims.com:88');
  assert.equal(b.company, 'Globex');
  assert.equal(T.normalizeJob({ url: 'https://acme.icims.com/jobs/search?ss=1' }), null, 'search pages are not jobs');
  assert.equal(T.normalizeJob({ url: 'https://evil-icims.com.example/jobs/1/x/job' }), null, 'look-alike hosts are not iCIMS');
});

(async () => {
  let failed = 0;
  for (const [name, fn] of tests) {
    try { await fn(); console.log(`PASS  ${name}`); } catch (e) { failed++; console.log(`FAIL  ${name}\n      ${e.message.split('\n').join('\n      ')}`); }
  }
  console.log(failed ? `${failed} failed` : `all ${tests.length} passed`);
  process.exit(failed ? 1 : 0);
})();
