// Each job in the profile fills its own Workday "Work Experience N" panel.
// Regression for 2026-11-22: every panel got job #1 and the rest never appeared.
const { load } = require('./harness');

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

let uid = 0;
function panel(n, { del = false } = {}) {
  const f = (label, tag = 'input') => {
    const id = `f${uid++}`;
    return `<div data-automation-id="formField-x"><label for="${id}">${label}</label><${tag} id="${id}" class="${label.replace(/\W/g, '')}"></${tag}>${tag === 'textarea' ? '' : ''}</div>`;
  };
  return `<div role="group" class="panel"><h4>Work Experience ${n}</h4>
    ${f('Job Title*')}${f('Company*')}${f('Location')}
    <div data-automation-id="formField-cur"><input type="checkbox" id="cb${n}"><label for="cb${n}">I currently work here</label></div>
    ${f('Role Description', 'textarea')}${del ? '<button data-automation-id="panel-set-delete-button" class="del">Delete</button>' : ''}</div>`;
}

function page(existing) {
  let html = `<section id="sec"><h3>Work Experience</h3><div id="panels">`;
  for (let i = 1; i <= existing; i++) html += panel(i);
  return html + `</div><button data-automation-id="add-button" id="add">Add Another</button></section>
    <div data-automation-id="formField-city"><label for="city">City</label><input id="city"></div>`;
}

function boot(existing) {
  const { w } = load(page(existing));
  w.console.log = () => {}; w.console.warn = () => {};
  let n = existing;
  w.document.getElementById('add').addEventListener('click', () => {
    n++;
    w.document.getElementById('panels').insertAdjacentHTML('beforeend', panel(n));
  });
  return w;
}

function read(w) {
  return Array.from(w.document.querySelectorAll('.panel')).map(p => [
    p.querySelector('.JobTitle').value, p.querySelector('.Company').value, p.querySelector('.Location').value
  ]);
}

const JOBS = [
  { company: 'AWS', title: 'Student Builder Campus Leader', location: 'Remote', isCurrentRole: true },
  { company: 'Acme', title: 'Intern', location: 'Charlotte, NC' },
  { company: 'Cafe', title: 'Barista', location: 'Raleigh, NC' }
];

(async () => {
  // Three panels already on the page, three jobs: one each, no duplicates.
  let w = boot(3);
  await w.eval(`handleWorkExperience(${JSON.stringify(JOBS)})`);
  check('3 panels, 3 jobs: each panel gets its own job', read(w), JOBS.map(j => [j.title, j.company, j.location]));
  check('current-role box ticked only on job 1',
    [1, 2, 3].map(i => w.document.getElementById(`cb${i}`).checked), [true, false, false]);
  check('City outside the section untouched', w.document.getElementById('city').value, '');

  // One panel, three jobs: Add is clicked twice.
  w = boot(1);
  await w.eval(`handleWorkExperience(${JSON.stringify(JOBS)})`);
  check('1 panel, 3 jobs: adds panels for the rest', read(w), JOBS.map(j => [j.title, j.company, j.location]));

  // No panels yet: Add opens the first.
  w = boot(0);
  await w.eval(`handleWorkExperience(${JSON.stringify(JOBS.slice(0, 2))})`);
  check('0 panels, 2 jobs: adds both', read(w), JOBS.slice(0, 2).map(j => [j.title, j.company, j.location]));

  // One job, three panels: only panel 1 filled.
  w = boot(3);
  await w.eval(`handleWorkExperience(${JSON.stringify(JOBS.slice(0, 1))})`);
  check('1 job, 3 panels: no copies', read(w).map(r => r[1]), ['AWS', '', '']);

  // Single-entry form with no numbered panels: old page-wide behaviour.
  ({ w } = load(`<div data-automation-id="formField-c"><label for="c">Company</label><input id="c"></div>`));
  w.console.log = () => {};
  await w.eval(`handleWorkExperience(${JSON.stringify(JOBS)})`);
  check('no panels, no Add: first job page-wide', w.document.getElementById('c').value, 'AWS');

  // Workday's own "Autofill with Resume" added extra panels (report 2026-11-24):
  // after filling, extras with no Job Title are deleted; titled extras are kept.
  const parsedPage = (titles, { deletes = true } = {}) => {
    const { w } = load(`<section><h3>Work Experience</h3><div id="panels">${titles.map((_, i) => panel(i + 1, { del: true })).join('')}</div>
      <button data-automation-id="add-button" id="add">Add Another</button></section>`, 'window.__trace = () => JSON.stringify(fillTrace);');
    w.console.log = () => {}; w.console.warn = () => {};
    w.document.querySelectorAll('.panel').forEach((p, i) => { p.querySelector('.JobTitle').value = titles[i]; });
    if (deletes) w.document.querySelectorAll('.del').forEach(b => b.addEventListener('click', () => b.closest('.panel').remove()));
    return w;
  };
  w = parsedPage(['', '', '', '']);
  await w.eval(`handleWorkExperience(${JSON.stringify(JOBS.slice(0, 2))})`);
  check("4 panels from Workday's resume parse, 2 jobs: the 2 untitled extras are deleted", read(w).map(r => r[0]), ['Student Builder Campus Leader', 'Intern']);

  w = parsedPage(['', '', 'Parsed Analyst', '']);
  await w.eval(`handleWorkExperience(${JSON.stringify(JOBS.slice(0, 2))})`);
  check('an extra entry WITH a title is kept; only the untitled one goes', read(w).map(r => r[0]), ['Student Builder Campus Leader', 'Intern', 'Parsed Analyst']);

  w = parsedPage(['', '', ''], { deletes: false });
  await w.eval(`step('Work experience', () => handleWorkExperience(${JSON.stringify(JOBS.slice(0, 2))}))`);
  const t = JSON.parse(w.eval('__trace()'))[0];
  check('an untitled extra that will not delete is reported failed, with the reason', [t.status, /delete it by hand/.test(t.detail)], ['failed', true]);

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
