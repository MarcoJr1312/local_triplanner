// Demo identity helpers. Accounts live in the users service; the API only
// resolves the x-user-id header and maps profiles to GraphQL.

import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEMO_USER_ID,
  getCurrentUserId,
  toProfile,
} from '../src/pg/auth.ts';

describe('demo auth on Postgres', () => {
  test('request without headers falls back to the demo UUID', () => {
    assert.equal(getCurrentUserId(undefined), DEMO_USER_ID);
    assert.equal(getCurrentUserId({ headers: new Headers() }), DEMO_USER_ID);
    assert.equal(getCurrentUserId({ headers: {} }), DEMO_USER_ID);
  });

  test('x-user-id wins over the demo default', () => {
    assert.equal(getCurrentUserId({ headers: { 'x-user-id': '  u-42  ' } }), 'u-42');
    assert.equal(
      getCurrentUserId(new Request('http://local', { headers: { 'x-user-id': 'u-7' } })),
      'u-7',
    );
  });

  test('toProfile maps the row to the GraphQL shape', () => {
    const profile = toProfile({
      id: 'u1',
      username: 'demo',
      email: 'a@b.c',
      display_name: 'Ana',
      color: null,
      avatar_url: 'http://img',
      language: 'en',
    });
    assert.deepEqual(profile, {
      userId: 'u1',
      username: 'demo',
      email: 'a@b.c',
      displayName: 'Ana',
      color: null,
      avatarUrl: 'http://img',
      language: 'en',
      deletedAt: null,
    });
  });
});
