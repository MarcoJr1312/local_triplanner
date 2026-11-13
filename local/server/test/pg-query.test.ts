import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { rewriteQuery } from '../src/pg/query.ts';

describe('rewriteQuery', () => {
  test('numbers positional placeholders', () => {
    assert.deepEqual(rewriteQuery('SELECT * FROM t WHERE a = ? AND b = ?', [1, 'x']), {
      text: 'SELECT * FROM t WHERE a = $1 AND b = $2',
      values: [1, 'x'],
    });
  });

  test('leaves a query without params untouched', () => {
    assert.deepEqual(rewriteQuery('SELECT 1', []), { text: 'SELECT 1', values: [] });
  });

  test('ignores ? inside string literals', () => {
    assert.deepEqual(rewriteQuery("SELECT '?' AS q WHERE id = ?", [7]), {
      text: "SELECT '?' AS q WHERE id = $1",
      values: [7],
    });
  });

  test('ignores ? inside comments', () => {
    assert.deepEqual(rewriteQuery('SELECT 1 -- is this ?\nWHERE id = ?', [3]), {
      text: 'SELECT 1 -- is this ?\nWHERE id = $1',
      values: [3],
    });
  });

  test('rewrites named placeholders', () => {
    assert.deepEqual(rewriteQuery('UPDATE t SET name = :name WHERE id = :id', [{ name: 'Ana', id: 'u1' }]), {
      text: 'UPDATE t SET name = $1 WHERE id = $2',
      values: ['Ana', 'u1'],
    });
  });

  test('reuses the index for a repeated named parameter', () => {
    assert.deepEqual(rewriteQuery('SELECT * FROM t WHERE a = :v OR b = :v', [{ v: 5 }]), {
      text: 'SELECT * FROM t WHERE a = $1 OR b = $1',
      values: [5],
    });
  });

  test('keeps Postgres casts intact', () => {
    assert.deepEqual(rewriteQuery("SELECT now()::timestamptz WHERE id = :id AND note = 'a::b'", [{ id: 'u1' }]), {
      text: "SELECT now()::timestamptz WHERE id = $1 AND note = 'a::b'",
      values: ['u1'],
    });
  });

  test('treats undefined named params as null', () => {
    assert.deepEqual(rewriteQuery('SELECT :missing', [{}]), { text: 'SELECT $1', values: [null] });
  });

  test('skips dollar-quoted blocks', () => {
    assert.deepEqual(rewriteQuery('SELECT $tag$ ? $tag$ WHERE id = ?', [9]), {
      text: 'SELECT $tag$ ? $tag$ WHERE id = $1',
      values: [9],
    });
  });
});
