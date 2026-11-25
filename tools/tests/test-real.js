// Work Experience modelled on "Screenshot Example #1.png": one masked MM/YYYY
// box per date, not a Month/Year pair. Run against both the pre-fix and the
// post-fix content.js.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');
const { adapterPrelude } = require('./harness');

// Variant A: distinct ids (the happy case).
// Variant B: From and To share an id — the duplicate-id behaviour Workday is
// already known to emit on this form (see F7 / my-information.json, where two
// name inputs share name--legalName--lastName).
function html({ dupId, nested }) {
  const toId = dupId ? 'sd' : 'ed';
  // Workday nests label text inside a <span> often enough that XPath text()
  // returns an empty node-set — findDropdownTrigger already documents this.
  const L = (t) => nested ? `<span>${t}</span>` : t;
  return `
  <a data-automation-id="backToJobPosting" href="#">Back to Job Posting</a>
  <h3>Work Experience</h3>
  <h4>Work Experience 1</h4>
  <div data-automation-id="formField-jobTitle"><label for="jt">Job Title<abbr>*</abbr></label><input id="jt" type="text"></div>
  <div data-automation-id="formField-companyName"><label for="co">Company<abbr>*</abbr></label><input id="co" type="text"></div>
  <div data-automation-id="formField-location"><label for="loc">Location</label><input id="loc" type="text"></div>
  <div data-automation-id="formField-currentlyWorkHere"><label for="cur">I currently work here</label><input id="cur" type="checkbox"></div>
  <div data-automation-id="formField-startDate">
    <label for="sd">${L('From')}<abbr>*</abbr></label>
    <div data-automation-id="dateInputWrapper"><input id="sd" type="text" placeholder="MM/YYYY"></div>
  </div>
  <div data-automation-id="formField-endDate">
    <label for="${toId}">${L('To')}<abbr>*</abbr></label>
    <div data-automation-id="dateInputWrapper"><input id="${toId}" data-role="end" type="text" placeholder="MM/YYYY"></div>
  </div>
  <div data-automation-id="formField-roleDescription"><label for="rd">Role Description</label><textarea id="rd"></textarea></div>
  <h3>Education</h3>
  <div data-automation-id="formField-eduFrom"><label for="ef">From (Year)</label><input id="ef" type="text" placeholder="YYYY"></div>
  <div data-automation-id="formField-eduTo"><label for="et">To (Year)</label><input id="et" type="text" placeholder="YYYY"></div>
`;
}

function boot(src, bodyHtml) {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.chrome = { runtime: { onMessage: { addListener() {} }, sendMessage() {}, lastError: null } };
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      for (let el = this; el && el.nodeType === 1; el = el.parentElement) {
        if (el.hidden) return null;
        if (el.style && el.style.display === 'none') return null;
      }
      return this.ownerDocument.body;
    }
  });
  if (!('innerText' in w.HTMLElement.prototype)) {
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
      configurable: true, get() { return this.textContent; }, set(v) { this.textContent = v; }
    });
  }
  // jsdom ships no CSS.escape.
  if (!w.CSS) w.CSS = {};
  if (!w.CSS.escape) w.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\u005C' + c);
  w.Element.prototype.scrollIntoView = function () {};
  w.Element.prototype.getBoundingClientRect = () => ({ width: 100, height: 20, top: 10, bottom: 30, left: 0, right: 100 });
  w.console.log = () => {}; w.console.warn = () => {};
  w.eval(adapterPrelude() + fs.readFileSync(src, 'utf8'));
  return w;
}

const start = { month: '03', year: '2021' };
const end = { month: '06', year: '2023' };

async function runOld(opts) {
  const w = boot(path.resolve(__dirname, 'old-content.js'), html(opts));
  await w.eval(`fillDate('from', ${JSON.stringify(start)})`);
  await w.eval(`fillDate('start date', ${JSON.stringify(start)})`);
  await w.eval(`fillFieldByFuzzyLabel(['from','start date'], '03/2021')`);
  await w.eval(`fillDate('to', ${JSON.stringify(end)})`);
  await w.eval(`fillDate('end date', ${JSON.stringify(end)})`);
  await w.eval(`fillFieldByFuzzyLabel(['to','end date'], '06/2023')`);
  return w;
}

async function runNew(opts) {
  const w = boot(path.resolve(__dirname, '..', '..', 'content.js'), html(opts));
  await w.eval(`fillDate(['from','start date'], ${JSON.stringify(start)})`);
  await w.eval(`fillDate(['to','end date'], ${JSON.stringify(end)})`);
  return w;
}

function report(tag, w) {
  const d = w.document;
  const from = d.querySelector('[data-automation-id="formField-startDate"] input').value;
  const to = d.querySelector('[data-automation-id="formField-endDate"] input').value;
  const desc = d.getElementById('rd').value;
  const title = d.getElementById('jt').value;
  const eduTo = d.getElementById('et').value;
  console.log(`  ${tag.padEnd(12)} From=${JSON.stringify(from).padEnd(12)} To=${JSON.stringify(to).padEnd(12)} (JobTitle=${JSON.stringify(title)} RoleDesc=${JSON.stringify(desc)} EduTo=${JSON.stringify(eduTo)})`);
  return { from, to };
}

(async () => {
  console.log('want: From="03/2021"  To="06/2023"\n');
  const variants = [
    ['VARIANT A — distinct ids, label text is a direct text node', { dupId: false, nested: false }],
    ['VARIANT B — From/To share an id (Workday duplicate-id behaviour)', { dupId: true, nested: false }],
    ['VARIANT C — label text nested in a <span> (XPath text() is empty)', { dupId: false, nested: true }],
  ];
  for (const [name, opts] of variants) {
    console.log(name);
    report('old code', await runOld(opts));
    report('new code', await runNew(opts));
    console.log('');
  }
})();
