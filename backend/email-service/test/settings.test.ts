import { describe, test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import type { Logger } from '../src/logger.ts';
import { EmailSettingsStore, EmailSettingsValidationError } from '../src/settings.ts';

function silentLogger(): Logger {
  const logger: Logger = {
    debug: () => {},
    info: () => {},
    warn: () => {},
    error: () => {},
    child: () => logger,
  };
  return logger;
}

function tempFile(): { dir: string; file: string; cleanup: () => void } {
  const dir = mkdtempSync(path.join(tmpdir(), 'triplanner-email-settings-'));
  return {
    dir,
    file: path.join(dir, 'email.json'),
    cleanup: () => rmSync(dir, { recursive: true, force: true }),
  };
}

const defaults = {
  provider: 'sink' as const,
  apiKey: '',
  from: 'Triplanner <onboarding@resend.dev>',
  replyTo: '',
};

describe('EmailSettingsStore', () => {
  test('uses env defaults when no override exists', () => {
    const tmp = tempFile();
    try {
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults, logger: silentLogger() });
      assert.deepEqual(store.public(), {
        provider: 'sink',
        from: defaults.from,
        replyTo: '',
        hasKey: false,
        ready: true,
      });
    } finally {
      tmp.cleanup();
    }
  });

  test('persists a Resend key with 0600 permissions and reloads it', () => {
    const tmp = tempFile();
    try {
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults, logger: silentLogger() });
      const saved = store.update({
        provider: 'resend',
        apiKey: 're_secret',
        from: 'Triplanner <viajes@example.com>',
        replyTo: 'support@example.com',
      });
      assert.equal(saved.provider, 'resend');
      assert.equal(saved.hasKey, true);
      assert.equal(saved.ready, true);

      const raw = JSON.parse(readFileSync(tmp.file, 'utf8')) as Record<string, unknown>;
      assert.equal(raw.provider, 'resend');
      assert.equal(raw.api_key, 're_secret');
      if (process.platform !== 'win32') {
        assert.equal(statSync(tmp.file).mode & 0o777, 0o600);
      }

      const reloaded = new EmailSettingsStore({ filePath: tmp.file, defaults, logger: silentLogger() });
      assert.equal(reloaded.get().provider, 'resend');
      assert.equal(reloaded.get().apiKey, 're_secret');
      assert.equal(reloaded.public().hasKey, true);
    } finally {
      tmp.cleanup();
    }
  });

  test('keeps the saved key when the key field is blank', () => {
    const tmp = tempFile();
    try {
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults, logger: silentLogger() });
      store.update({ provider: 'resend', apiKey: 're_first', from: 'Triplanner <a@example.com>' });
      const saved = store.update({ provider: 'resend', apiKey: '', from: 'Triplanner <b@example.com>' });
      assert.equal(saved.hasKey, true);
      assert.equal(store.get().apiKey, 're_first');
      assert.equal(store.get().from, 'Triplanner <b@example.com>');
    } finally {
      tmp.cleanup();
    }
  });

  test('does not copy an env key to disk when it is kept', () => {
    const tmp = tempFile();
    try {
      const envDefaults = { ...defaults, provider: 'resend' as const, apiKey: 're_env' };
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults: envDefaults, logger: silentLogger() });
      const saved = store.update({ provider: 'resend', apiKey: '', from: 'Triplanner <env@example.com>' });
      assert.equal(saved.hasKey, true);
      const raw = JSON.parse(readFileSync(tmp.file, 'utf8')) as Record<string, unknown>;
      assert.equal('api_key' in raw, false);
      assert.equal(store.get().apiKey, 're_env');
    } finally {
      tmp.cleanup();
    }
  });

  test('clearing the key while using Resend is rejected', () => {
    const tmp = tempFile();
    try {
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults, logger: silentLogger() });
      store.update({ provider: 'resend', apiKey: 're_secret', from: defaults.from });
      assert.throws(
        () => store.update({ provider: 'resend', clearKey: true }),
        EmailSettingsValidationError,
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('clearing the key with sink shadows an env key', () => {
    const tmp = tempFile();
    try {
      const envDefaults = { ...defaults, provider: 'resend' as const, apiKey: 're_env' };
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults: envDefaults, logger: silentLogger() });
      const saved = store.update({ provider: 'sink', clearKey: true });
      assert.equal(saved.provider, 'sink');
      assert.equal(saved.hasKey, false);
      assert.equal(store.get().apiKey, '');

      const reloaded = new EmailSettingsStore({ filePath: tmp.file, defaults: envDefaults, logger: silentLogger() });
      assert.equal(reloaded.get().provider, 'sink');
      assert.equal(reloaded.get().apiKey, '');
    } finally {
      tmp.cleanup();
    }
  });

  test('rejects an invalid provider and Resend without a key', () => {
    const tmp = tempFile();
    try {
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults, logger: silentLogger() });
      assert.throws(() => store.update({ provider: 'smtp' }), EmailSettingsValidationError);
      assert.throws(
        () => store.update({ provider: 'resend', from: defaults.from }),
        EmailSettingsValidationError,
      );
    } finally {
      tmp.cleanup();
    }
  });

  test('falls back to env when the file is corrupt', () => {
    const tmp = tempFile();
    try {
      writeFileSync(tmp.file, '{not json', 'utf8');
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults, logger: silentLogger() });
      assert.equal(store.get().provider, 'sink');
      assert.equal(store.public().ready, true);
    } finally {
      tmp.cleanup();
    }
  });

  test('ignores an invalid Resend override without a key', () => {
    const tmp = tempFile();
    try {
      writeFileSync(
        tmp.file,
        JSON.stringify({ provider: 'resend', api_key: '', from: defaults.from }),
        'utf8',
      );
      const store = new EmailSettingsStore({ filePath: tmp.file, defaults, logger: silentLogger() });
      assert.equal(store.get().provider, 'sink');
    } finally {
      tmp.cleanup();
    }
  });
});
