// Fill-report round 2 (Wintrust, 2026-11-23). Pages shaped like the four reports:
//   - Application Questions pages reported Work Experience / Education / Languages
//     as "filled" though those sections were not on the page.
//   - LinkedIn "skipped" with no reason given.
//   - "How Did You Hear About Us?" is a search-box picker (formField-source), not a listbox.
//   - Graduation date / current major / minimum-GPA questions the profile already answers.
const { load } = require('./harness');

let failures = 0;
function check(name, actual, expected) {
  const ok = JSON.stringify(actual) === JSON.stringify(expected);
  if (!ok) failures++;
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${ok ? '' : `\n        got  ${JSON.stringify(actual)}\n        want ${JSON.stringify(expected)}`}`);
}

function boot(body) {
  const { w } = load(body, 'window.__set = (p) => { userProfile = p; fillTrace = []; answeredQuestions = new WeakSet(); }; window.__trace = () => JSON.stringify(fillTrace);');
  w.console.log = () => {}; w.console.warn = () => {}; w.console.error = () => {};
  // Yes/No listbox dropdowns, option list portalled to <body>.
  w.document.querySelectorAll('button[aria-haspopup="listbox"]').forEach(btn => {
    btn.addEventListener('click', () => {
      const pop = w.document.createElement('div');
      pop.setAttribute('data-popper-placement', 'bottom');
      pop.innerHTML = `<ul role="listbox">${['Yes', 'No'].map(t => `<li role="option"><div>${t}</div></li>`).join('')}</ul>`;
      pop.querySelectorAll('li').forEach(li => li.addEventListener('click', () => {
        btn.textContent = li.textContent; btn.setAttribute('aria-label', ` ${li.textContent} Required`); pop.remove();
      }));
      w.document.body.appendChild(pop);
    });
  });
  return w;
}

const legendText = (id, text) => `<div data-automation-id="formField-${id}"><fieldset><legend><div>${text}<span>*</span></div></legend>
  <input type="text" id="${id}" aria-required="true"></fieldset></div>`;
const legendDropdown = (id, text) => `<div data-automation-id="formField-${id}"><fieldset><legend><div>${text}<span>*</span></div></legend>
  <button aria-haspopup="listbox" type="button" id="${id}" aria-label=" Select One Required">Select One</button></fieldset></div>`;

const PROFILE = {
  personalInfo: { firstName: 'A', lastName: 'B' },
  workExperience: [{ company: 'AWS', title: 'Intern', location: 'Chicago', description: 'Built things' }],
  education: [
    { school: 'Old College', fieldOfStudy: 'Undeclared', endDate: { month: '5', year: '2023' } },
    { school: 'Purdue University', fieldOfStudy: 'Computer Science', gpa: '3.5', endDate: { month: '5', year: '2027' } }
  ],
  language: { name: 'English' },
  jobPreferences: {}
};

(async () => {
  // ------------------------------------------------ Application Questions page (report 4)
  const appPage = () => `<div data-automation-id="applyFlowPage"><h2>Application Questions</h2>
    ${legendText('g1', 'What is your anticipated graduation date?')}
    ${legendText('g2', 'What is your current major?')}
    ${legendDropdown('g3', 'This position requires a minimum GPA of 3.0/4.0 scale. Do you meet this requirement?')}
    ${legendDropdown('g4', 'Are you able to work on-site?')}
    ${legendText('g5', 'Please describe your location preference')}
    <div data-automation-id="multiselectInputContainer"></div><p>English is required for this role.</p></div>`;

  let w = boot(appPage());
  await w.eval(`__set(${JSON.stringify(PROFILE)}); (async () => {
    await step('Work experience', () => handleWorkExperience(${JSON.stringify(PROFILE.workExperience)}));
    await step('Education', () => handleEducation(${JSON.stringify(PROFILE.education)}));
    await step('Language', () => handleLanguages(${JSON.stringify(PROFILE.language)}));
  })()`);
  check('no Work Experience / Education / Languages entries on a page without those sections', JSON.parse(w.eval('__trace()')), []);
  check('page-wide work fill did not write the job description into another question', w.document.getElementById('g5').value, '');

  w = boot(appPage());
  await w.eval(`__set(${JSON.stringify(PROFILE)}); answerProfileQuestions()`);
  check('graduation date from the most recent school, MM/YYYY', w.document.getElementById('g1').value, '05/2027');
  check('current major from the most recent school', w.document.getElementById('g2').value, 'Computer Science');
  check('GPA 3.5 meets a 3.0 minimum: Yes', w.document.getElementById('g3').textContent, 'Yes');
  check('unrelated questions left for the user', [w.document.getElementById('g4').textContent, w.document.getElementById('g5').value], ['Select One', '']);
  check('each answer is in the report', JSON.parse(w.eval('__trace()')).map(x => x.status), ['filled', 'filled', 'filled']);

  w = boot(appPage());
  await w.eval(`__set({ education: [{ school: 'P', fieldOfStudy: 'CS', gpa: '2.7', endDate: { month: '12', year: '2026' } }] }); answerProfileQuestions()`);
  check('GPA below the minimum: No', w.document.getElementById('g3').textContent, 'No');

  w = boot(appPage());
  await w.eval(`__set({ education: [{ school: 'P', fieldOfStudy: 'CS', endDate: { month: '12', year: '2026' } }] }); answerProfileQuestions()`);
  check('no saved GPA: GPA question left alone (never guessed)', w.document.getElementById('g3').textContent, 'Select One');

  w = boot(appPage().replace('id="g2"', 'id="g2" value="Math"'));
  await w.eval(`__set(${JSON.stringify(PROFILE)}); answerProfileQuestions()`);
  check('an answer the user already typed is not overwritten', w.document.getElementById('g2').value, 'Math');

  // ------------------------------------------------ Cleveland-Cliffs pages (second report)
  const G = (n) => 'd516157ba0ca1001f37e5bd6ee70000' + n; // 32-hex GUID ids, as on the real page
  const cliffs = () => `<div data-automation-id="applyFlowPage"><h2>Application Questions</h2>
    ${legendText(G(1), 'What is your GPA?')}
    <div data-automation-id="formField-${G(6)}"><label for="sch">School or University Name<span>*</span></label><input type="text" id="sch"></div>
    ${legendDropdown(G(3), 'Do you have a High School Diploma or GED?')}
    ${legendDropdown(G(2), 'Do you have relatives who work for our company?')}
    ${legendText(G(4), 'What is your major?')}
    ${legendText(G(5), 'Did you engage with a specific employee at an on-campus recruiting event?')}</div>`;
  w = boot(cliffs());
  await w.eval(`__set(${JSON.stringify(PROFILE)}); (async () => {
    await step('Education', () => handleEducation(${JSON.stringify(PROFILE.education)}));
    await answerProfileQuestions();
  })()`);
  const $ = (id) => w.document.getElementById(id);
  check('a "School or University Name" question does not count as an Education section', JSON.parse(w.eval('__trace()')).some(x => x.field === 'Education'), false);
  check('GPA, school and major answered from the profile', [$(G(1)).value, $('sch').value, $(G(4)).value], ['3.5', 'Purdue University', 'Computer Science']);
  check('High School Diploma or GED: Yes for a university student', $(G(3)).textContent, 'Yes');
  check('relatives / recruiting-event questions left for the user', [$(G(2)).textContent, $(G(5)).value], ['Select One', '']);

  w = boot(cliffs());
  await w.eval(`__set({ education: [{ school: 'Lincoln High', endDate: { month: '6', year: '2024' } }] }); answerProfileQuestions()`);
  check('no college-level study: diploma question left alone; no GPA saved: GPA reported skipped',
    [$(G(3)).textContent, $(G(1)).value, JSON.parse(w.eval('__trace()')).find(x => /GPA/.test(x.field)).status], ['Select One', '', 'skipped']);
  check('report carries the build marker', /^\d{4}-\d\d-\d\d\w*$/.test(JSON.parse(w.eval('JSON.stringify(buildFillReport())')).build), true);

  // ------------------------------------------------ DMA pages (third report)
  w = boot(`${legendText('ga', 'What is your anticipated graduation date? (MM/YY)')}${legendText('gb', 'Expected graduation date (YYYY)')}${legendText('gc', 'Anticipated graduation (MM/DD/YYYY)')}`);
  await w.eval(`__set(${JSON.stringify(PROFILE)}); answerProfileQuestions()`);
  check('graduation date follows the format the question names; never invents a day',
    ['ga', 'gb', 'gc'].map(id => w.document.getElementById(id).value), ['05/27', '2027', '']);

  w = boot(`<div role="group"><h4>Education 1</h4>
    <div data-automation-id="formField-school"><label for="school">School or University<span>*</span></label><input type="text" id="school"></div></div>`);
  await w.eval(`step('Education', () => handleEducation(${JSON.stringify(PROFILE.education.slice(1))}))`);
  check('plain-text School box: typed in, and only then reported filled',
    [w.document.getElementById('school').value, JSON.parse(w.eval('__trace()'))[0].status], ['Purdue University', 'filled']);

  w = boot(`<div role="group"><h4>Education 1</h4>
    <div data-automation-id="formField-school"><label for="school">School or University<span>*</span></label><input type="text" data-automation-id="searchBox" id="school"></div></div>`);
  await w.eval(`step('Education', () => handleEducation(${JSON.stringify(PROFILE.education.slice(1))}))`);
  check('search-box School with no pill chosen: reported failed, not filled', JSON.parse(w.eval('__trace()'))[0].status, 'failed');

  const langPage = () => `<h3>Languages</h3><div role="group"><h4>Languages 1</h4><p>English</p>
    <div data-automation-id="formField-340568b8337b1001cad634a00e5f0001"><label for="ov">Overall<span>*</span></label>
    <button aria-haspopup="listbox" type="button" id="ov" aria-label=" Select One Required">Select One</button></div></div>`;
  const wireProf = (w) => { const b0 = w.document.getElementById('ov'); b0.replaceWith(b0.cloneNode(true)); w.document.getElementById('ov').addEventListener('click', () => {
    const pop = w.document.createElement('div'); pop.setAttribute('data-popper-placement', 'bottom');
    pop.innerHTML = `<ul role="listbox">${['Beginner', 'Intermediate', 'Advanced', 'Fluent'].map(t => `<li role="option"><div>${t}</div></li>`).join('')}</ul>`;
    pop.querySelectorAll('li').forEach(li => li.addEventListener('click', () => { w.document.getElementById('ov').textContent = li.textContent; pop.remove(); }));
    w.document.body.appendChild(pop);
  }); };
  w = boot(langPage()); wireProf(w);
  await w.eval(`step('Language', () => handleLanguages({ name: 'English', isNative: true }))`);
  check('"Overall" proficiency found by its label; native speaker gets the top level', w.document.getElementById('ov').textContent, 'Fluent');
  w = boot(langPage()); wireProf(w);
  await w.eval(`step('Language', () => handleLanguages({ name: 'English', isNative: false }))`);
  check('not native: proficiency left for the user and reported skipped',
    [w.document.getElementById('ov').textContent, JSON.parse(w.eval('__trace()')).find(x => x.field === 'Language proficiency').status], ['Select One', 'skipped']);

  // ------------------------------------------------ Ingredion pages (fourth report)
  const langQ = () => legendText('lq', 'What languages do you speak? Rate 1 beginner to 10 fluent.');
  w = boot(langQ());
  await w.eval(`__set({ language: { name: 'English', isNative: true } }); answerProfileQuestions()`);
  check('languages question with a 1-10 scale: native speaker gets the top of the scale', w.document.getElementById('lq').value, 'English - 10');
  w = boot(langQ());
  await w.eval(`__set({ language: { name: 'Spanish', isNative: false } }); answerProfileQuestions()`);
  check('not native: no self-rating invented', w.document.getElementById('lq').value, '');

  w = boot(legendDropdown('ethnicity', 'Ethnicity'));
  await w.eval(`__set({ jobPreferences: {}, demographics: {} }); fillDisclosures()`);
  check('Ethnicity with no saved answer: left alone and reported skipped',
    [w.document.getElementById('ethnicity').textContent, JSON.parse(w.eval('__trace()')).filter(x => /Race/.test(x.field)).map(x => x.status)], ['Select One', ['skipped']]);

  // ------------------------------------------------ My Experience still fills (gate does not over-block)
  w = boot(`<div role="group"><h3>Work Experience</h3>
    <div data-automation-id="formField-c"><label for="c">Company</label><input id="c"></div></div>`);
  await w.eval(`__set(${JSON.stringify(PROFILE)}); step('Work experience', () => handleWorkExperience(${JSON.stringify(PROFILE.workExperience)}))`);
  check('single-entry Work Experience section still filled and reported', [w.document.getElementById('c').value, JSON.parse(w.eval('__trace()'))[0].status], ['AWS', 'filled']);

  // ------------------------------------------------ LinkedIn skipped says why (report 2)
  w = boot(`<div data-automation-id="formField-linkedInAccount"><label for="li">LinkedIn</label><input id="li"></div>`);
  await w.eval(`__set({ personalInfo: { firstName: 'A' } }); scanAndFill()`);
  const li = JSON.parse(w.eval('__trace()')).find(x => x.field === 'LinkedIn');
  check('LinkedIn with no saved URL: skipped, with the reason', [li && li.status, /nothing is saved/.test(li && li.detail)], ['skipped', true]);

  // ------------------------------------------------ How Did You Hear About Us? search-box picker (report 1)
  // Modelled on tools/captures/private (Camping World + Ingredion, 2026-11-23): a search box whose
  // menu is portalled (activeListContainer > menuItem > promptLeafNode > promptOption). Top level =
  // categories without radios; inside a category: a backButton header and choices with radios.
  // `topLeaves` are top-level entries that are choices (clicking one picks it, no radio shown).
  const sourcePage = `<div data-automation-id="formField-source"><label for="src"><span>How Did You Hear About Us?<abbr>*</abbr></span></label>
    <div data-automation-id="multiSelectContainer"><div data-automation-id="multiselectInputContainer"><input placeholder="Search" id="src" aria-required="true">
    <ul data-automation-id="selectedItemList" role="listbox"></ul><span data-automation-id="promptIcon"></span></div></div></div>`;
  function wireSource(w, tree, { search = false, topLeaves = [] } = {}) {
    const doc = w.document;
    const field = doc.querySelector('[data-automation-id="formField-source"]');
    const input = doc.getElementById('src');
    const item = (label, leaf) => `<div data-automation-id="menuItem" role="option"><div data-automation-id="promptLeafNode">${leaf ? '<input type="radio" data-automation-id="radioBtn">' : ''}<div data-automation-id="promptOption" data-automation-label="${label}">${label}</div></div></div>`;
    const pick = (label) => {
      const li = doc.createElement('li');
      li.innerHTML = `<div data-automation-id="selectedItem" role="option"><div data-automation-id="DELETE_charm"></div><p data-automation-id="promptOption" data-automation-label="${label}">${label}</p></div>`;
      li.querySelector('[data-automation-id="DELETE_charm"]').addEventListener('click', () => li.remove());
      field.querySelector('[data-automation-id="selectedItemList"]').appendChild(li);
      doc.querySelectorAll('[data-popper-placement]').forEach(n => n.remove());
    };
    const render = (cat, flat) => {
      doc.querySelectorAll('[data-popper-placement]').forEach(n => n.remove());
      const pop = doc.createElement('div');
      pop.setAttribute('data-popper-placement', 'bottom');
      const rows = flat ? flat.map(l => item(l, true)).join('')
        : cat ? tree[cat].map(l => item(l, true)).join('')
        : Object.keys(tree).map(l => item(l, false)).join('');
      pop.innerHTML = `<div data-automation-id="responsiveMonikerPrompt">${cat ? `<div data-automation-id="multiSelectHeader"><span data-automation-id="backButton"></span><div data-automation-id="promptTitle">${cat}</div></div>` : ''}
        <div data-automation-id="activeListContainer" role="listbox">${rows}</div></div>`;
      const back = pop.querySelector('[data-automation-id="backButton"]');
      if (back) back.addEventListener('click', () => render(null));
      pop.querySelectorAll('[data-automation-id="promptOption"]').forEach(o => o.addEventListener('click', () => {
        const l = o.getAttribute('data-automation-label');
        if (!cat && !flat && !topLeaves.includes(l)) render(l); else pick(l);
      }));
      doc.body.appendChild(pop);
    };
    input.addEventListener('click', () => { if (!doc.querySelector('[data-popper-placement]')) render(null); });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      if (!search || !input.value) return render(null);
      const q = input.value.toLowerCase();
      render(null, Object.values(tree).flat().filter(l => l.toLowerCase().includes(q)));
    });
  }
  const pills = (w) => [...w.document.querySelectorAll('[data-automation-id="selectedItem"]')].map(p => p.textContent.trim());
  const hearStatus = (w) => JSON.parse(w.eval('__trace()')).filter(x => /hear about/i.test(x.field)).map(x => x.status);
  const CAMPING = { Campus: ['Career Fair'], LinkedIn: [], 'Job Board': ['Career Builder', 'Handshake', 'Indeed', 'Simply Hired'], Referral: ['Employee Referral'] };
  const INGREDION = { 'Recruiting Source': ['Job Board - Indeed.com', 'Internet - LinkedIn'], 'Social Referral': ['Friend'] };

  w = boot(sourcePage); wireSource(w, CAMPING, { topLeaves: ['LinkedIn'] });
  await w.eval(`__set({ jobPreferences: { sourceReferral: 'Indeed' } }); handleJobPreferences()`);
  check('nested menu, search does nothing: browses into Job Board and picks Indeed (a top-level choice picked on the way is undone)',
    [pills(w), hearStatus(w)], [['Indeed'], ['filled']]);

  w = boot(sourcePage); wireSource(w, INGREDION);
  await w.eval(`__set({ jobPreferences: { sourceReferral: 'Indeed' } }); handleJobPreferences()`);
  check('Ingredion: "Indeed" finds "Job Board - Indeed.com" under Recruiting Source', pills(w), ['Job Board - Indeed.com']);

  w = boot(sourcePage); wireSource(w, INGREDION, { search: true });
  await w.eval(`__set({ jobPreferences: { sourceReferral: 'LinkedIn' } }); handleJobPreferences()`);
  check('search that works: picks from the results', pills(w), ['Internet - LinkedIn']);

  w = boot(sourcePage); wireSource(w, CAMPING, { topLeaves: ['LinkedIn'] });
  await w.eval(`__set({ jobPreferences: { sourceReferral: 'LinkedIn' } }); handleJobPreferences()`);
  check('a top-level choice that matches is picked directly', pills(w), ['LinkedIn']);
  check('a picked answer is not listed as empty in the report', JSON.parse(w.eval('JSON.stringify(buildFillReport())')).empty.some(x => x.field === 'source'), false);

  w = boot(sourcePage); wireSource(w, CAMPING, { topLeaves: ['LinkedIn'] });
  await w.eval(`__set({ jobPreferences: { sourceReferral: 'Glassdoor' } }); handleJobPreferences()`);
  check('no such option anywhere: nothing picked (no guessing), reported failed', [pills(w), hearStatus(w)], [[], ['failed']]);

  w = boot(sourcePage);
  await w.eval(`__set({ jobPreferences: {} }); handleJobPreferences()`);
  check('no saved source: reported skipped, not silently missing', JSON.parse(w.eval('__trace()')).filter(x => /hear about/i.test(x.field)).map(x => x.status), ['skipped']);

  console.log(failures ? `\n${failures} FAILED` : '\nall passed');
  process.exit(failures ? 1 : 0);
})();
