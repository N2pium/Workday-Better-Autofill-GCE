/**
 * Generates docs/index.html from PRIVACY_POLICY.md.
 *
 * PRIVACY_POLICY.md stays the single source of truth. Two hand-maintained
 * copies of a policy that a store listing links to WILL drift, and a policy
 * that contradicts itself is a compliance problem, not a cosmetic one.
 *
 * Run after any edit to the policy:  node design/build-privacy.mjs
 *
 * Deliberately dependency-free and deliberately not a general Markdown
 * parser -- it handles exactly the constructs this one document uses, and
 * throws on anything it does not recognise rather than silently emitting
 * the raw source into the page.
 */
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const md = readFileSync(join(root, 'PRIVACY_POLICY.md'), 'utf8');

const esc = s => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

// Inline: `code`, **bold**, [text](url). Escaped first, so no raw HTML passes through.
// The bold body is non-greedy and allows '*', because the policy bolds a host
// pattern full of them: **Host permission `*://*.myworkdayjobs.com/*`**
function inline(s) {
  const html = esc(s)
    .replace(/`([^`]+)`/g, '<code>$1</code>')
    .replace(/\*\*([\s\S]+?)\*\*/g, '<strong>$1</strong>')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>');
  if (html.includes('**')) {
    throw new Error(`build-privacy: unconverted bold marker in -> ${JSON.stringify(s)}`);
  }
  return html;
}

const lines = md.split(/\r?\n/);
const out = [];
let list = null;                        // 'ul' | 'ol' | null

const closeList = () => { if (list) { out.push(`</${list}>`); list = null; } };
const openList = kind => { if (list !== kind) { closeList(); out.push(`<${kind}>`); list = kind; } };

for (const raw of lines) {
  const line = raw.trimEnd();
  if (!line.trim()) { closeList(); continue; }

  let m;
  if ((m = line.match(/^(#{1,6})\s+(.*)$/))) {
    closeList();
    const n = m[1].length;
    out.push(`<h${n}>${inline(m[2])}</h${n}>`);
  } else if ((m = line.match(/^\s*[-*]\s+(.*)$/))) {
    openList('ul');
    out.push(`<li>${inline(m[1])}</li>`);
  } else if ((m = line.match(/^\s*\d+\.\s+(.*)$/))) {
    openList('ol');
    out.push(`<li>${inline(m[1])}</li>`);
  } else if (/^\s{2,}\S/.test(raw) && list) {
    // continuation of the previous list item
    out[out.length - 1] = out[out.length - 1].replace(/<\/li>$/, ' ' + inline(line.trim()) + '</li>');
  } else if (/^[A-Za-z0-9*`[]/.test(line.trim())) {
    closeList();
    out.push(`<p>${inline(line.trim())}</p>`);
  } else {
    throw new Error(`build-privacy: unhandled Markdown line -> ${JSON.stringify(line)}`);
  }
}
closeList();

const title = (md.match(/^#\s+(.*)$/m) || [, 'Privacy Policy'])[1];

const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)} - Workday: Better Autofill</title>
<meta name="description" content="Privacy policy for the Workday: Better Autofill Chrome extension.">
<!-- GENERATED FILE - do not edit.
     Source: PRIVACY_POLICY.md   Rebuild: node design/build-privacy.mjs -->
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 3rem 1.25rem 5rem;
    font: 16px/1.65 -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #1c2024; background: #fff;
  }
  main { max-width: 44rem; margin: 0 auto; }
  h1 { font-size: 2rem; line-height: 1.2; margin: 0 0 .5rem; letter-spacing: -.02em; }
  h2 { font-size: 1.2rem; margin: 2.25rem 0 .6rem; letter-spacing: -.01em; }
  p, li { margin: .6rem 0; }
  ul, ol { padding-left: 1.4rem; }
  li::marker { color: #8a9099; }
  a { color: #2563c9; }
  code {
    font: .9em/1 ui-monospace, SFMono-Regular, Consolas, monospace;
    background: #f1f3f5; padding: .15em .4em; border-radius: 4px;
  }
  strong { font-weight: 600; }
  footer {
    margin-top: 3rem; padding-top: 1.25rem; border-top: 1px solid #e6e8eb;
    font-size: .875rem; color: #6b7280;
  }
  @media (prefers-color-scheme: dark) {
    body { color: #e6e8eb; background: #16181a; }
    li::marker { color: #6b7280; }
    a { color: #7aa7f0; }
    code { background: #24272b; }
    footer { border-top-color: #2a2e33; color: #9aa1aa; }
  }
</style>
</head>
<body>
<main>
${out.join('\n')}
<footer>
  Chrome extension &ldquo;Workday: Better Autofill&rdquo; &middot;
  <a href="https://github.com/N2pium/Workday-Better-Autofill-GCE">Source code on GitHub</a>
</footer>
</main>
</body>
</html>
`;

mkdirSync(join(root, 'docs'), { recursive: true });
writeFileSync(join(root, 'docs', 'index.html'), html, 'utf8');
// Serve the file as-is; no Jekyll build that could fail and 404 the policy URL.
writeFileSync(join(root, 'docs', '.nojekyll'), '', 'utf8');

console.log(`Wrote docs/index.html (${html.length} bytes) from PRIVACY_POLICY.md`);
