// Dropdowns, disclosures, education panels, checkboxes and the fill report, on DOM shaped
// like the real Workday pages in tools/LegallyAuthorized.png and tools/Gender.png:
//   <fieldset><legend>question</legend> ... <button aria-haspopup="listbox" aria-label=" Select One Required">
// with the option list portalled to the end of <body>.
const { load } = require('./harness');

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

let uid = 0;
const question = (text, options, id) => `
  <div data-automation-id="formField-${id}"><fieldset><legend><div id="rich-${id}">${text}<span>*</span></div></legend>
    <div><button aria-haspopup="listbox" type="button" id="${id}" aria-label=" Select One Required" data-options="${options.join('|')}">Select One</button></div>
  </fieldset></div>`;

/** Workday-like dropdowns: click opens a portalled listbox; clicking an option sets the button's text (unless `stubborn`). */
function wireDropdowns(w, { stubborn = [] } = {}) {
  const doc = w.document;
  doc.querySelectorAll('button[aria-haspopup="listbox"]').forEach(btn => {
    btn.addEventListener('click', () => {
      doc.querySelectorAll('[data-popper-placement]').forEach(n => n.remove());
      const pop = doc.createElement('div');
      pop.setAttribute('data-popper-placement', 'bottom');
      const ul = doc.createElement('ul');
      ul.setAttribute('role', 'listbox');
      for (const text of ['Select One', ...btn.dataset.options.split('|')]) {
        const li = doc.createElement('li');
        li.setAttribute('role', 'option');
        if (text === 'Select One') li.setAttribute('aria-disabled', 'true');
        li.innerHTML = `<div>${text}</div>`;
        li.addEventListener('click', () => {
          if (!stubborn.includes(btn.id)) {
            btn.textContent = text;
            btn.setAttribute('aria-label', ` ${text} Required`);
          }
          pop.remove();
        });
        ul.appendChild(li);
      }
      pop.appendChild(ul);
      doc.body.appendChild(pop);
    });
  });
}

function boot(body, opts = {}) {
  const { w } = load(body, 'window.__set = (p) => { userProfile = p; fillTrace = []; }; window.__trace = () => JSON.stringify(fillTrace);');
  w.console.log = () => {}; w.console.warn = () => {};
  wireDropdowns(w, opts);
  return w;
}

