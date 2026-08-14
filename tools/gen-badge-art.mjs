/*
 * Regenerates assets/js/badge-art.js from badges/index.html.
 *
 *   node tools/gen-badge-art.mjs
 *
 * badges/index.html is the canonical badge catalog: it owns the artwork and
 * the wording of every badge. The player profile needs the same artwork for
 * the badge row, and duplicating 48 hand-tuned SVGs by hand would guarantee
 * drift, so the art is lifted straight out of the page into a module both
 * pages can share. Definitions and earn rules live in assets/js/badges.js;
 * only the drawings are generated here.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* The catalog markup is machine-generated and uniform, so one pattern covers
 * every card: tier class, artwork, title, description. */
const CARD = /<div class="badge_inner_container border_top_(\w+)"><div class="d-flex"><div><span class="roli_badge">(.*?)<\/span><\/div><div class="badge_title_container"><div class="badge_title">(.*?)<\/div><\/div><\/div>/gs;

export function slug(name) {
  return name
    .toLowerCase()
    .replace(/\+/g, '-plus')
    .replace(/#/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/* Exported so tools/check-badges.mjs reads the catalog exactly the same way. */
export function parseCatalog() {
  const page = readFileSync(join(root, 'badges/index.html'), 'utf8');
  const entries = [];
  const seen = new Set();
  for (const [, tier, art, title] of page.matchAll(CARD)) {
    const name = title.trim();
    const id = slug(name);
    if (seen.has(id)) throw new Error(`Duplicate badge id: ${id}`);
    seen.add(id);
    entries.push({ id, name, tier, art: art.trim() });
  }
  if (entries.length !== 48) {
    throw new Error(`Expected 48 badges in badges/index.html, found ${entries.length}`);
  }
  return entries;
}

/* Importing this module must not rewrite anything - only running it does. */
if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  generate();
}

function generate() {
const entries = parseCatalog();

const body = entries
  .map(entry => `  /* ${entry.name} (${entry.tier}) */\n  ${JSON.stringify(entry.id)}: ${JSON.stringify(entry.art)},`)
  .join('\n\n');

const out = `/*
 * Wolimons badge artwork - GENERATED FILE, DO NOT EDIT BY HAND.
 *
 * Source:    badges/index.html
 * Regenerate: node tools/gen-badge-art.mjs
 *
 * Maps badge id -> the markup inside <span class="roli_badge"> on the badge
 * catalog page, so the profile badge row draws exactly the same icons.
 */

window.WolimonsBadgeArt = {
${body}
};
`;

writeFileSync(join(root, 'assets/js/badge-art.js'), out);
console.log(`Wrote assets/js/badge-art.js (${entries.length} badges, ${out.length} bytes)`);
for (const entry of entries) console.log(`  ${entry.id}`);
}
