// End-to-end smoke test: the real scanAndFill against a page carrying every
// section it touches, checking nothing bleeds between fields.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { adapterPrelude } = require('./harness');

const NEW = path.resolve(__dirname, '..', '..', 'content.js');

const BODY = `
  <a data-automation-id="backToJobPosting" href="#">Back to Job Posting</a>
  <div data-automation-id="formField-firstName"><label for="fn">First Name</label><input id="fn" type="text"></div>
  <div data-automation-id="formField-lastName"><label for="ln">Last Name</label><input id="ln" type="text"></div>
  <div data-automation-id="formField-email"><label for="em">Email</label><input id="em" type="text"></div>
  <div data-automation-id="formField-linkedin"><label for="li">LinkedIn Profile</label><input id="li" type="text"></div>
  <div data-automation-id="formField-website"><label for="ws">Personal Website</label><input id="ws" type="text"></div>
  <div data-automation-id="formField-addressLine1"><label for="a1">Address Line 1</label><input id="a1" type="text"></div>
  <div data-automation-id="formField-city"><label for="ci">City</label><input id="ci" type="text"></div>
  <div data-automation-id="formField-postalCode"><label for="zp">Postal Code</label><input id="zp" type="text"></div>

  <h3>Work Experience</h3>
  <div data-automation-id="formField-jobTitle"><label for="jt"><span>Job Title</span><abbr>*</abbr></label><input id="jt" type="text"></div>
  <div data-automation-id="formField-companyName"><label for="co"><span>Company</span><abbr>*</abbr></label><input id="co" type="text"></div>
  <div data-automation-id="formField-location"><label for="lo"><span>Location</span></label><input id="lo" type="text"></div>
  <div data-automation-id="formField-currentlyWorkHere"><label for="cur"><span>I currently work here</span></label><input id="cur" type="checkbox"></div>
  <div data-automation-id="formField-startDate"><label for="sd"><span>From</span><abbr>*</abbr></label>
    <div data-automation-id="dateInputWrapper"><input id="sd" type="text" placeholder="MM/YYYY"></div></div>
  <div data-automation-id="formField-endDate"><label for="ed"><span>To</span><abbr>*</abbr></label>
    <div data-automation-id="dateInputWrapper"><input id="ed" type="text" placeholder="MM/YYYY"></div></div>
  <div data-automation-id="formField-roleDescription"><label for="rd"><span>Role Description</span></label><textarea id="rd"></textarea></div>

  <h3>Education</h3>
  <div data-automation-id="formField-gradeAverage"><label for="gp">Cumulative GPA</label><input id="gp" type="text"></div>
  <div data-automation-id="formField-firstYear"><label for="fy">First Year Attended</label><input id="fy" type="text" placeholder="YYYY"></div>
  <div data-automation-id="formField-lastYear"><label for="ly">Last Year Attended</label><input id="ly" type="text" placeholder="YYYY"></div>
`;

const PROFILE = {
  personalInfo: { firstName: 'Jane', lastName: 'Doe', email: 'jane@example.com', phone: '5551234567', linkedinUrl: 'https://linkedin.com/in/jane', websiteUrl: 'https://jane.dev' },
  address: { street: '31 Spooner St', city: 'Quahog', zip: '02840', state: '', country: '' },
  workExperience: [{ company: 'Powers Health', title: 'Prep Cook', location: 'Munster, IN', description: 'Cooked things.', startDate: { month: '03', year: '2021' }, endDate: { month: '06', year: '2023' }, isCurrentRole: false }],
  education: [{ school: '', degree: '', fieldOfStudy: '', gpa: '3.5', startDate: { year: '2017' }, endDate: { year: '2021' } }],
  jobPreferences: { isAtLeast18: true, authorizedToWork: true, requiresSponsorship: false, formerEmployee: false, sourceReferral: '', autoDisclosures: false }
};

const dom = new JSDOM(`<!doctype html><html><body>${BODY}</body></html>`, { runScripts: 'outside-only', pretendToBeVisual: true });
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
w.MutationObserver = w.MutationObserver || class { observe() {} disconnect() {} };
w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
w.eval(adapterPrelude() + fs.readFileSync(NEW, 'utf8') + String.raw`
;window.__setProfile = (p) => { userProfile = p; };`);
w.__setProfile(PROFILE);

const keepAlive = setInterval(() => {}, 500);
let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

(async () => {
  w.eval('window.__done = scanAndFill().then(() => true, (e) => String(e && e.stack || e));');
  const outcome = await Promise.race([w.__done, new Promise(r => setTimeout(() => r('TIMEOUT'), 20000))]);
  if (outcome !== true) console.log('  [scanAndFill ->', outcome, ']');

  const v = (id) => w.document.getElementById(id).value;
  check('First Name', v('fn'), 'Jane');
  check('Last Name', v('ln'), 'Doe');
  check('Email', v('em'), 'jane@example.com');
  check('LinkedIn', v('li'), 'https://linkedin.com/in/jane');
  check('Personal Website', v('ws'), 'https://jane.dev');
  check('Address', v('a1'), '31 Spooner St');
  check('City', v('ci'), 'Quahog');
  check('Job Title', v('jt'), 'Prep Cook');
  check('Company', v('co'), 'Powers Health');
  check('Location', v('lo'), 'Munster, IN');
  check('Role Description', v('rd'), 'Cooked things.');
  check('currently-work-here left unticked', w.document.getElementById('cur').checked, false);
  check('From', v('sd'), '03/2021');
  check('To', v('ed'), '06/2023');
  check('GPA', v('gp'), '3.5');
  check('First Year Attended', v('fy'), '2017');
  check('Last Year Attended', v('ly'), '2021');

  clearInterval(keepAlive);
  console.log(failures ? `\n${failures} FAILING` : '\nscanAndFill smoke test passed');
  process.exit(failures ? 1 : 0);
})();
