// Workday "My Experience" page: Websites (Add button) and Social Network URLs (LinkedIn).
// Regression for 2026-11-23: the Websites Add button was never clicked (Workday marks it
// data-automation-id="add-button", the lookup only knew "Add") and LinkedIn stayed empty.
const { load } = require('./harness');

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

const LI = 'https://linkedin.com/in/jane';
const SITE = 'https://jane.dev';

// Shaped like Workday: every section has its own identical Add button.
function page({ linkedInLabelLinked = false } = {}) {
  return `
    <div role="group" aria-labelledby="we"><h3 id="we">Work Experience</h3>
      <button data-automation-id="add-button" id="addWork">Add</button></div>
    <div role="group" aria-labelledby="ws"><h3 id="ws">Websites</h3>
      <div id="webRows"></div>
      <button data-automation-id="add-button" id="addWeb">Add</button></div>
    <div role="group" aria-labelledby="sn"><h3 id="sn">Social Network URLs</h3>
      <div data-automation-id="formField-linkedInAccount">
        <label ${linkedInLabelLinked ? 'for="li"' : ''}>LinkedIn</label>
        <input type="text" id="${linkedInLabelLinked ? 'li' : 'socialNetworkAccounts--linkedInAccount'}">
      </div>
      <div data-automation-id="formField-twitterAccount"><label>Twitter</label><input type="text" id="tw"></div>
    </div>`;
}

function boot(opts) {
  const { w } = load(page(opts));
  w.console.log = () => {}; w.console.warn = () => {};
  const clicks = [];
  let n = 0;
  w.document.getElementById('addWork').addEventListener('click', () => clicks.push('work'));
  w.document.getElementById('addWeb').addEventListener('click', () => {
    clicks.push('web');
    w.document.getElementById('webRows').insertAdjacentHTML('beforeend',
      `<div data-automation-id="formField-url"><label for="u${n}">URL</label><input type="text" id="u${n}"></div>`);
    n++;
  });
  return { w, clicks };
}

(async () => {
  // Websites: the Websites Add button, never Work Experience's.
  let { w, clicks } = boot();
  check('finds the Websites Add button, not Work Experience\'s', w.eval('findAddWebsiteButton() && findAddWebsiteButton().id'), 'addWeb');
  check('finds the Work Experience Add button', w.eval('findAddWorkButton() && findAddWorkButton().id'), 'addWork');

  await w.eval(`handleWebsitesSection([${JSON.stringify(LI)}, ${JSON.stringify(SITE)}])`);
  const urls = Array.from(w.document.querySelectorAll('#webRows input')).map((i) => i.value);
  check('Websites: Add clicked once per link, both filled', [clicks, urls], [['web', 'web'], [LI, SITE]]);

  // LinkedIn, label not tied to the input: matched by Workday's field id.
  ({ w } = boot());
  w.eval(`fillFieldByFuzzyLabel(['linkedin'], ${JSON.stringify(LI)}); fillByFieldId(/linked-?in/i, ${JSON.stringify(LI)});`);
  check('LinkedIn filled via formField-linkedInAccount', w.document.getElementById('socialNetworkAccounts--linkedInAccount').value, LI);
  check('Twitter untouched', w.document.getElementById('tw').value, '');

  // LinkedIn with a proper label: filled once, the fallback doesn't touch a filled box.
  ({ w } = boot({ linkedInLabelLinked: true }));
  w.eval(`fillFieldByFuzzyLabel(['linkedin'], ${JSON.stringify(LI)});`);
  const before = w.document.getElementById('li').value;
  const n = w.eval(`fillByFieldId(/linked-?in/i, 'https://other')`);
  check('labelled LinkedIn filled by label; fallback leaves it alone', [before, n, w.document.getElementById('li').value], [LI, 0, LI]);

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
