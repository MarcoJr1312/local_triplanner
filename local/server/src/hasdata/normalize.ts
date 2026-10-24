// Normalizacion de resultados HasData -> fila de `locations`.
// - place_id/data_id unicos (dataId != placeId)
// - categoria inferida via mapeo keyword-based; type original a raw_type SIEMPRE
// - lat/lng, rating, address, hours_json, website_url, phone, description, price_level
// - maneja campos con distintos nombres (defensivo) y arrays de resultados

import { randomUUID } from 'node:crypto';
import { mapTypeToCategory } from './category.ts';
import type { UpsertLocationInput } from '../schema-types.ts';

// Payload crudo de HasData: JSON arbitrario; acceso defensivo via pick/firstString.
export type HasDataRaw = Record<string, unknown> & {
  gpsCoordinates?: { latitude?: unknown; longitude?: unknown };
};

function pick(obj: Record<string, unknown> | null | undefined, keys: readonly string[]): unknown {
  for (const k of keys) {
    const v = obj?.[k];
    if (v != null && v !== '') return v;
  }
  return undefined;
}

function firstString(value: unknown): string | null | undefined {
  if (Array.isArray(value)) {
    return value.find((v) => v != null && v !== '') as string | undefined;
  }
  return typeof value === 'string' && value !== '' ? value : undefined;
}

function toFloat(v: unknown): number | null {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  if (v == null) return null;
  const n = parseInt(String(v), 10);
  return Number.isFinite(n) ? n : null;
}

export function normalizeHasDataPlace(raw: HasDataRaw): UpsertLocationInput {
  const typeRaw = pick(raw, ['type', 'category', 'categoryName', 'types']);
  const type = firstString(typeRaw) ?? null;

  const name = firstString(pick(raw, ['title', 'name', 'placeName', 'place name'])) ?? 'Sin nombre';
  // HasData anida las coordenadas en gpsCoordinates {latitude, longitude}
  const lat = toFloat(pick(raw, ['latitude', 'lat'])) ?? toFloat(raw?.gpsCoordinates?.latitude);
  const lng = toFloat(pick(raw, ['longitude', 'lng'])) ?? toFloat(raw?.gpsCoordinates?.longitude);

  const hours = pick(raw, ['workingHours', 'hours', 'openingHours', 'businessHours']);
  const ratingCount = toInt(pick(raw, [
    'reviews', 'reviewsCount', 'reviewCount', 'reviews_count', 'userRatingsTotal', 'ratingCount',
  ]));

  const placeId = firstString(pick(raw, ['placeId', 'place_id']));
  const dataId = firstString(pick(raw, ['dataId', 'data_id']));

  return {
    id: randomUUID(),
    source: 'hasdata',
    place_id: placeId ?? null,
    data_id: dataId ?? null,
    slug: null,
    name,
    category: mapTypeToCategory(type),
    raw_type: type,
    country: null,
    description: firstString(pick(raw, ['description', 'summary', 'descriptionSnippet', 'snippet'])) ?? null,
    lat,
    lng,
    address: firstString(pick(raw, ['address', 'formattedAddress', 'vicinity', 'fullAddress'])) ?? null,
    rating: toFloat(pick(raw, ['rating', 'averageRating'])),
    rating_count: ratingCount,
    hours_json: hours != null ? JSON.stringify(hours) : null,
    website_url: firstString(pick(raw, ['website', 'websiteUrl', 'website_url'])) ?? null,
    social_links_json: null,
    phone: firstString(pick(raw, ['phone', 'phoneNumber', 'phone_number'])) ?? null,
    price_level: priceLevel(raw),
    image_url: firstString(pick(raw, ['imageUrl', 'image', 'thumbnail', 'photo'])) ?? null,
    cost: null,
    tags_json: null,
    duration_hours: null,
    parent_id: null,
    last_updated: new Date().toISOString(),
  };
}

function priceLevel(raw: HasDataRaw): string | null {
  const v = pick(raw, ['priceLevel', 'price_level', 'price', 'priceRange']);
  if (v == null) return null;
  return String(v);
}