(async () => {
  // ---------------------------------------------------------------- application questions
  let w = boot(
    question('Are you legally eligible to work in the country to which you are applying?', ['Yes', 'No'], 'q1') +
    question('Will you now, or in the future, require sponsorship for employment VISA status?', ['Yes', 'No'], 'q2'));
  await w.eval(`__set({ jobPreferences: { authorizedToWork: true, requiresSponsorship: false } }); handleJobPreferences()`);
  check('legend question answered Yes, verified by the button text', w.document.getElementById('q1').textContent, 'Yes');
  check('sponsorship answered No', w.document.getElementById('q2').textContent, 'No');
  const steps = w.eval('__trace()');
  check('both reported as filled', JSON.parse(steps).filter(x => x.status === 'filled').length, 2);

  // A choice that doesn't stick is a reported failure, not a silent success.
  w = boot(question('Are you legally eligible to work in the country to which you are applying?', ['Yes', 'No'], 'q1'), { stubborn: ['q1'] });
  await w.eval(`__set({ jobPreferences: { authorizedToWork: true } }); handleJobPreferences()`);
  const t = JSON.parse(w.eval('__trace()'));
  check('a choice that did not stick is reported as failed', [t[0] && t[0].status, /still shows/.test(t[0] && t[0].detail)], ['failed', true]);

  // ---------------------------------------------------------------- citizenship
  const citizenQ = () => question('Are you a citizen of the United States?', ['Yes', 'No'], 'cz');
  w = boot(citizenQ());
  await w.eval(`__set({ jobPreferences: {} }); handleJobPreferences()`);
  check('citizenship left unanswered when "I am a U.S. citizen" is not ticked', w.document.getElementById('cz').textContent, 'Select One');
  w = boot(citizenQ());
  await w.eval(`__set({ jobPreferences: { usCitizen: true } }); handleJobPreferences()`);
  check('citizenship answered Yes only when ticked', w.document.getElementById('cz').textContent, 'Yes');

  // ---------------------------------------------------------------- voluntary disclosures
  w = boot(
    question('Gender', ['Male', 'Female', 'I do not wish to self-identify'], 'g') +
    question('Are you Hispanic or Latino?', ['Yes', 'No', 'I decline to answer'], 'h') +
    question('Please select the veteran status which most accurately describes your status', ['I identify as one or more of the classifications of protected veteran', 'I am not a protected veteran', 'I decline to self-identify'], 'v'));
  await w.eval(`__set({ jobPreferences: { autoDisclosures: true } }); fillDisclosures()`);
  check('Decline All on: Gender decline found under different wording', w.document.getElementById('g').textContent, 'I do not wish to self-identify');
  check('Decline All on: Hispanic decline wording matched', w.document.getElementById('h').textContent, 'I decline to answer');
  check('Decline All on: Veteran declined, not "not a veteran"', w.document.getElementById('v').textContent, 'I decline to self-identify');
  const disc = JSON.parse(w.eval('__trace()'));
  check('disclosure report never contains the chosen values', disc.some(x => /self-identify|decline|veteran status which/i.test(x.detail)), false);
  check('each disclosure reported as filled', disc.filter(x => x.status === 'filled').map(x => x.field), ['Gender', 'Hispanic or Latino', 'Veteran status']);

  const discPage = () => question('Gender', ['Male', 'Female', 'I do not wish to self-identify'], 'g') +
    question('Please select the veteran status which most accurately describes your status', ['I am not a protected veteran', 'I decline to self-identify'], 'v');
  w = boot(discPage());
  await w.eval(`__set({ demographics: { gender: 'Female' } }); fillDisclosures()`);
  check('saved profile answer is used', w.document.getElementById('g').textContent, 'Female');
  check('no saved answer and Decline All off: left for the user', w.document.getElementById('v').textContent, 'Select One');

  w = boot(discPage());
  await w.eval(`__set({}); fillDisclosures()`);
  check('nothing saved, Decline All off: nothing answered', [w.document.getElementById('g').textContent, w.document.getElementById('v').textContent], ['Select One', 'Select One']);

  // ---------------------------------------------------------------- education panels
  const panel = (n) => `<div role="group"><h4>Education ${n}</h4>
    <div data-automation-id="formField-gradeAverage"><label for="gpa${n}">Overall Result (GPA)</label><input id="gpa${n}" type="text"></div></div>`;
  w = boot(`<div role="group"><h3>Work Experience</h3><button data-automation-id="add-button" id="addWork">Add</button></div>
    <div role="group"><h3>Education</h3><div id="eduPanels"></div><button data-automation-id="add-button" id="addEdu">Add</button></div>`);
  let n = 0;
  const clicks = [];
  w.document.getElementById('addWork').addEventListener('click', () => clicks.push('work'));
  w.document.getElementById('addEdu').addEventListener('click', () => { clicks.push('edu'); n++; w.document.getElementById('eduPanels').insertAdjacentHTML('beforeend', panel(n)); });
  await w.eval(`handleEducation([{ gpa: '3.9' }, { gpa: '3.1' }])`);
  check('Education opened with ITS Add button, one panel per school', clicks, ['edu', 'edu']);
  check('each school fills its own panel', [w.document.getElementById('gpa1').value, w.document.getElementById('gpa2').value], ['3.9', '3.1']);

  w = boot(`<div data-automation-id="formField-gradeAverage"><label for="gp">Cumulative GPA</label><input id="gp" type="text"></div>`);
  await w.eval(`handleEducation([{ school: 'X' }])`);
  check('no GPA in the profile: GPA stays empty (no invented 2.8)', w.document.getElementById('gp').value, '');

  // ---------------------------------------------------------------- checkboxes
  w = boot(`<div data-automation-id="formField-terms"><div role="checkbox" aria-checked="false" id="cb" tabindex="0" aria-labelledby="cbl"></div>
    <span id="cbl">I have read and agree to the terms and conditions</span></div>`);
  w.document.getElementById('cb').addEventListener('click', (e) => {
    const el = e.currentTarget;
    el.setAttribute('aria-checked', el.getAttribute('aria-checked') === 'true' ? 'false' : 'true');
  });
  const ticked = await w.eval('handleTerms()');
  check('role="checkbox" terms box ticked and verified', [ticked, w.document.getElementById('cb').getAttribute('aria-checked')], [true, 'true']);

  // ---------------------------------------------------------------- fill report
  w = boot(`<div data-automation-id="applyFlowPage"><h2>Application Questions</h2>` +
    question('How did you hear about us?', ['LinkedIn', 'Indeed'], 'src') +
    `<div data-automation-id="formField-linkedInAccount"><label>LinkedIn</label><input type="text" id="li"></div></div>`);
  const report = JSON.parse(w.eval('JSON.stringify(buildFillReport())'));
  check('report lists the empty required dropdown by its question',
    report.empty.find(x => x.kind === 'dropdown'), { kind: 'dropdown', label: 'How did you hear about us?', field: 'src', required: true });
  check('report lists the empty LinkedIn box with Workday\'s field id', report.empty.find(x => x.kind === 'text').field, 'linkedInAccount');
  check('report page heading', report.page, 'Application Questions');

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
