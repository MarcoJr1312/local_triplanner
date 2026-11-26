// HasData Google Maps client. Optional runtime provider: the API key is a
// service-wide BYOK setting stored on the locations PVC. Responses are
// normalized to the same LocationRow shape used by the committed catalogue.

import { createHash } from 'node:crypto';
import type { UpsertLocationInput } from './catalogue/types.ts';

export const DEFAULT_HASDATA_API_BASE = 'https://api.hasdata.com/scrape/google-maps';
export const DEFAULT_HASDATA_TTL_MS = 5 * 24 * 60 * 60 * 1000;

export interface HasDataSearchOptions {
  lat?: number | null;
  lng?: number | null;
  limit?: number;
}

export interface HasDataClientOptions {
  apiKey: string | (() => string);
  baseUrl?: string;
  timeoutMs?: number;
  hl?: string;
  gl?: string;
  ttlMs?: number;
  fetchImpl?: (input: string, init?: RequestInit) => Promise<Response>;
}

export class HasDataError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
    this.name = 'HasDataError';
  }
}

type Raw = Record<string, unknown>;

function isRecord(value: unknown): value is Raw {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function pick(obj: Raw | null | undefined, keys: readonly string[]): unknown {
  for (const key of keys) {
    const value = obj?.[key];
    if (value != null && value !== '') return value;
  }
  return undefined;
}

function nested(obj: Raw, path: readonly string[]): unknown {
  let current: unknown = obj;
  for (const key of path) {
    if (!isRecord(current)) return undefined;
    current = current[key];
  }
  return current;
}

function firstString(value: unknown): string | null {
  if (Array.isArray(value)) {
    for (const entry of value) {
      const found = firstString(entry);
      if (found) return found;
    }
    return null;
  }
  if (isRecord(value)) {
    return firstString(value.url ?? value.src ?? value.imageUrl ?? value.photo);
  }
  return typeof value === 'string' && value.trim() !== '' ? value.trim() : null;
}

function toFloat(value: unknown): number | null {
  if (value == null) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function toInt(value: unknown): number | null {
  if (value == null) return null;
  const n = parseInt(String(value), 10);
  return Number.isFinite(n) ? n : null;
}

function toPriceLevel(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return Math.trunc(value);
  if (typeof value === 'string') {
    const dollar = value.trim();
    if (/^\$+$/.test(dollar)) return dollar.length;
    const n = Number(dollar);
    if (Number.isFinite(n)) return Math.trunc(n);
  }
  return null;
}

function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48);
}

function shortHash(value: string): string {
  return createHash('sha1').update(value).digest('hex').slice(0, 8);
}

function categoryFor(raw: Raw): string {
  const type = (firstString(pick(raw, ['type', 'category', 'categoryName', 'types'])) ?? '').toLowerCase();
  if (/night ?club|disco|karaoke|lounge|bar|pub|brewery|nightlife/.test(type)) return 'nightlife';
  if (/restaurant|cafe|coffee|bakery|food|pizza|sushi|burger|deli|steak|seafood|brunch|taco|ramen|noodle|bbq|grill|diner|gastropub|ice cream|dessert/.test(type)) return 'food';
  if (/museum|gallery|landmark|tourist|attraction|zoo|aquarium|monument|church|tower/.test(type)) return 'sight';
  if (/park|trail|hike|hiking|beach|market|garden|theatre|theater|stadium|arena|spa|bowling/.test(type)) return 'activity';
  return 'activity';
}

function extractSearchResults(data: Raw): Raw[] {
  const results: Raw[] = [];
  const append = (value: unknown) => {
    if (Array.isArray(value)) {
      for (const entry of value) if (isRecord(entry)) results.push(entry);
    } else if (isRecord(value)) {
      results.push(value);
    }
  };
  append(data.localResults);
  append(data.placeResults);
  if (results.length === 0) {
    for (const key of ['results', 'data', 'places'] as const) append(data[key]);
  }
  return results;
}

function extractPlace(data: Raw): Raw {
  for (const key of ['place', 'placeResults', 'result', 'data'] as const) {
    const value = data[key];
    if (isRecord(value)) return value;
    if (Array.isArray(value) && isRecord(value[0])) return value[0];
  }
  return data;
}

