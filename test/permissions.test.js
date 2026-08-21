/*
 * Permissions.
 *
 * Every rank against every capability, asserted one cell at a time. This is
 * the table the panel locks itself with and the server refuses writes with,
 * so a change here is a change to who can do what on the site - it should
 * never happen by accident.
 */
'use strict';

const test = require('node:test');
const assert = require('node:assert');

const api = require('../proxy/api.js');
const store = require('../proxy/store.js');

/* rank -> what that rank may do. Written out in full on purpose: a loop
 * derived from the same rule the code uses would agree with a bug. */
const TABLE = {
  website_owner: {
    rank: 4,
    canSetValues: true,
    canModerate: true,
    canViewUsers: true,
    canGrantRoles: true,
    canGrantBadges: true,
    canAnnounce: true,
    canViewServer: true,
  },
  owner: {
    rank: 3,
    canSetValues: true,
    canModerate: true,
    canViewUsers: true,
    canGrantRoles: true,
    canGrantBadges: true,
    canAnnounce: true,
    canViewServer: false,
  },
  value_manager: {
    rank: 2,
    canSetValues: true,
    canModerate: true,
    canViewUsers: true,
    canGrantRoles: false,
    canGrantBadges: false,
    canAnnounce: false,
    canViewServer: false,
  },
  staff: {
    rank: 1,
    canSetValues: true,
    canModerate: true,
    canViewUsers: true,
    canGrantRoles: false,
    canGrantBadges: false,
    canAnnounce: false,
    canViewServer: false,
  },
};

test('every rank has exactly the permissions it should', () => {
  for (const [role, expected] of Object.entries(TABLE)) {
    const actual = api.capabilities(role);
    for (const [flag, value] of Object.entries(expected)) {
      assert.strictEqual(actual[flag], value, `${role}.${flag} should be ${value}`);
    }
  }
});

test('somebody with no rank can do nothing at all', () => {
  const nobody = api.capabilities(null);
  assert.strictEqual(nobody.rank, 0);
  Object.keys(TABLE.website_owner)
    .filter(flag => flag !== 'rank')
    .forEach(flag => assert.strictEqual(nobody[flag], false, `a stranger must not have ${flag}`));
});

test('an unknown role name is treated as no rank, not as staff', () => {
  const bogus = api.capabilities('administrator');
  assert.strictEqual(bogus.rank, 0);
  assert.strictEqual(bogus.canSetValues, false);
});

test('the value team really can set values', () => {
  /* This is the whole point of the rank, and it has been broken before. */
  assert.strictEqual(api.capabilities('staff').canSetValues, true);
  assert.strictEqual(api.capabilities('value_manager').canSetValues, true);
});

test('only the website owner sees the server page', () => {
  const allowed = Object.keys(TABLE).filter(role => api.capabilities(role).canViewServer);
  assert.deepStrictEqual(allowed, ['website_owner']);
});

test('ranks are ordered highest first and agree with the store', () => {
  assert.deepStrictEqual(store.ROLES, ['website_owner', 'owner', 'value_manager', 'staff']);
  assert.strictEqual(store.RANK.website_owner, 4);
  assert.ok(store.RANK.website_owner > store.RANK.owner);
  assert.ok(store.RANK.owner > store.RANK.value_manager);
  assert.ok(store.RANK.value_manager > store.RANK.staff);

  /* The server's own ladder must match the store's, or a rank would mean two
   * different things depending on which file was asked. */
  store.ROLES.forEach(role => {
    assert.strictEqual(api.ROLE_RANK[role], store.RANK[role], `${role} ranks disagree`);
  });
});

test('Nun is the only website owner in the shipped roster', () => {
  const seed = require('../data/wolimons-data.json');
  const owners = Object.values(seed.roles).filter(row => row.role === 'website_owner');
  assert.strictEqual(owners.length, 1);
  assert.strictEqual(owners[0].name, 'Nun');
});

test('every seeded role is a real rank', () => {
  const seed = require('../data/wolimons-data.json');
  Object.values(seed.roles).forEach(row => {
    assert.ok(store.ROLES.includes(row.role), `${row.name} has unknown rank ${row.role}`);
  });
});
