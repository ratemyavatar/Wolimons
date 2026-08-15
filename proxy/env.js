'use strict';

/*
 * A very small .env reader.
 *
 * The admin password and the GitHub token are secrets, and this repository is
 * public, so neither may ever be written into a file that gets committed.
 * They live in proxy/.env, which .gitignore keeps out of git.
 *
 * Node has no built-in .env support before v20.6, and pulling in `dotenv`
 * would mean the proxy stops being dependency-free, so this reads the file
 * itself. It understands the parts of the format that matter:
 *
 *     # a comment
 *     ADMIN_KEY=secret
 *     QUOTED="value with spaces"     ' single quotes work too '
 *     export ALSO_FINE=1
 *
 * A variable that is already set in the real environment always wins, so
 * `set ADMIN_KEY=... && node server.js` overrides the file rather than being
 * silently ignored.
 */

const fs = require('fs');
const path = require('path');

function parse(text) {
  const out = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const withoutExport = line.startsWith('export ') ? line.slice(7).trim() : line;
    const eq = withoutExport.indexOf('=');
    if (eq <= 0) continue;

    const name = withoutExport.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;

    let value = withoutExport.slice(eq + 1).trim();

    /* Quoted values keep their spaces; unquoted ones drop a trailing
     * comment, which is the usual convention. */
    if ((value.startsWith('"') && value.endsWith('"') && value.length > 1)
      || (value.startsWith("'") && value.endsWith("'") && value.length > 1)) {
      value = value.slice(1, -1);
    } else {
      const hash = value.indexOf(' #');
      if (hash !== -1) value = value.slice(0, hash).trim();
    }

    out[name] = value;
  }
  return out;
}

/*
 * Load proxy/.env into process.env. Returns the names it set, so the server
 * can say where its configuration came from without ever printing a value.
 */
function load(file = path.join(__dirname, '.env')) {
  let text;
  try {
    text = fs.readFileSync(file, 'utf8');
  } catch (error) {
    return [];       /* No .env is perfectly normal - Render uses real env vars. */
  }

  const applied = [];
  for (const [name, value] of Object.entries(parse(text))) {
    if (process.env[name] !== undefined) continue;   /* the real environment wins */
    process.env[name] = value;
    applied.push(name);
  }
  return applied;
}

module.exports = { load, parse };