function normalize(raw: Raw, nowMs: number, ttlMs: number): UpsertLocationInput | null {
  const name = firstString(pick(raw, ['title', 'name']));
  if (!name) return null;

  const placeId = firstString(pick(raw, ['placeId', 'place_id']));
  const dataId = firstString(pick(raw, ['dataId', 'data_id']));
  const lat = toFloat(
    pick(raw, ['latitude', 'lat']) ??
      nested(raw, ['gps_coordinates', 'latitude']) ??
      nested(raw, ['coordinates', 'lat']) ??
      nested(raw, ['location', 'lat']),
  );
  const lng = toFloat(
    pick(raw, ['longitude', 'lng']) ??
      nested(raw, ['gps_coordinates', 'longitude']) ??
      nested(raw, ['coordinates', 'lng']) ??
      nested(raw, ['location', 'lng']),
  );
  const rawType = firstString(pick(raw, ['type', 'category', 'categoryName', 'types']));
  const baseId =
    placeId ?? dataId ?? `${slugify(name)}-${shortHash(`${name}:${lat ?? ''}:${lng ?? ''}`)}`;
  const id = `tor-${baseId.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 48)}`;

  const input: UpsertLocationInput = {
    id,
    name,
    source: 'hasdata',
    category: categoryFor(raw),
    last_updated: new Date(nowMs).toISOString(),
    expires_at: new Date(nowMs + ttlMs).toISOString(),
  };

  if (placeId) input.place_id = placeId;
  if (dataId) input.data_id = dataId;
  if (rawType) input.raw_type = rawType;
  if (lat != null) input.lat = lat;
  if (lng != null) input.lng = lng;

  const address = firstString(pick(raw, ['address', 'formattedAddress', 'vicinity', 'fullAddress']));
  if (address) input.address = address;
  const description = firstString(
    pick(raw, ['description', 'summary', 'descriptionSnippet', 'snippet']),
  );
  if (description) input.description = description;
  const rating = toFloat(pick(raw, ['rating', 'averageRating']));
  if (rating != null) input.rating = rating;
  const ratingCount = toInt(
    pick(raw, ['reviews', 'reviewsCount', 'reviewCount', 'reviews_count', 'userRatingsTotal', 'ratingCount']),
  );
  if (ratingCount != null) input.rating_count = ratingCount;
  const image = firstString(pick(raw, ['imageUrl', 'image', 'thumbnail', 'photo', 'photos']));
  if (image) input.image_url = image;
  const website = firstString(pick(raw, ['website', 'websiteUrl', 'website_url']));
  if (website) input.website_url = website;
  const phone = firstString(pick(raw, ['phone', 'phoneNumber', 'phone_number']));
  if (phone) input.phone = phone;
  const price = toPriceLevel(pick(raw, ['price', 'priceLevel', 'price_level']));
  if (price != null) input.price_level = price;
  const country = firstString(pick(raw, ['country', 'countryCode']));
  if (country) input.country = country;
  const hours = pick(raw, ['workingHours', 'hours', 'openingHours', 'businessHours']);
  if (isRecord(hours) || Array.isArray(hours)) input.hours_json = JSON.stringify(hours);
  const social = pick(raw, ['socialLinks', 'social_links']);
  if (Array.isArray(social)) input.social_links_json = JSON.stringify(social);
  const tags = pick(raw, ['tags', 'types']);
  if (Array.isArray(tags)) input.tags_json = JSON.stringify(tags.map(String));

  return input;
}

export class HasDataClient {
  private readonly apiKeyProvider: () => string;
  private readonly baseUrl: string;
  private readonly timeoutMs: number;
  private readonly hl: string;
  private readonly gl: string;
  private readonly ttlMs: number;
  private readonly fetchImpl: (input: string, init?: RequestInit) => Promise<Response>;

  constructor(options: HasDataClientOptions) {
    const keyOption = options.apiKey;
    this.apiKeyProvider = typeof keyOption === 'string' ? () => keyOption : keyOption;
    this.baseUrl = (options.baseUrl ?? DEFAULT_HASDATA_API_BASE).replace(/\/+$/, '');
    this.timeoutMs = options.timeoutMs ?? 8_000;
    this.hl = options.hl ?? 'en';
    this.gl = options.gl ?? 'ca';
    this.ttlMs = options.ttlMs ?? DEFAULT_HASDATA_TTL_MS;
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  private async request(path: string, params: Record<string, string>): Promise<Raw> {
    const apiKey = this.apiKeyProvider().trim();
    if (!apiKey) throw new HasDataError('HasData API key is not configured');
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(params)) {
      if (value !== '') url.searchParams.set(key, value);
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    let response: Response;
    try {
      response = await this.fetchImpl(url.toString(), {
        headers: { accept: 'application/json', 'x-api-key': apiKey },
        signal: controller.signal,
      });
    } catch (error) {
      const aborted = error instanceof Error && error.name === 'AbortError';
      throw new HasDataError(aborted ? 'HasData request timed out' : 'HasData request failed');
    } finally {
      clearTimeout(timer);
    }

    if (!response.ok) {
      // Never include the request URL or key in the error.
      throw new HasDataError(`HasData HTTP ${response.status}`, response.status);
    }

    let body: unknown;
    try {
      body = await response.json();
    } catch {
      throw new HasDataError('HasData returned invalid JSON');
    }
    if (!isRecord(body)) throw new HasDataError('HasData returned an invalid body');
    return body;
  }

  async search(q: string, options: HasDataSearchOptions = {}): Promise<UpsertLocationInput[]> {
    const query = q.trim();
    if (!query) return [];
    const params: Record<string, string> = { q: query, hl: this.hl, gl: this.gl, start: '0' };
    if (options.lat != null && options.lng != null) {
      params.ll = `@${options.lat},${options.lng},12z`;
    }

    const data = await this.request('/search', params);
    const now = Date.now();
    const limit = Math.min(Math.max(options.limit ?? 20, 1), 100);
    const rows: UpsertLocationInput[] = [];
    for (const raw of extractSearchResults(data)) {
      const row = normalize(raw, now, this.ttlMs);
      if (!row || row.lat == null || row.lng == null) continue;
      rows.push(row);
      if (rows.length >= limit) break;
    }
    return rows;
  }

  async getPlace(placeId: string): Promise<UpsertLocationInput | null> {
    const id = placeId.trim();
    if (!id) return null;
    const data = await this.request('/place', {
      placeId: id,
      hl: this.hl,
      fetchWebResults: 'false',
    });
    return normalize(extractPlace(data), Date.now(), this.ttlMs);
  }
}
