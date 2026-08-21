/*
 * Wolimons - the nicknames traders use for items.
 *
 * One list, shared by the modern item page and the 2018 one, so an acronym
 * can never be right on one version of the site and wrong on the other.
 *
 * The list is keyed by an item's initials rather than by its full name: that
 * is how the names are actually formed - "Beautiful Hair for Beautiful
 * Space People" gives BHFBSP - and it means a rename that keeps the same
 * initials keeps its nickname. An item that is not listed simply shows none;
 * nothing here is guessed from the name.
 */
(() => {
  'use strict';

  const TABLE = {
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

  /* The initials of a name: bracketed asides are dropped, and an apostrophe
   * inside a word does not start a new one. */
  const derive = value => String(value || '')
    .replace(/\([^)]*\)/g, ' ')
    .split(/[^A-Za-z0-9']+/)
    .map(word => word.replace(/^'+|'+$/g, '').charAt(0))
    .filter(Boolean)
    .join('')
    .toUpperCase();

  window.WolimonsAcronyms = {
    TABLE,
    derive,
    /* The nickname for an item, or an empty string. */
    for: value => TABLE[derive(value)] || '',
  };
})();
