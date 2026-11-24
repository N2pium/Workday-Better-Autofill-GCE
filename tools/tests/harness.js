// Loads the real content.js into a jsdom window with the minimum shims it needs.
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const SRC = path.resolve(__dirname, '..', '..', 'content.js');

function load(bodyHtml, extraSource = '') {
  const dom = new JSDOM(`<!doctype html><html><body>${bodyHtml}</body></html>`, {
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;

  w.chrome = {
    runtime: {
      onMessage: { addListener() {} },
      sendMessage() {},
      lastError: null
    },
    storage: { local: { get(k, cb) { cb && cb({}); } } }
  };

  // jsdom does no layout: offsetParent is always null and every rect is 0x0.
  // content.js uses both as "is this visible", so model them off display/hidden.
  Object.defineProperty(w.HTMLElement.prototype, 'offsetParent', {
    configurable: true,
    get() {
      for (let el = this; el && el.nodeType === 1; el = el.parentElement) {
        if (el.hidden) return null;
        if (el.style && el.style.display === 'none') return null;
        if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return null;
      }
      return this.ownerDocument.body;
    }
  });
  // jsdom implements no innerText at all. Chrome does; content.js relies on it.
  if (!('innerText' in w.HTMLElement.prototype)) {
    Object.defineProperty(w.HTMLElement.prototype, 'innerText', {
      configurable: true,
      get() { return this.textContent; },
      set(v) { this.textContent = v; }
    });
  }
  // jsdom ships no CSS.escape.
  if (!w.CSS) w.CSS = {};
  if (!w.CSS.escape) w.CSS.escape = (s) => String(s).replace(/[^a-zA-Z0-9_-]/g, (c) => '\u005C' + c);
  w.Element.prototype.scrollIntoView = function () {};
  w.Element.prototype.getBoundingClientRect = function () {
    return { width: 100, height: 20, top: 10, bottom: 30, left: 0, right: 100, x: 0, y: 10 };
  };

  // extraSource runs in the same eval, so it can reach content.js's let bindings.
  w.eval(fs.readFileSync(SRC, 'utf8') + String.fromCharCode(10) + ';' + extraSource);
  return { dom, w };
}

module.exports = { load };
