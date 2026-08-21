/*
 * Wolimons - test helpers
 *
 * The site's front-end files are browser scripts: an IIFE that hangs an
 * object off `window`. To test them here they need somewhere to hang it,
 * which is all this provides - a stub with the handful of things those files
 * actually touch, and nothing else.
 *
 * Deliberately not jsdom. The whole site has zero dependencies and installs
 * with a git pull; a test suite that needs `npm install` before it runs is a
 * suite that stops being run. Anything genuinely needing layout is tested by
 * driving the page in a browser instead, not here.
 */
'use strict';

const fs = require('fs');
const path = require('path');
const vm = require('vm');

const ROOT = path.join(__dirname, '..');

const read = relative => fs.readFileSync(path.join(ROOT, relative), 'utf8');

/*
 * Run a browser script and hand back whatever it put on `window`.
 *
 * The stub answers the few DOM calls these files make while loading. A file
 * that reaches for something not here will throw, which is the right outcome:
 * it means the file needs a real browser and does not belong in this suite.
 */
function loadBrowserScript(relative, extraGlobals = {}) {
  const element = () => ({
    style: {},
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    setAttribute() {},
    getAttribute: () => null,
    appendChild() {},
    append() {},
    replaceChildren() {},
    addEventListener() {},
    querySelector: () => null,
    querySelectorAll: () => [],
    textContent: '',
    children: [],
  });

  const documentStub = {
    createElement: element,
    createElementNS: element,
    getElementById: () => null,
    querySelector: () => null,
    querySelectorAll: () => [],
    addEventListener() {},
    readyState: 'complete',
    head: element(),
    body: element(),
  };

  const windowStub = {
    document: documentStub,
    localStorage: {
      store: new Map(),
      getItem(key) { return this.store.has(key) ? this.store.get(key) : null; },
      setItem(key, value) { this.store.set(key, String(value)); },
      removeItem(key) { this.store.delete(key); },
    },
    sessionStorage: {
      store: new Map(),
      getItem(key) { return this.store.has(key) ? this.store.get(key) : null; },
      setItem(key, value) { this.store.set(key, String(value)); },
      removeItem(key) { this.store.delete(key); },
    },
    matchMedia: () => ({ matches: false, addListener() {}, removeListener() {} }),
    location: { href: 'https://wolimons.test/', origin: 'https://wolimons.test', search: '' },
    addEventListener() {},
    setTimeout,
    clearTimeout,
    setInterval,
    clearInterval,
    fetch: () => Promise.reject(new Error('no network in tests')),
    ...extraGlobals,
  };
  windowStub.window = windowStub;

  const context = vm.createContext({
    ...windowStub,
    console,
    Date,
    Math,
    JSON,
    Number,
    String,
    Boolean,
    Array,
    Object,
    Set,
    Map,
    Promise,
    RegExp,
    Error,
    isNaN,
    isFinite,
    parseInt,
    parseFloat,
    encodeURIComponent,
    decodeURIComponent,
    URLSearchParams,
  });

  /* A browser script assigns to `window.X`, and callers then read the global
   * `X` - so in here the two have to be the same object, exactly as they are
   * in a real page. */
  context.window = context;
  context.globalThis = context;

  vm.runInContext(read(relative), context, { filename: relative });
  return context;
}

/*
 * Pull one `const NAME = {...};` or `const NAME = value;` out of a source file
 * and evaluate just that.
 *
 * Used for tables that live inside an IIFE and are not exported - the acronym
 * list, for one. Reading the real declaration means the test cannot drift
 * from the source the way a copied-out duplicate would.
 */
function extractDeclaration(relative, name) {
  const source = read(relative);
  const start = source.indexOf(`const ${name} = `);
  if (start === -1) throw new Error(`${name} not found in ${relative}`);

  /* Walk to the matching close brace so nested braces are handled. */
  const open = source.indexOf('{', start);
  if (open === -1) throw new Error(`${name} in ${relative} is not an object`);
  let depth = 0;
  let end = -1;
  for (let at = open; at < source.length; at += 1) {
    if (source[at] === '{') depth += 1;
    else if (source[at] === '}') {
      depth -= 1;
      if (depth === 0) { end = at + 1; break; }
    }
  }
  if (end === -1) throw new Error(`${name} in ${relative} is unterminated`);
  // eslint-disable-next-line no-new-func
  return new Function(`return ${source.slice(open, end)};`)();
}

/* Every page on the site, as [name, html] pairs. */
function sitePages() {
  const entries = fs.readdirSync(ROOT, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && fs.existsSync(path.join(ROOT, entry.name, 'index.html')))
    .map(entry => `${entry.name}/index.html`);
  return ['index.html', ...entries].map(name => [name, read(name)]);
}

/* Ids declared in a page, so a test can spot a duplicate without a parser. */
function idsIn(html) {
  return [...html.matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
}

module.exports = { ROOT, read, loadBrowserScript, extractDeclaration, sitePages, idsIn };
