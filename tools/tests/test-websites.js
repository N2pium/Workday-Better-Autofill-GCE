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
  w.eval(fs.readFileSync(src, 'utf8'));
  return w;
}

const NEW = path.resolve(__dirname, '..', '..', 'content.js');
const LI = 'https://linkedin.com/in/jane';
const SITE = 'https://jane.dev';

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

// Greenhouse-style: two separately labelled boxes.
async function labelled() {
  const w = boot(NEW, `
    <div data-automation-id="formField-linkedin"><label for="li">LinkedIn Profile</label><input id="li" type="text"></div>
    <div data-automation-id="formField-website"><label for="ws">Website</label><input id="ws" type="text"></div>
  `);
  w.eval(`fillFieldByFuzzyLabel(['linkedin'], ${JSON.stringify(LI)});
          fillFieldByFuzzyLabel(['personal website', 'portfolio', 'website'], ${JSON.stringify(SITE)});`);
  return [w.document.getElementById('li').value, w.document.getElementById('ws').value];
}

async function labelledNoSite() {
  const w = boot(NEW, `
    <div data-automation-id="formField-linkedin"><label for="li">LinkedIn Profile</label><input id="li" type="text"></div>
    <div data-automation-id="formField-website"><label for="ws">Website</label><input id="ws" type="text"></div>
  `);
  const site = '';
  w.eval(`fillFieldByFuzzyLabel(['linkedin'], ${JSON.stringify(LI)});
          fillFieldByFuzzyLabel(['personal website', 'portfolio', 'website'], ${JSON.stringify(site || LI)});`);
  return [w.document.getElementById('li').value, w.document.getElementById('ws').value];
}

// Workday's Websites section: one row, plus an Add button that appends another.
function websitesSectionDom() {
  return `
    <section id="ws-sec">
      <h3>Websites</h3>
      <div id="rows">
        <div data-automation-id="formField-url0"><label for="u0">URL</label><input id="u0" type="text"></div>
      </div>
      <button data-automation-id="Add" id="addbtn">Add</button>
    </section>`;
}

async function websitesSection(urls) {
  const w = boot(NEW, websitesSectionDom());
  let n = 1;
  w.document.getElementById('addbtn').addEventListener('click', () => {
    const d = w.document.createElement('div');
    d.setAttribute('data-automation-id', `formField-url${n}`);
    d.innerHTML = `<label for="u${n}">URL</label><input id="u${n}" type="text">`;
    w.document.getElementById('rows').appendChild(d);
    n++;
  });
  await w.eval(`handleWebsitesSection(${JSON.stringify(urls)})`);
  return Array.from(w.document.querySelectorAll('#rows input')).map(i => i.value);
}

(async () => {
  check('labelled LinkedIn + Website boxes', await labelled(), [LI, SITE]);
  check('no website stored -> Website box still gets LinkedIn (shipped behaviour)', await labelledNoSite(), [LI, LI]);
  check('Websites section: both links, second row added', await websitesSection([LI, SITE]), [LI, SITE]);
  check('Websites section: one link, no extra row', await websitesSection([LI, '']), [LI]);
  check('Websites section: same link twice, no duplicate row', await websitesSection([LI, LI]), [LI]);

  console.log(failures ? `\n${failures} FAILING` : '\nall website checks passed');
  process.exit(failures ? 1 : 0);
})();
