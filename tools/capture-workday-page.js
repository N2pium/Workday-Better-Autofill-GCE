/**
 * Workday page snapshot, for building autofill tests from REAL pages. READ ONLY.
 *
 * Paste into the DevTools console on a Workday application step (My Information,
 * My Experience, Application Questions, Voluntary Disclosures, Self Identify)
 * and press Enter. It downloads workday-<step>-<time>.html: the form's
 * STRUCTURE only. Then, optionally, run  await __wdOptions()  to add each
 * dropdown's option list (it opens and closes each dropdown, choosing nothing).
 * For a search-box menu (e.g. How did you hear about us), open it yourself and
 * run  __wdPopup()  to save just that open menu.
 *
 * What is kept: tags, roles, aria-* names, data-automation-id, id/name/for/type,
 * and the text of headings, labels, legends, questions, buttons and options.
 *
 * What is NEVER kept (your answers):
 *   - values of text boxes and text areas (dropped),
 *   - what a dropdown currently shows (replaced by [chosen] unless it is "Select One"),
 *   - the dropdown aria-label (Workday puts the current answer there),
 *   - selected tags/pills such as your school or skills ([chosen]),
 *   - whether any checkbox or radio button is ticked,
 *   - anything inside the page header (your name), scripts, styles and images.
 * Save the file in  tools/captures/private/  (never committed) and tell Claude.
 */
(() => {
  const root = document.querySelector('[data-automation-id="applyFlowPage"]') || document.querySelector('main') || document.body;
  const KEEP_ATTR = /^(role|type|id|name|for|data-automation-id|data-automation-label|aria-(haspopup|expanded|required|labelledby|describedby|controls|disabled|multiselectable|invalid)|maxlength|placeholder|required|disabled|tabindex|hidden)$/i;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'IMG', 'PATH', 'NOSCRIPT', 'IFRAME', 'CANVAS', 'VIDEO']);
  const CHOSEN = '[chosen]';
  let nodes = 0;

  // promptAriaInstruction reads "1 item selected, <your answer>" for screen readers.
  const isChosenPill = (el) => el.closest('[data-automation-id="selectedItem"], [data-automation-id="selectedItemList"], [data-automation-id="promptAriaInstruction"], [data-automation-id="promptSelectionLabel"]');
  const isDropdownButton = (el) => el.tagName === 'BUTTON' && el.getAttribute('aria-haspopup') === 'listbox';
  const esc = (t) => t.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const escAttr = (t) => esc(t).replace(/"/g, '&quot;');

  function attrs(el) {
    const out = [];
    for (const a of el.attributes) {
      if (!KEEP_ATTR.test(a.name)) continue;
      let v = a.value.slice(0, 200);
      if (a.name === 'data-automation-label' && isChosenPill(el)) v = CHOSEN;
      out.push(`${a.name}="${escAttr(v)}"`);
    }
    return out.length ? ' ' + out.join(' ') : '';
  }

  function walk(el, depth) {
    if (++nodes > 8000 || depth > 60) return '';
    if (el.nodeType === 3) {
      const t = el.textContent.replace(/\s+/g, ' ');
      if (!t.trim()) return '';
      const p = el.parentElement;
      if (p && (isChosenPill(p) || isDropdownButton(p))) {
        return /^\s*select one\s*$/i.test(t) ? esc(t.trim()) : CHOSEN;
      }
      return esc(t.slice(0, 600));
    }
    if (el.nodeType !== 1 || SKIP.has(el.tagName.toUpperCase())) return '';
    if (el.matches('[data-automation-id="header"], header')) return '<!-- header omitted -->';
    const tag = el.tagName.toLowerCase();
    if (tag === 'input' || tag === 'textarea') {
      const had = (el.type === 'checkbox' || el.type === 'radio') ? '' : (el.value ? ' data-had-value="1"' : '');
      return tag === 'input' ? `<input${attrs(el)}${had}>` : `<textarea${attrs(el)}${had}></textarea>`;
    }
    let inner = '';
    for (const c of el.childNodes) inner += walk(c, depth + 1);
    if (tag === 'select') inner = Array.from(el.options).map(o => `<option>${esc(o.text.slice(0, 80))}</option>`).join('');
    return `<${tag}${attrs(el)}>${inner}</${tag}>`;
  }

  const heading = (root.querySelector('h2, h3') || {}).innerText || 'page';
  const slug = heading.trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'page';
  let body = walk(root, 0);

  const save = (html, suffix = '') => {
    const doc = `<!doctype html>\n<!-- Workday snapshot: ${esc(location.hostname)} | step "${esc(heading.trim())}" | ${new Date().toISOString()} | values removed -->\n<html><body>\n${html}\n</body></html>\n`;
    const a = document.createElement('a');
    a.href = URL.createObjectURL(new Blob([doc], { type: 'text/html' }));
    a.download = `workday-${slug}${suffix}-${Date.now()}.html`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Opens each dropdown, records its options, closes it. Chooses nothing.
  window.__wdOptions = async () => {
    const wait = (ms) => new Promise(r => setTimeout(r, ms));
    const lists = [];
    for (const btn of root.querySelectorAll('button[aria-haspopup="listbox"]')) {
      if (btn.offsetParent === null) continue;
      const fs = btn.closest('fieldset');
      const q = ((fs && fs.querySelector('legend')) || btn.closest('[data-automation-id^="formField"]')?.querySelector('label') || {}).innerText || '';
      btn.click();
      await wait(500);
      const lb = [...document.querySelectorAll('[role="listbox"]')].filter(l => l.getBoundingClientRect().height > 0).pop();
      const opts = lb ? [...lb.querySelectorAll('[role="option"]')].map(o => o.innerText.trim()).filter(Boolean).slice(0, 80) : [];
      lists.push(`<li data-question="${escAttr(q.trim().slice(0, 300))}" data-field="${escAttr(btn.closest('[data-automation-id^="formField"]')?.getAttribute('data-automation-id') || '')}">${opts.map(o => `<span>${esc(o)}</span>`).join(' | ')}</li>`);
      document.activeElement && document.activeElement.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      btn.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
      await wait(250);
    }
    save(`<ul id="dropdown-options">\n${lists.join('\n')}\n</ul>`, '-options');
    return `Saved options for ${lists.length} dropdowns. Check every dropdown still shows what you had chosen.`;
  };

  // The OPEN popup (search-box suggestion lists, nested "Recruiting Source >"
  // menus). Workday portals these to <body>, outside the form the main
  // snapshot walks. Open the menu yourself, then run  __wdPopup().
  window.__wdPopup = () => {
    const pops = [...document.querySelectorAll('[data-popper-placement], [data-automation-id="activeListContainer"], [visibility="opened"]')]
      .filter(p => p.getBoundingClientRect().height > 0 && !pops_has_parent(p));
    function pops_has_parent(p) { return p.parentElement && p.parentElement.closest('[data-popper-placement], [data-automation-id="activeListContainer"], [visibility="opened"]'); }
    if (!pops.length) return 'No open menu found: click the field so its list is showing, then run __wdPopup() again.';
    save(pops.map(p => walk(p, 0)).join('\n<hr>\n'), '-popup');
    return `Saved ${pops.length} open menu(s), values removed.`;
  };

  save(body);
  return `Saved a snapshot of "${heading.trim()}" (${nodes} elements, values removed) to Downloads.\n`
    + 'Optional: run  await __wdOptions()  to also save each dropdown\'s options.';
})();
