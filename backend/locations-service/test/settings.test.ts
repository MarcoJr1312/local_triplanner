// Settings store tests. The HasData key must stay out of public responses.

import { afterEach, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, statSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { LocationsSettingsStore, LocationsSettingsValidationError } from '../src/settings.ts';

const dirs: string[] = [];

function makeStore(defaults = { provider: 'preloaded' as const, apiKey: '' }) {
  const dir = mkdtempSync(path.join(tmpdir(), 'triplanner-locations-settings-'));
  dirs.push(dir);
  return {
    dir,
    file: path.join(dir, 'locations.json'),
    store: new LocationsSettingsStore({ filePath: path.join(dir, 'locations.json'), defaults }),
  };
}

afterEach(() => {
  for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('locations settings store', () => {
  test('defaults to the preloaded catalogue without a key', () => {
    const { store } = makeStore();
    assert.deepEqual(store.public(), { provider: 'preloaded', hasKey: false, ready: true });
  });

  test('persists a HasData key with restrictive permissions and never exposes it', () => {
    const { store, file } = makeStore();
    const saved = store.update({ provider: 'hasdata', apiKey: 'hd_secret_value' });

    assert.deepEqual(saved, { provider: 'hasdata', hasKey: true, ready: true });
    assert.equal(JSON.stringify(saved).includes('hd_secret_value'), false);
    assert.match(readFileSync(file, 'utf8'), /"api_key": "hd_secret_value"/);

    if (process.platform !== 'win32') {
      assert.equal(statSync(file).mode & 0o777, 0o600);
    }
  });

  test('keeps the saved key when updating HasData without a new key', () => {
    const { store } = makeStore();
    store.update({ provider: 'hasdata', apiKey: 'hd_secret_value' });
    const saved = store.update({ provider: 'hasdata' });
    assert.equal(saved.hasKey, true);
    assert.equal(store.get().apiKey, 'hd_secret_value');
  });

  test('switching to preloaded clears the key and disables HasData', () => {
    const { store, file } = makeStore();
    store.update({ provider: 'hasdata', apiKey: 'hd_secret_value' });
    const saved = store.update({ provider: 'preloaded', clearKey: true });

    assert.deepEqual(saved, { provider: 'preloaded', hasKey: false, ready: true });
    assert.equal(store.get().apiKey, '');
    assert.match(readFileSync(file, 'utf8'), /"api_key": ""/);
  });

  test('requires a key for provider=hasdata', () => {
    const { store } = makeStore();
    assert.throws(
      () => store.update({ provider: 'hasdata' }),
      LocationsSettingsValidationError,
    );
  });

  test('loads a persisted override and ignores invalid files', () => {
    const { dir, file } = makeStore();
    writeFileSync(
      file,
      JSON.stringify({ provider: 'hasdata', api_key: 'hd_from_file' }),
      { mode: 0o600 },
    );
    const loaded = new LocationsSettingsStore({
      filePath: file,
      defaults: { provider: 'preloaded', apiKey: '' },
    });
    assert.deepEqual(loaded.public(), { provider: 'hasdata', hasKey: true, ready: true });

    writeFileSync(path.join(dir, 'locations.json'), JSON.stringify({ provider: 'hasdata' }));
    const invalid = new LocationsSettingsStore({
      filePath: file,
      defaults: { provider: 'preloaded', apiKey: '' },
    });
    assert.deepEqual(invalid.public(), { provider: 'preloaded', hasKey: false, ready: true });
  });
});
