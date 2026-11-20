import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { buildJoinUrl } from '../src/invite-links.ts';
import { APP_URL } from '../src/env.ts';

describe('buildJoinUrl', () => {
  test('builds the copyable link without auto-accept', () => {
    const base = APP_URL.replace(/\/+$/, '');
    assert.equal(buildJoinUrl('trip-1', 'abcDEF123_-x'), `${base}/join?trip=trip-1&code=abcDEF123_-x`);
  });

  test('adds auto=1 for the email link', () => {
    const url = buildJoinUrl('trip-1', 'abcDEF123_-x', { autoAccept: true });
    assert.match(url, /[?&]auto=1/);
    assert.match(url, /code=abcDEF123_-x/);
  });
});
