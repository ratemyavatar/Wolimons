/*
 * Verifies that the three badge files still agree with each other.
 *
 *   node tools/check-badges.mjs
 *
 * badges/index.html is the source of truth for what a badge is called and how
 * rare it is. assets/js/badges.js restates that as data plus the rule that
 * earns it, and assets/js/badge-art.js carries the drawings. Nothing enforces
 * that at runtime - a badge renamed on the catalog page would just quietly
 * stop appearing on profiles - so this check does.
 *
 * It fails if any of the following drift:
 *   - the set of badge ids
 *   - a badge's printed name
 *   - a badge's tier (which is its border colour and its row ordering)
 *   - a badge with no artwork to draw
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';
import vm from 'node:vm';

import { parseCatalog } from './gen-badge-art.mjs';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');

/* --- the catalog page ------------------------------------------------ */

const catalog = parseCatalog();

/* --- the two modules, evaluated as a browser would ------------------- */

const sandbox = { window: {} };
vm.createContext(sandbox);
for (const file of ['assets/js/badge-art.js', 'assets/js/badges.js']) {
  vm.runInContext(readFileSync(join(root, file), 'utf8'), sandbox, { filename: file });
}

const { WolimonsBadges: badges, WolimonsBadgeArt: art } = sandbox.window;

/* --- compare --------------------------------------------------------- */

const problems = [];

if (catalog.length !== 48) {
  problems.push(`badges/index.html has ${catalog.length} badges, expected 48`);
}

const defined = new Map(badges.LIST.map(badge => [badge.id, badge]));

catalog.forEach(entry => {
  const badge = defined.get(entry.id);
  if (!badge) {
    problems.push(`"${entry.name}" is on /badges but missing from assets/js/badges.js`);
    return;
  }
  if (badge.name !== entry.name) {
    problems.push(`${entry.id}: named "${badge.name}" in badges.js, "${entry.name}" on /badges`);
  }
  if (badge.tier !== entry.tier) {
    problems.push(`${entry.id}: tier "${badge.tier}" in badges.js, "${entry.tier}" on /badges`);
  }
  if (!art[entry.id]) {
    problems.push(`${entry.id}: no artwork - rerun node tools/gen-badge-art.mjs`);
  }
});

const known = new Set(catalog.map(entry => entry.id));
badges.LIST.forEach(badge => {
  if (!known.has(badge.id)) {
    problems.push(`${badge.id} is defined in badges.js but is not on /badges`);
  }
  if (!badges.TIERS[badge.tier]) {
    problems.push(`${badge.id}: unknown tier "${badge.tier}"`);
  }
});

if (problems.length) {
  console.error('Badge definitions are out of sync:\n');
  problems.forEach(problem => console.error(`  - ${problem}`));
  process.exit(1);
}

const automatic = badges.LIST.filter(badge => typeof badge.earn === 'function').length;
console.log(`OK - ${catalog.length} badges agree across badges/index.html, badges.js and badge-art.js`);
console.log(`     ${automatic} awarded automatically, ${catalog.length - automatic} awarded off-site`);
