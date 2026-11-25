// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import { listDays, normalizeDateRange, parseBudgetInput } from './format';

describe('listDays', () => {
  test('is inclusive across a month boundary', () => {
    const days = listDays('2026-12-22', '2027-01-08');
    expect(days).toHaveLength(18);
    expect(days[0]).toBe('2026-12-22');
    expect(days[days.length - 1]).toBe('2027-01-08');
  });

  test('returns one day for a single-day trip', () => {
    expect(listDays('2026-11-12', '2026-11-12')).toEqual(['2026-11-12']);
  });

  test('returns no days when the end is before the start', () => {
    expect(listDays('2026-11-12', '2026-11-01')).toEqual([]);
  });
});

describe('normalizeDateRange', () => {
  test('clamps an end before the start to the start', () => {
    expect(normalizeDateRange('2026-11-12', '2026-11-01')).toEqual({
      start: '2026-11-12',
      end: '2026-11-12',
    });
  });

  test('keeps a valid range', () => {
    expect(normalizeDateRange('2026-12-22', '2027-01-08')).toEqual({
      start: '2026-12-22',
      end: '2027-01-08',
    });
  });

  test('fills an empty end with the start', () => {
    expect(normalizeDateRange('2026-12-22', '')).toEqual({
      start: '2026-12-22',
      end: '2026-12-22',
    });
  });
});

describe('parseBudgetInput', () => {
  test('treats an empty field as zero', () => {
    expect(parseBudgetInput('')).toBe(0);
    expect(parseBudgetInput('   ')).toBe(0);
  });

  test('parses a normal amount and a leading zero', () => {
    expect(parseBudgetInput('2500')).toBe(2500);
    expect(parseBudgetInput('02500')).toBe(2500);
  });

  test('rejects negative and non-numeric values', () => {
    expect(parseBudgetInput('-5')).toBe(0);
    expect(parseBudgetInput('abc')).toBe(0);
  });
});
