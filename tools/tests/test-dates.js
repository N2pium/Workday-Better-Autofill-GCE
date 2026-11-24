const { load } = require('./harness');

// Modelled on Workday's My Experience page: a header link and a "Total
// Compensation" field that both contain the substring "to", which is what the
// old `following::` lookup latched onto for the end date.
const HTML = `
  <a data-automation-id="backToJobPosting" href="#">Back to Job Posting</a>
  <h2>Work Experience</h2>

  <div data-automation-id="formField-jobTitle">
    <label for="wt">Job Title</label><input id="wt" type="text">
  </div>

  <div data-automation-id="formField-startDate">
    <label for="sd">From</label>
    <div data-automation-id="dateWidget" id="sd">
      <div><input data-automation-id="dateSectionMonth-input" aria-label="Month" type="text"></div>
      <div><input data-automation-id="dateSectionYear-input" aria-label="Year" type="text"></div>
    </div>
  </div>

  <div data-automation-id="formField-endDate">
    <label for="ed">To</label>
    <div data-automation-id="dateWidget" id="ed">
      <div><input data-automation-id="dateSectionMonth-input" aria-label="Month" type="text"></div>
      <div><input data-automation-id="dateSectionYear-input" aria-label="Year" type="text"></div>
    </div>
  </div>

  <div data-automation-id="formField-totalComp">
    <label for="tc">Total Compensation</label><input id="tc" type="text">
  </div>
`;

let failures = 0;
function check(name, actual, expected) {
  const ok = actual === expected;
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `  (got ${JSON.stringify(actual)}, want ${JSON.stringify(expected)})`}`);
}

(async () => {
  const { w } = load(HTML);
  w.console.log = () => {};
  w.console.warn = () => {};

  await w.eval(`fillDate(['from', 'start date'], { month: '03', year: '2021' })`);
  await w.eval(`fillDate(['to', 'end date'], { month: '06', year: '2023' })`);

  const val = (sel) => w.document.querySelector(sel).value;

  check('From month', val('#sd [data-automation-id="dateSectionMonth-input"]'), '03');
  check('From year', val('#sd [data-automation-id="dateSectionYear-input"]'), '2021');
  check('To month', val('#ed [data-automation-id="dateSectionMonth-input"]'), '06');
  check('To year', val('#ed [data-automation-id="dateSectionYear-input"]'), '2023');
  check('Total Compensation untouched', val('#tc'), '');
  check('Job Title untouched', val('#wt'), '');

  // "I currently work here" ticked: Workday removes the To widget. The end date
  // must not fall back onto From.
  const { w: w2 } = load(HTML.replace(
    '<div data-automation-id="formField-endDate">',
    '<div data-automation-id="formField-endDate" hidden>'
  ));
  w2.console.log = () => {};
  w2.console.warn = () => {};
  await w2.eval(`fillDate(['from', 'start date'], { month: '03', year: '2021' })`);
  await w2.eval(`fillDate(['to', 'end date'], { month: '06', year: '2023' })`);
  const val2 = (sel) => w2.document.querySelector(sel).value;
  check('current role: From month still 03', val2('#sd [data-automation-id="dateSectionMonth-input"]'), '03');
  check('current role: From year still 2021', val2('#sd [data-automation-id="dateSectionYear-input"]'), '2021');

  // A tenant that renders one MM/YYYY box per date instead of two sections.
  const { w: w3 } = load(`
    <a href="#">Back to Job Posting</a>
    <div data-automation-id="formField-startDate"><label for="a">From</label><input id="a" type="text"></div>
    <div data-automation-id="formField-endDate"><label for="b">To</label><input id="b" type="text"></div>
    <div data-automation-id="formField-x"><label for="c">Total Compensation</label><input id="c" type="text"></div>
  `);
  w3.console.log = () => {};
  w3.console.warn = () => {};
  await w3.eval(`fillDate(['from', 'start date'], { month: '03', year: '2021' })`);
  await w3.eval(`fillDate(['to', 'end date'], { month: '06', year: '2023' })`);
  check('single-box From', w3.document.getElementById('a').value, '03/2021');
  check('single-box To', w3.document.getElementById('b').value, '06/2023');
  check('single-box Total Compensation untouched', w3.document.getElementById('c').value, '');

  console.log(failures ? `\n${failures} FAILING` : '\nall date checks passed');
  process.exit(failures ? 1 : 0);
})();
