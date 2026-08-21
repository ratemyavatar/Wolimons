/*
 * Badges and acronyms.
 *
 * Both are things people notice immediately when they are wrong, and both
 * have been wrong before: the Verified badge showed only to the person who
 * earned it, the Lucky Cat badge could not be won at all, and the acronyms
 * were derived initials that read as nonsense.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const { loadBrowserScript, extractDeclaration, read } = require('./helpers.js');

const BADGES = loadBrowserScript('assets/js/badges.js').WolimonsBadges;
const ROLE_ICONS = loadBrowserScript('assets/js/role-icons.js').WolimonsRoleIcons;
const ACRONYMS = extractDeclaration('assets/js/item.js', 'ACRONYMS');

const inventory = { items: [{ id: 1, name: 'Hat', value: 10, rap: 10, copies: 1, serials: [] }] };
const has = (result, id) => result.some(badge => badge.id === id);

/* ---------------------------------------------------------------- */
/* Verified                                                          */
/* ---------------------------------------------------------------- */

test('the Verified badge follows site verification, not Wanwood\'s flag', () => {
  assert.ok(has(BADGES.evaluate({ ...inventory, siteVerified: true }), 'verified'));
  assert.ok(!has(BADGES.evaluate({ ...inventory, siteVerified: false }), 'verified'));

  /* Wanwood's own isVerified is the rare checkmark, a different badge. */
  assert.ok(!has(BADGES.evaluate({ ...inventory, verified: true, siteVerified: false }), 'verified'));
});

test('the rare checkmark is never handed out automatically', () => {
  const everything = BADGES.evaluate({ ...inventory, verified: true, siteVerified: true });
  assert.ok(!has(everything, 'verified-checkmark'));
});

test('verification is recorded on the server, not just in one browser', () => {
  /* The bug was that it lived in localStorage, so nobody else could see it. */
  assert.match(read('proxy/api.js'), /store\.setVerified\(userId/);
  assert.match(read('proxy/api.js'), /route === '\/api\/verified'/);
  assert.match(read('assets/js/player.js'), /loadSiteVerified/);
});

/* ---------------------------------------------------------------- */
/* Lucky Cat                                                         */
/* ---------------------------------------------------------------- */

test('the Lucky Cat badge is grantable and off by default', () => {
  assert.ok(!has(BADGES.evaluate(inventory), 'lucky-cat'));
  assert.ok(has(BADGES.evaluate({ ...inventory, granted: ['lucky-cat'] }), 'lucky-cat'));
});

test('the draw is made once on the server so everyone sees the same winner', () => {
  assert.match(read('proxy/api.js'), /async function luckyDraw/);
  assert.match(read('proxy/api.js'), /route === '\/api\/luckycat'/);
  /* And the profile awards it from that shared answer. */
  assert.match(read('assets/js/player.js'), /state\.luckyCat \? \['lucky-cat'\] : \[\]/);
});

/* ---------------------------------------------------------------- */
/* Ranks                                                             */
/* ---------------------------------------------------------------- */

test('all four ranks have their own icon and colour', () => {
  const roles = Object.keys(ROLE_ICONS.ROLES);
  assert.deepStrictEqual(roles, ['website_owner', 'owner', 'value_manager', 'staff']);

  const colours = roles.map(role => ROLE_ICONS.ROLES[role].color);
  assert.strictEqual(new Set(colours).size, 4, 'two ranks share a colour');

  const shapes = roles.map(role => ROLE_ICONS.ROLES[role].path);
  assert.strictEqual(new Set(shapes).size, 4, 'two ranks share an icon');
});

test('the website owner label reads as words, not an id', () => {
  assert.strictEqual(ROLE_ICONS.label('website_owner'), 'Website Owner');
  assert.strictEqual(ROLE_ICONS.label('owner'), 'Site Owner');
});

/* ---------------------------------------------------------------- */
/* Acronyms                                                          */
/* ---------------------------------------------------------------- */

/* The list as it was given, initials -> nickname. */
const EXPECTED = {
  BHFBSP: 'Space hair',
  TBB: 'Bbh',
  BIBOUP: 'Bib',
  PI: 'Indy',
  P: 'Prank',
  RSTH: 'Rbad',
  TVS: 'Void',
  TCRF: 'Cf',
  U: 'Umad',
  SFC: 'Supa',
  FTVKC: 'Kawaii',
  PLBH: 'Legit',
  DP: 'Prae',
  FHOTN: 'Fiery',
  RBOSI: 'Sql',
  SDFC: 'Dupa',
  EL: 'Euro',
  DROTU: 'Deth',
  SGBES: 'Gamma',
  TDVOX: 'Xmax',
  TTOED: 'Epic duck',
  VH: 'Valk',
  C: 'Cth',
};

test('the acronym list is exactly the one that was asked for', () => {
  assert.deepStrictEqual(ACRONYMS, EXPECTED);
});

test('acronyms are written with one capital, not shouted', () => {
  Object.values(ACRONYMS).forEach(word => {
    const tidy = word.charAt(0).toUpperCase() + word.slice(1).toLowerCase();
    assert.strictEqual(word, tidy, `${word} is not capitalised the way the rest are`);
  });
});

test('nothing outside the list gets an acronym', () => {
  /* Derived initials are gone - an item not on the list shows nothing. */
  assert.ok(!Object.prototype.hasOwnProperty.call(ACRONYMS, 'HEADROW'));
  assert.ok(!Object.prototype.hasOwnProperty.call(ACRONYMS, '+'));
  assert.match(read('assets/js/item.js'), /ACRONYMS\[deriveAcronym\(value\)\] \|\| ''/);
});
