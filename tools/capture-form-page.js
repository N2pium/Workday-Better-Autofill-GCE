/**
 * Job form snapshot for any site (iCIMS, Lever, Paylocity...), for building
 * autofill tests from REAL pages. READ ONLY: it changes nothing on the page.
 *
 * Use it on a page of the application that asks for your details (not the
 * sign-in page):
 *   1. Open DevTools (F12) > Console.
 *   2. If the form is inside an iframe (iCIMS usually is), pick that frame in
 *      the console's context menu (top-left, "top" > the icims.com frame).
 *   3. Paste this file and press Enter. It downloads form-<host>-<time>.html.
 *
 * What is kept: tags, ids, names, types, classes, roles, aria-* names,
 * autocomplete, required, and the text of headings, labels, legends,
 * questions, buttons and dropdown options.
 *
 * What is NEVER kept (your answers):
 *   - values of text boxes, text areas and hidden fields (dropped),
 *   - which dropdown option is selected (dropped),
 *   - whether any checkbox or radio button is ticked (dropped),
 *   - placeholder-free free text you typed, scripts, styles, images, iframes.
 * Text outside labels and options is kept, so check the file before sharing if
 * the page shows your name in a header. Save it in tools/captures/private/
 * (never committed) and tell Claude.
 */
(() => {
  const root = document.body;
  const KEEP_ATTR = /^(id|name|for|type|class|role|autocomplete|required|disabled|readonly|multiple|accept|maxlength|placeholder|hidden|style|aria-(label|labelledby|describedby|required|invalid|haspopup|expanded|controls|hidden)|data-[\w-]+)$/i;
  const SKIP = new Set(['SCRIPT', 'STYLE', 'SVG', 'IMG', 'PATH', 'NOSCRIPT', 'IFRAME', 'CANVAS', 'VIDEO', 'LINK', 'META']);
  const VALUE_ATTRS = /^(value|checked|selected|data-value|data-initial-value|aria-valuetext|aria-valuenow)$/i;
  let nodes = 0;

  function copy(node) {
    if (node.nodeType === Node.TEXT_NODE) {
      return document.createTextNode(node.textContent.replace(/\s+/g, ' '));
    }
    if (node.nodeType !== Node.ELEMENT_NODE || SKIP.has(node.tagName)) return null;
    const out = document.createElement(node.tagName.toLowerCase());
    for (const a of node.attributes) {
      if (VALUE_ATTRS.test(a.name)) continue;
      if (a.name === 'style' && !/display\s*:\s*none|visibility\s*:\s*hidden/i.test(a.value)) continue;
      if (KEEP_ATTR.test(a.name)) out.setAttribute(a.name, a.value.slice(0, 300));
    }
    nodes++;
    // Options keep their text and value (the choices on offer, not your answer).
    if (node.tagName === 'OPTION') {
      out.setAttribute('value', node.value);
      out.textContent = node.textContent.trim();
      return out;
    }
    // A typed answer never leaves: text areas are emptied, inputs have no value.
    if (node.tagName === 'TEXTAREA') return out;
    for (const child of node.childNodes) {
      const c = copy(child);
      if (c) out.appendChild(c);
    }
    return out;
  }

  const body = copy(root);
  const host = location.hostname.replace(/[^a-z0-9.-]/gi, '');
  const html = `<!doctype html>\n<!-- capture-form-page.js: ${host}${location.pathname} at ${new Date().toISOString()}; values removed -->\n` +
    `<html><head><title>${document.title.replace(/</g, '')}</title></head>${body.outerHTML}</html>`;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([html], { type: 'text/html' }));
  a.download = `form-${host}-${Date.now()}.html`;
  a.click();
  console.log(`Saved ${a.download}: ${nodes} elements, no values. Put it in tools/captures/private/ and tell Claude.`);
})();
