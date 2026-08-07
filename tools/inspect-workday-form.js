/**
 * Workday form inspector — READ ONLY.
 *
 * Paste into DevTools console on any Workday application page and copy the
 * output back. Fills nothing, clicks nothing, submits nothing.
 *
 * Purpose: the autofill improvement loop has no live Workday form in its
 * context, so every change it makes is a guess about what the DOM looks like.
 * This dumps the real selector inventory so those guesses become evidence.
 *
 * Output lands on your clipboard as JSON.
 */
(() => {
  const vis = el => {
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const labelFor = el => {
    // Mirror the strategies content.js actually uses, so we learn which one wins.
    const aria = el.getAttribute('aria-label');
    if (aria) return { text: aria, via: 'aria-label' };

    if (el.id) {
      const l = document.querySelector(`label[for="${CSS.escape(el.id)}"]`);
      if (l) return { text: l.innerText.trim(), via: 'label[for]' };
    }

    const c = el.closest('div[data-automation-id="formField"], div[data-automation-id="dateWidget"]');
    if (c) {
      const l = c.querySelector('label');
      if (l) return { text: l.innerText.trim(), via: 'formField>label' };
    }

    const labelledby = el.getAttribute('aria-labelledby');
    if (labelledby) {
      const l = document.getElementById(labelledby.split(/\s+/)[0]);
      if (l) return { text: l.innerText.trim(), via: 'aria-labelledby' };
    }

    return { text: null, via: 'NONE — content.js would not match this field' };
  };

  const fields = [...document.querySelectorAll('input:not([type=hidden]), textarea, select')]
    .map(el => {
      const { text, via } = labelFor(el);
      return {
        tag: el.tagName.toLowerCase(),
        type: el.type || null,
        automationId: el.getAttribute('data-automation-id'),
        label: text,
        labelVia: via,
        id: el.id || null,
        name: el.getAttribute('name') || null,
        placeholder: el.placeholder || null,
        required: el.required || el.getAttribute('aria-required') === 'true',
        hasValue: !!el.value,
        visible: vis(el),
      };
    });

  // Workday renders dropdowns as buttons/divs, not <select>. These are what
  // selectWorkdayDropdown and handleDropdown are hunting for.
  const dropdowns = [...document.querySelectorAll(
    '[aria-haspopup="listbox"], [role="combobox"], ' +
    '[data-automation-id="selectSelectedOption"], [data-automation-id="selectWidget"]'
  )].map(el => ({
    tag: el.tagName.toLowerCase(),
    automationId: el.getAttribute('data-automation-id'),
    ariaLabel: el.getAttribute('aria-label'),
    currentText: el.innerText.trim().slice(0, 60) || null,
    expanded: el.getAttribute('aria-expanded'),
    visible: vis(el),
  }));

  const buttons = [...document.querySelectorAll('button')]
    .filter(vis)
    .map(el => ({
      automationId: el.getAttribute('data-automation-id'),
      ariaLabel: el.getAttribute('aria-label'),
      text: el.innerText.trim().slice(0, 40) || null,
    }));

  // Frequency table of every data-automation-id on the page. This is the
  // highest-signal output: it shows Workday's actual vocabulary.
  const automationIds = {};
  document.querySelectorAll('[data-automation-id]').forEach(el => {
    const k = el.getAttribute('data-automation-id');
    automationIds[k] = (automationIds[k] || 0) + 1;
  });

  const report = {
    url: location.href.split('?')[0],
    capturedAt: new Date().toISOString(),
    pageHeading: document.querySelector('h1, h2')?.innerText.trim() || null,
    counts: {
      fields: fields.length,
      fieldsWithNoLabel: fields.filter(f => f.labelVia.startsWith('NONE')).length,
      dropdowns: dropdowns.length,
    },
    fields,
    dropdowns,
    buttons,
    automationIds: Object.fromEntries(
      Object.entries(automationIds).sort((a, b) => b[1] - a[1])
    ),
  };

  const json = JSON.stringify(report, null, 2);
  console.log(report); // expandable object, eyeball it here
  console.log(json);   // plain text, select-and-copy fallback

  // `copy` is a DevTools console helper and does not always exist. Never let
  // its absence throw away the report we just built.
  let copied = false;
  try { copy(json); copied = true; } catch (e) { /* fall back to the logged text */ }

  return `Captured ${fields.length} fields, ${dropdowns.length} dropdowns, `
    + `${report.counts.fieldsWithNoLabel} unlabelled. `
    + (copied ? 'Copied to clipboard.' : 'Copy the JSON logged above.');
})();
