// BYOK runtime settings for the locations service.
//
// Precedence: runtime override (PVC) > environment defaults. The HasData key is
// never returned by the public accessor and never logged. The pattern mirrors
// the email-service Resend settings store.

import { chmodSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';

export type LocationsProvider = 'preloaded' | 'hasdata';

export interface LocationsSettingsDefaults {
  provider: LocationsProvider;
  apiKey: string;
}

export interface LocationsRuntimeSettings {
  provider: LocationsProvider;
  apiKey: string;
}

export interface PublicLocationsSettings {
  provider: LocationsProvider;
  hasKey: boolean;
  ready: boolean;
}

export interface UpdateLocationsSettingsInput {
  provider: string;
  apiKey?: string | null;
  clearKey?: boolean | null;
}

export interface LocationsSettingsProvider {
  get(): LocationsRuntimeSettings;
  public(): PublicLocationsSettings;
  update(input: UpdateLocationsSettingsInput): PublicLocationsSettings;
}

interface SettingsFile {
  provider?: LocationsProvider;
  api_key?: string;
}

export class LocationsSettingsValidationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'LocationsSettingsValidationError';
  }
}

export interface LocationsSettingsStoreOptions {
  filePath: string;
  defaults: LocationsSettingsDefaults;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseProvider(value: unknown): LocationsProvider {
  if (typeof value !== 'string') throw new LocationsSettingsValidationError('provider must be a string');
  const provider = value.trim().toLowerCase();
  if (provider !== 'preloaded' && provider !== 'hasdata') {
    throw new LocationsSettingsValidationError('provider must be preloaded or hasdata');
  }
  return provider;
}

function parseFile(raw: unknown): SettingsFile {
  if (!isRecord(raw)) throw new LocationsSettingsValidationError('settings file must be an object');
  const result: SettingsFile = {};
  if ('provider' in raw) result.provider = parseProvider(raw.provider);
  if ('api_key' in raw) {
    if (typeof raw.api_key !== 'string') throw new LocationsSettingsValidationError('api_key must be a string');
    result.api_key = raw.api_key;
  }
  return result;
}

export class LocationsSettingsStore implements LocationsSettingsProvider {
  private readonly filePath: string;
  private readonly defaults: LocationsSettingsDefaults;
  private override: SettingsFile = {};

  constructor({ filePath, defaults }: LocationsSettingsStoreOptions) {
    this.filePath = path.resolve(filePath);
    this.defaults = {
      provider: defaults.provider,
      apiKey: defaults.apiKey.trim(),
    };
    this.load();
  }

  get(): LocationsRuntimeSettings {
    const provider = this.override.provider ?? this.defaults.provider;
    const apiKey =
      this.override.api_key !== undefined ? this.override.api_key.trim() : this.defaults.apiKey;
    return { provider, apiKey };
  }

  public(): PublicLocationsSettings {
    const settings = this.get();
    return {
      provider: settings.provider,
      hasKey: settings.apiKey.length > 0,
      ready: settings.provider === 'preloaded' || settings.apiKey.length > 0,
    };
  }

  update(input: UpdateLocationsSettingsInput): PublicLocationsSettings {
    const provider = parseProvider(input.provider);
    if (input.apiKey !== undefined && input.apiKey !== null && typeof input.apiKey !== 'string') {
      throw new LocationsSettingsValidationError('apiKey must be a string');
    }
    if (input.clearKey !== undefined && input.clearKey !== null && typeof input.clearKey !== 'boolean') {
      throw new LocationsSettingsValidationError('clearKey must be a boolean');
    }

    const current = this.get();
    const providedKey = (input.apiKey ?? '').trim();
    const clearKey = Boolean(input.clearKey);

    if (provider === 'hasdata' && clearKey) {
      throw new LocationsSettingsValidationError('clearKey cannot be used with provider=hasdata');
    }

    let persistKey: string | undefined;
    let effectiveKey: string;
    if (provider === 'preloaded') {
      // Selecting the committed catalogue disables HasData, including an env key.
      effectiveKey = '';
      persistKey = '';
    } else if (providedKey) {
      effectiveKey = providedKey;
      persistKey = providedKey;
    } else {
      effectiveKey = current.apiKey;
      // Do not copy an env-provided key to disk; keep a previously persisted key.
      persistKey = this.override.api_key;
    }

    if (provider === 'hasdata' && !effectiveKey) {
      throw new LocationsSettingsValidationError('API key required for provider=hasdata');
    }

    const next: SettingsFile = { provider, api_key: persistKey };
    this.write(next);
    this.override = next;
    console.info('[locations] settings updated', {
      provider,
      hasKey: effectiveKey.length > 0,
    });
    return this.public();
  }

  private load(): void {
    let raw: string;
    try {
      raw = readFileSync(this.filePath, 'utf8');
    } catch {
      return;
    }

    try {
      const parsed = parseFile(JSON.parse(raw));
      const provider = parsed.provider ?? this.defaults.provider;
      const apiKey = parsed.api_key !== undefined ? parsed.api_key.trim() : this.defaults.apiKey;
      if (provider === 'hasdata' && !apiKey) {
        throw new LocationsSettingsValidationError('override provider=hasdata without a key');
      }
      this.override = parsed;
      console.info('[locations] settings loaded', {
        provider,
        hasKey: apiKey.length > 0,
        source: 'runtime',
      });
    } catch (error) {
      this.override = {};
      console.warn('[locations] invalid settings file', {
        reason: error instanceof Error ? error.message : 'invalid settings file',
      });
    }
  }

  private write(next: SettingsFile): void {
    const directory = path.dirname(this.filePath);
    const tempPath = path.join(directory, `.locations-${process.pid}-${Date.now()}.tmp`);

    try {
      mkdirSync(directory, { recursive: true, mode: 0o700 });
      try {
        chmodSync(directory, 0o700);
      } catch {
        // A Kubernetes PVC may be group-owned by fsGroup; 0700 can fail even
        // when the file itself is writable.
      }
      writeFileSync(tempPath, `${JSON.stringify(next, null, 2)}\n`, { mode: 0o600 });
      chmodSync(tempPath, 0o600);
      renameSync(tempPath, this.filePath);
      chmodSync(this.filePath, 0o600);
    } catch (error) {
      try {
        unlinkSync(tempPath);
      } catch {
        // temp file may not exist
      }
      throw new Error(
        `could not persist locations settings: ${error instanceof Error ? error.message : 'unknown error'}`,
      );
    }
  }
}
